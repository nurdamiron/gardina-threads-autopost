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

const HISTORY = `# История уже опубликованных постов (не повторяй формулировки/зацепки дословно)
- 2026-09-15: вопрос про учёт заказов → боль/последствия → презентация + CTA (RU+KZ)
- 2026-09-18: боль Excel/вацап, CTA через wa.me со ссылкой-шаблоном (RU+KZ)
- 2026-09-19: боль "менеджер ушёл в декрет — история клиента потерялась" (тестовый прогон)
- 2026-09-19: боль "клиенты звонят спросить где заказ, менеджер роется в блокноте" (тестовый прогон)

Выбирай новый угол каждый день: боль про Excel/вацап, уход сотрудника с историей клиента,
вопрос-пост "как ведёте заказы", цена/тариф как точка входа, честность/анти-понты,
звонки "где мой заказ", путаница между менеджером и швеёй/замерщицей и т.п.`;

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
  const system = `${KNOWLEDGE_BASE}\n\n${VOICE_GUIDE}\n\n${HISTORY}`;
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

function tgSend(text) {
  return tgApi("sendMessage", { chat_id: TELEGRAM_CHAT_ID, text });
}

function tgGetUpdates(offset) {
  const params = offset !== undefined ? { offset: String(offset) } : {};
  return tgApi("getUpdates", params);
}

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
  console.log("Checking Threads auth...");
  if (!threadsWhoami()) {
    tgSend(
      "⚠️ Сессия Threads протухла. Нужен ручной релогин на threads.net в браузере и " +
        "обновление THREADS_SESSION_ID / THREADS_CSRF_TOKEN в GitHub Secrets репозитория."
    );
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

  tgSend(
    `Черновик поста в Threads (RU+KZ):\n\n` +
      `RU:\n${draft.ru}\n\n` +
      `KZ:\n${draft.kz}\n\n` +
      `Ответь «стоп» в этом чате в течение 30 минут, чтобы отменить публикацию. ` +
      `Любой другой ответ = правки, перепишу с их учётом. Без ответа — опубликую как есть через 30 минут.`
  );

  let decision = "approve";
  let feedbackText = null;

  const ATTEMPTS = 6;
  const INTERVAL_MS = 5 * 60 * 1000;
  for (let i = 0; i < ATTEMPTS; i++) {
    console.log(`Waiting for reaction, attempt ${i + 1}/${ATTEMPTS}...`);
    await sleep(INTERVAL_MS);
    const updates = tgGetUpdates(base + 1);
    const msgs = (updates.result || []).filter(
      (u) => u.message && String(u.message.chat.id) === String(TELEGRAM_CHAT_ID) && u.update_id > base
    );
    if (msgs.length) {
      const last = msgs[msgs.length - 1];
      base = last.update_id;
      const t = (last.message.text || "").toLowerCase();
      if (/стоп|нет|отмена|cancel|no/.test(t)) {
        decision = "cancel";
      } else {
        decision = "revise";
        feedbackText = last.message.text;
      }
      break;
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
    process.exit(1);
  }

  try {
    console.log("Posting RU...");
    const ru = threadsPost(draft.ru);
    console.log("Posting KZ...");
    const kz = threadsPost(draft.kz);
    const ruUrl = ru.url || `https://www.threads.net/t/${ru.code}`;
    const kzUrl = kz.url || `https://www.threads.net/t/${kz.code}`;
    tgSend(
      `✅ Опубликовано${decision === "revise" ? " (текст изменён по твоей правке)" : ""}:\n` +
        `RU: ${ruUrl}\nKZ: ${kzUrl}`
    );
    console.log("Done:", { ruUrl, kzUrl });
  } catch (e) {
    tgSend(`⚠️ Ошибка при публикации в Threads: ${String(e).slice(0, 300)}`);
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
