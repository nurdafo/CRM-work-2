import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  const key = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  vars[key] = value;
}

const botToken = vars.TELEGRAM_BOT_TOKEN;
if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

const webhookSecret = crypto.randomBytes(24).toString("base64url");
const temporaryPath = ".wrangler/telegram-secret.json";
fs.mkdirSync(".wrangler", { recursive: true });
try {
  fs.writeFileSync(temporaryPath, JSON.stringify({ TELEGRAM_WEBHOOK_SECRET: webhookSecret }), { encoding: "utf8", mode: 0o600 });
  const result = spawnSync("npx wrangler secret bulk .wrangler/telegram-secret.json", {
    cwd: process.cwd(), shell: true, encoding: "utf8", windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Unable to store Telegram webhook secret");
} finally {
  if (fs.existsSync(temporaryPath)) {
    fs.writeFileSync(temporaryPath, "", "utf8");
    fs.rmSync(temporaryPath);
  }
}

const api = async (method, payload) => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(`Telegram ${method} failed: ${String(data.description ?? "unknown error")}`);
  return data;
};

const webhookUrl = "https://nurainur-crm.jumanur62.workers.dev/webhooks/telegram";
let secretReady = false;
for (let attempt = 0; attempt < 10; attempt += 1) {
  const probe = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": webhookSecret },
    body: JSON.stringify({ update_id: 0 }),
  });
  if (probe.ok) { secretReady = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!secretReady) throw new Error("Telegram webhook secret did not become active");

const hook = await api("setWebhook", {
  url: webhookUrl,
  ip_address: "104.21.2.79",
  secret_token: webhookSecret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
});
const test = await api("sendMessage", {
  chat_id: "1750570674",
  text: "✅ Нурайнур CRM подключена. Новые заявки будут приходить в этот чат.",
});

console.log(JSON.stringify({ webhookConfigured: hook.ok, webhookUrl, testMessageId: test.result?.message_id ?? null }));
