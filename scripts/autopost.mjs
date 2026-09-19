#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  PERPLEXITY_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  THREADS_SESSION_ID,
  THREADS_CSRF_TOKEN,
} = process.env;

for (const [name, val] of Object.entries({
  PERPLEXITY_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  THREADS_SESSION_ID,
  THREADS_CSRF_TOKEN,
})) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const KNOWLEDGE_BASE = `# База знаний Gardina

## Что такое Gardina
Облачная CRM для салонов и ателье пошива штор в Казахстане. Не товар, а инструмент
для владельца салона: клиенты, заказы, замеры, ткани, производство, оплата — в одном месте.

## Тарифы
- Start — 15 000 тенге/мес, до 3 пользователей, 1 салон
- Pro — 35 000 тенге/мес, до 8 пользователей, полный функционал, 7 дней бесплатно
- Network — от 60 000 тенге/мес, несколько салонов

## Функциональность
- Клиенты и заказы в одном месте
- Замеры, ткани, оплата, статус заказа
- Учёт работы менеджеров
- Передача клиента новому менеджеру без потери истории
- Контроль всего процесса из одного окна

## Контакты
- WhatsApp: +7 707 942 9827 (ссылка для CTA: https://wa.me/77079429827)
- Email: info@gardina.kz
- Сайт: gardina.kz`;

const VOICE_GUIDE = `# Голос бренда Gardina в Threads

0. ПЕРВАЯ СТРОКА поста — явное обращение к целевой аудитории, кому этот пост
   (например: "Салонам штор:", "Владельцам ателье пошива штор:", "Тем, кто держит
   салон штор:"). Это отдельная короткая строка, после неё пустая строка, и только
   потом идёт боль/вопрос (по правилу 2 ниже). Без этого случайный читатель не
   понимает, при чём тут он, и пролистывает не разобравшись — обращение сразу
   фильтрует "это про меня" / "это не про меня".
1. От первого лица, без корпоративного "мы предлагаем решения". Хорошо: "Мы сделали
   Gardina, потому что задолбались смотреть, как салоны теряют клиентов в блокнотах."
2. Короткие строки, разрыв абзаца после 1-2 предложений.
3. Конкретика вместо маркетинговых слов: точные цифры и сценарии, не "удобно и выгодно".
4. Честность / анти-понты — сильный триггер: "без сложных внедрений", "без месяцев
   настройки", "работает с первого дня".
5. Вопрос вместо питча — лучший способ собрать комментарии ("Кто пользуется CRM?",
   "Где сейчас ведёте заказы?").
6. Эмодзи точечно, 1-2 на пост, только где есть реальная эмоция.
7. RU и KZ — самостоятельные посты (не дословный перевод), но одна и та же мысль/CTA.
8. CTA: "напишите в комментариях «Gardina»" или ссылка
   https://wa.me/77079429827?text=<urlencoded приветствие>.

Чего не делать:
- Не использовать канцелярит: "функционал", "решение", "интегрированный подход"
- Не начинать пост со слова "Gardina" или названия продукта — первая строка это
  обращение к аудитории (правило 0), а не бренд; боль/вопрос идёт сразу после неё
- Не писать длинные абзацы без разрывов
- Не использовать тире/дефисы (—, -) как разделитель мысли внутри предложения —
  признак ИИ-текста, разбивать точкой на отдельные предложения
- Не использовать символ ₸. Писать "тенге"/"теңге" словом.
- Каждый пост не длиннее ~450 символов (лимит Threads — 500).`;

const HISTORY_LOG_PATH = path.join(process.cwd(), "data", "posts-log.json");
const HEALTH_PATH = path.join(process.cwd(), "data", "health.json");
const PAUSE_THRESHOLD = 2;

function loadHealth() {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_PATH, "utf8"));
  } catch {
    return { consecutiveFailures: 0, paused: false, lastUpdated: null };
  }
}

function saveHealth(health) {
  fs.mkdirSync(path.dirname(HEALTH_PATH), { recursive: true });
  fs.writeFileSync(
    HEALTH_PATH,
    JSON.stringify({ ...health, lastUpdated: new Date().toISOString() }, null, 2) + "\n",
    "utf8"
  );
}

function recordFailure(reason) {
  const health = loadHealth();
  health.consecutiveFailures = (health.consecutiveFailures || 0) + 1;
  if (health.consecutiveFailures >= PAUSE_THRESHOLD) {
    health.paused = true;
    tgSend(
      `⛔ Автопостинг ПОСТАВЛЕН НА ПАУЗУ: ${health.consecutiveFailures} ошибки подряд ` +
        `(последняя: ${String(reason).slice(0, 200)}). Похоже на блок/чекпоинт аккаунта, а не разовый сбой. ` +
        `Дальше запуски будут пропускаться, пока кто-то вручную не проверит аккаунт и не сбросит ` +
        `data/health.json (paused: false, consecutiveFailures: 0) в репозитории.`
    );
  }
  saveHealth(health);
}

