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

if (!vars.CRM_PASSWORD || vars.CRM_PASSWORD === "local-placeholder") throw new Error("CRM_PASSWORD is not configured");
if (!vars.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

const randomSecret = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const metaVerifyToken = randomSecret(24);
const payload = {
  CRM_PASSWORD: vars.CRM_PASSWORD,
  SESSION_SECRET: randomSecret(48),
  TELEGRAM_BOT_TOKEN: vars.TELEGRAM_BOT_TOKEN,
  META_VERIFY_TOKEN: metaVerifyToken,
  TELEGRAM_WEBHOOK_SECRET: randomSecret(24),
};

fs.mkdirSync(".wrangler", { recursive: true });
const temporaryPath = ".wrangler/secrets-upload.json";
try {
  fs.writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  const result = spawnSync("npx wrangler secret bulk .wrangler/secrets-upload.json", {
    cwd: process.cwd(), shell: true, encoding: "utf8", windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Wrangler secret upload failed");
} finally {
  if (fs.existsSync(temporaryPath)) {
    fs.writeFileSync(temporaryPath, "", "utf8");
    fs.rmSync(temporaryPath);
  }
}

console.log(JSON.stringify({ uploaded: true, metaVerifyToken }));
