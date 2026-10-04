import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseDevVars(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[line.slice(0, separator).trim()] = value;
  }
  return result;
}

const env = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
const baseUrl = "https://nurainur-crm.jumanur62.workers.dev";
const leadId = process.env.TEST_LEAD_ID || "00000000-0000-4000-8000-000000000001";
const testSheetRow = Number(process.env.TEST_SHEET_ROW || "1000");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const base64Url = (value) => Buffer.from(value).toString("base64url");
const login = await fetch(`${baseUrl}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: env.CRM_PASSWORD }),
});
if (!login.ok) throw new Error(`CRM login failed (${login.status})`);
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Cookie: cookie, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function waitForStatus(expected, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const body = await api("/api/leads");
    const lead = body.leads.find((item) => item.id === leadId);
    if (lead?.metaAudience?.status === expected) return lead;
    await delay(1000);
  }
  throw new Error(`Meta audience status did not reach ${expected}`);
}

async function clearVerificationSheetRow() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")).toString("base64url");
  const auth = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const authBody = await auth.json();
  if (!auth.ok) throw new Error(`Google authentication failed (${auth.status})`);
  const range = encodeURIComponent(`'Заявки'!A${testSheetRow}:Q${testSheetRow}`);
  const clear = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/1EIaTnBDEoS-z5nIlIqgahkMfSbYelZVqK2xKi6u8aEY/values/${range}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authBody.access_token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!clear.ok) throw new Error(`Google row cleanup failed (${clear.status})`);
}

if (process.env.TEST_EXPECT_ERROR) {
  await api(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ isQuality: true }) });
  const firstError = await waitForStatus("error");
  await api(`/api/leads/${leadId}/meta/retry`, { method: "POST" });
  const retryError = await waitForStatus("error");
  await delay(4000);
  await clearVerificationSheetRow();
  console.log(JSON.stringify({
    ok: true,
    firstStatus: firstError.metaAudience.status,
    retryStatus: retryError.metaAudience.status,
    hasErrorMessage: Boolean(retryError.metaAudience.error),
  }));
  process.exit(0);
}

await api(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ isQuality: true }) });
const sent = await waitForStatus("sent");
const integration = await api("/api/meta/status");
await api(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ isQuality: false }) });
const removed = await waitForStatus("idle");
await delay(4000);
await clearVerificationSheetRow();
console.log(JSON.stringify({
  ok: true,
  added: sent.metaAudience.status,
  removed: removed.metaAudience.status,
  sourceAudienceId: integration.sourceAudience.id,
  lookalikeStatus: integration.lookalike.status,
  lookalikeQualityCount: integration.lookalike.qualityCount,
}));