function recordSuccess() {
  saveHealth({ consecutiveFailures: 0, paused: false });
}
const ANGLE_HINTS =
  `Выбирай новый угол каждый раз: боль про Excel/вацап, уход сотрудника с историей клиента, ` +
  `вопрос-пост "как ведёте заказы", цена/тариф как точка входа, честность/анти-понты, ` +
  `звонки "где мой заказ", путаница между менеджером и швеёй/замерщицей, отзыв довольного клиента и т.п. ` +
  `В день выходит несколько постов — каждый должен цеплять свой угол, не быть вариацией уже написанного.`;

function loadHistoryLog() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_LOG_PATH, "utf8"));
  } catch {
    return [];
  }
}

function appendHistoryLog(entries) {
  const log = loadHistoryLog().concat(entries);
  fs.mkdirSync(path.dirname(HISTORY_LOG_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_LOG_PATH, JSON.stringify(log, null, 2) + "\n", "utf8");
}

function buildHistoryContext() {
  const recent = loadHistoryLog().slice(-30);
  if (!recent.length) {
    return `# История уже опубликованных постов\n(пусто, это первый пост)\n\n${ANGLE_HINTS}`;
  }
  const lines = recent.map((e) => {
    const short = e.text.replace(/\s+/g, " ").slice(0, 140);
    return `- ${e.date} ${String(e.lang).toUpperCase()}: ${short}${e.text.length > 140 ? "…" : ""}`;
  });
  return (
    `# История уже опубликованных постов (не повторяй формулировки/зацепки дословно)\n` +
    lines.join("\n") +
    `\n\n${ANGLE_HINTS}`
  );
}

function llmChat(system, userText) {
  const body = JSON.stringify({
    model: process.env.PERPLEXITY_MODEL || "sonar",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
  });
  const res = execSync(
    `curl -sS https://api.perplexity.ai/chat/completions ` +
      `-H "Authorization: Bearer $PERPLEXITY_API_KEY" ` +
      `-H "content-type: application/json" ` +
      `-d @-`,
    { input: body, env: process.env, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  const data = JSON.parse(res);
  if (data.error) {
    throw new Error(`Perplexity API error: ${JSON.stringify(data.error)}`);
  }
  return data.choices[0].message.content.trim();
}

function parseDraftJson(text) {
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not find JSON in model output: ${cleaned.slice(0, 300)}`);
  const parsed = JSON.parse(match[0]);
  if (!parsed.ru || !parsed.kz) throw new Error(`Draft JSON missing ru/kz: ${match[0].slice(0, 300)}`);
  return { ru: String(parsed.ru).trim(), kz: String(parsed.kz).trim() };
}

function generateDraft(feedback, previousDraft) {
  const system = `${KNOWLEDGE_BASE}\n\n${VOICE_GUIDE}\n\n${buildHistoryContext()}`;
  let userText;
  if (feedback && previousDraft) {
    userText =
      `Твой предыдущий черновик:\nRU: ${previousDraft.ru}\nKZ: ${previousDraft.kz}\n\n` +
      `Владелец прислал правку в Telegram: "${feedback}"\n\n` +
      `Перепиши RU и/или KZ текст с учётом этой правки, сохраняя голос бренда и факты из базы знаний. ` +
      `Ответь СТРОГО валидным JSON без markdown-обёртки в формате {"ru": "...", "kz": "..."}, без пояснений до или после.`;
  } else {
    userText =
      `Напиши НОВУЮ пару постов (RU и KZ) для Threads на сегодня, следуя голосу бренда и не повторяя углы из истории. ` +
      `Ответь СТРОГО валидным JSON без markdown-обёртки в формате {"ru": "...", "kz": "..."}, без пояснений до или после.`;
  }
  const raw = llmChat(system, userText);
  return parseDraftJson(raw);
}

function tgApi(method, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}${qs ? `?${qs}` : ""}`;
  const res = execSync(`curl -sS "${url}"`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(res);
}

function tgSend(text, replyMarkup) {
  const params = { chat_id: TELEGRAM_CHAT_ID, text };
  if (replyMarkup) params.reply_markup = JSON.stringify(replyMarkup);
  return tgApi("sendMessage", params);
}

function tgGetUpdates(offset) {
  const params = offset !== undefined ? { offset: String(offset) } : {};
  return tgApi("getUpdates", params);
}

function tgAnswerCallback(callbackQueryId, text) {
  return tgApi("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text || "" });
}

function tgClearButtons(chatId, messageId) {
  return tgApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: String(messageId),
    reply_markup: JSON.stringify({ inline_keyboard: [] }),
  });
}

const APPROVE_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "✅ Опубликовать", callback_data: "approve" },
      { text: "❌ Отменить", callback_data: "cancel" },
    ],
  ],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function threadsEnv() {
  return { ...process.env, THREADS_SESSION_ID, THREADS_CSRF_TOKEN };
}

function threadsWhoami() {
  try {
    execSync(`npx -y -p yarn-threads-cli yarn-threads whoami --json`, {
      env: threadsEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function threadsPost(text) {
  const tmpFile = path.join(os.tmpdir(), `post-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpFile, text, "utf8");
  try {
    const out = execSync(
      `npx -y -p yarn-threads-cli yarn-threads post "$(cat ${tmpFile})" --json`,
      { env: threadsEnv(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(out);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function main() {
  const health = loadHealth();
  if (health.paused) {
    console.log("Autopost is paused (repeated failures earlier) — skipping this run silently.");
    return;
  }

  console.log("Checking Threads auth...");
  if (!threadsWhoami()) {
    const reason = "сессия Threads протухла или аккаунт заблокирован (whoami не прошёл)";
    tgSend(
      "⚠️ Сессия Threads протухла. Нужен ручной релогин на threads.net в браузере и " +
        "обновление THREADS_SESSION_ID / THREADS_CSRF_TOKEN в GitHub Secrets репозитория."
    );
    recordFailure(reason);
    console.error("Threads auth failed, stopping.");
    process.exit(1);
  }

  console.log("Generating draft...");
  let draft = generateDraft();
  console.log("Draft:", draft);

  console.log("Reading Telegram baseline update_id...");
  const initial = tgGetUpdates();
  let base = 0;
  if (initial.result && initial.result.length) {
    base = Math.max(...initial.result.map((u) => u.update_id));
  }

  const draftMsg = tgSend(
    `Черновик поста в Threads (RU+KZ):\n\n` +
      `RU:\n${draft.ru}\n\n` +
      `KZ:\n${draft.kz}\n\n` +
      `Нажми кнопку ниже, или ответь текстом: «стоп» — отменить, любой другой текст — правки. ` +
      `Без ответа за 30 минут — опубликую как есть.`,
    APPROVE_KEYBOARD
  );
  const draftMessageId = draftMsg.result && draftMsg.result.message_id;

  let decision = "approve";
  let feedbackText = null;

  const ATTEMPTS = 6;
  const INTERVAL_MS = 5 * 60 * 1000;
  outer: for (let i = 0; i < ATTEMPTS; i++) {
    console.log(`Waiting for reaction, attempt ${i + 1}/${ATTEMPTS}...`);
    await sleep(INTERVAL_MS);
    const updates = tgGetUpdates(base + 1);
    for (const u of updates.result || []) {
      if (u.update_id <= base) continue;
      base = u.update_id;

      if (u.callback_query && String(u.callback_query.message.chat.id) === String(TELEGRAM_CHAT_ID)) {
        const cq = u.callback_query;
        tgAnswerCallback(cq.id, cq.data === "cancel" ? "Отменяю" : "Публикую");
        if (draftMessageId) tgClearButtons(TELEGRAM_CHAT_ID, draftMessageId);
        decision = cq.data === "cancel" ? "cancel" : "approve";
        break outer;
      }

      if (u.message && String(u.message.chat.id) === String(TELEGRAM_CHAT_ID) && u.message.text) {
        const t = u.message.text.toLowerCase();
        if (/стоп|нет|отмена|cancel|no/.test(t)) {
          decision = "cancel";
        } else {
          decision = "revise";
          feedbackText = u.message.text;
        }
        break outer;
      }
    }
  }

  if (decision === "cancel") {
    tgSend("Ок, не публикую сегодняшний пост.");
    console.log("Cancelled by user.");
    return;
  }

  if (decision === "revise") {
    console.log("Revising draft based on feedback:", feedbackText);
    draft = generateDraft(feedbackText, draft);
    console.log("Revised draft:", draft);
  }

  console.log("Re-checking Threads auth before posting...");
  if (!threadsWhoami()) {
    tgSend(
      "⚠️ Сессия Threads протухла (проверено перед публикацией). Нужен ручной релогин " +
        "на threads.net и обновление THREADS_SESSION_ID / THREADS_CSRF_TOKEN в GitHub Secrets."
    );
    recordFailure("whoami failed before posting");
    process.exit(1);
  }

  try {
    console.log("Posting RU...");
    const ru = threadsPost(draft.ru);
    console.log("Posting KZ...");
    const kz = threadsPost(draft.kz);
    const ruUrl = ru.url || `https://www.threads.net/t/${ru.code}`;
    const kzUrl = kz.url || `https://www.threads.net/t/${kz.code}`;
    const today = new Date().toISOString().slice(0, 10);
    appendHistoryLog([
      { date: today, lang: "ru", text: draft.ru, url: ruUrl },
      { date: today, lang: "kz", text: draft.kz, url: kzUrl },
    ]);
    recordSuccess();
    tgSend(
      `✅ Опубликовано${decision === "revise" ? " (текст изменён по твоей правке)" : ""}:\n` +
        `RU: ${ruUrl}\nKZ: ${kzUrl}`
    );
    console.log("Done:", { ruUrl, kzUrl });
  } catch (e) {
    tgSend(`⚠️ Ошибка при публикации в Threads: ${String(e).slice(0, 300)}`);
    recordFailure(String(e));
    console.error("Posting failed:", e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  try {
    tgSend(`⚠️ Routine упал с ошибкой: ${String(e).slice(0, 300)}`);
  } catch {}
  process.exit(1);
});
