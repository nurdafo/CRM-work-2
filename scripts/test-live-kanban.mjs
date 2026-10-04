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

function base64Url(value) { return Buffer.from(value).toString("base64url"); }
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const env = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
const baseUrl = "https://nurainur-crm.jumanur62.workers.dev";
const spreadsheetId = "1EIaTnBDEoS-z5nIlIqgahkMfSbYelZVqK2xKi6u8aEY";

async function googleToken() {
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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google authentication failed (${response.status})`);
  return body.access_token;
}

async function login() {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: env.CRM_PASSWORD }),
  });
  if (!response.ok) throw new Error(`CRM login failed (${response.status})`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function crm(cookie, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...init.headers, Cookie: cookie } });
  const body = await response.json();
  if (!response.ok) throw new Error(`CRM request ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function google(token, path, init = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Google request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function grid(token) {
  const range = encodeURIComponent("'Канбан'!A1:H1001");
  return google(token, `?includeGridData=true&ranges=${range}&fields=sheets(properties(sheetId),data(rowData(values(userEnteredValue,note))))`);
}

function locate(body, leadId) {
  const rows = body.sheets?.[0]?.data?.[0]?.rowData ?? [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const values = rows[rowIndex]?.values ?? [];
    for (let columnIndex = 0; columnIndex < values.length; columnIndex += 1) {
      if ((values[columnIndex]?.note ?? "").includes(`CRM_ID:${leadId}`)) return { rowIndex, columnIndex };
    }
  }
  throw new Error(`Card ${leadId} was not found in Google Sheets`);
}

async function moveCard(token, leadId, destinationColumn) {
  const currentGrid = await grid(token);
  const sheetId = currentGrid.sheets?.[0]?.properties?.sheetId;
  const source = locate(currentGrid, leadId);
  if (source.columnIndex === destinationColumn) return;
  await google(token, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: [{ cutPaste: {
      source: { sheetId, startRowIndex: source.rowIndex, endRowIndex: source.rowIndex + 1, startColumnIndex: source.columnIndex, endColumnIndex: source.columnIndex + 1 },
      destination: { sheetId, rowIndex: source.rowIndex, columnIndex: destinationColumn },
      pasteType: "PASTE_NORMAL",
    } }] }),
  });
}

async function waitForStatus(cookie, leadId, expected, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const body = await crm(cookie, "/api/leads");
    const lead = body.leads.find((item) => item.id === leadId);
    if (lead?.status === expected) return { lead, elapsedMs: Date.now() - startedAt };
    await delay(3000);
  }
  throw new Error(`CRM did not reach ${expected} within ${timeoutMs} ms`);
}

async function waitForSheetState(token, leadId, expectedColumn, expectedRevision, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentGrid = await grid(token);
    const position = locate(currentGrid, leadId);
    const note = currentGrid.sheets?.[0]?.data?.[0]?.rowData?.[position.rowIndex]?.values?.[position.columnIndex]?.note ?? "";
    if (position.columnIndex === expectedColumn && note.includes(`CRM_REV:${expectedRevision}`)) return;
    await delay(2000);
  }
  throw new Error(`Google Sheets did not reach column ${expectedColumn} with the current card revision`);
}

async function headerCounts(token) {
  const range = encodeURIComponent("'Канбан'!A1:H1");
  const body = await google(token, `/values/${range}`);
  return body.values?.[0] ?? [];
}

const cookie = await login();
const token = await googleToken();
const leadsBody = await crm(cookie, "/api/leads");
const lead = leadsBody.leads.find((item) => item.isTestLead) ?? leadsBody.leads[0];
if (!lead) throw new Error("There is no lead available for the live Kanban test");
const originalStatus = lead.status;
const stageIds = leadsBody.stages.map((stage) => stage.id);
if (process.env.INSPECT_WORKER_RANGE) {
  const range = encodeURIComponent("'Канбан'!A2:H1001");
  console.log(JSON.stringify(await google(token, `?includeGridData=true&ranges=${range}&fields=sheets(data(startColumn,rowData(values(note))))`)));
  process.exit(0);
}
if (process.env.SYNC_ONLY) {
  console.log(JSON.stringify(await crm(cookie, "/api/google/kanban/sync", { method: "POST" })));
  process.exit(0);
}
if (process.env.INSPECT_ONLY) {
  const currentGrid = await grid(token);
  const position = locate(currentGrid, lead.id);
  const note = currentGrid.sheets?.[0]?.data?.[0]?.rowData?.[position.rowIndex]?.values?.[position.columnIndex]?.note ?? "";
  console.log(JSON.stringify({ lead: { id: lead.id, status: lead.status, updatedAt: lead.updatedAt }, position, note }));
  process.exit(0);
}
const contactedColumn = stageIds.indexOf("contacted");
const saleColumn = stageIds.indexOf("sale");
const originalColumn = stageIds.indexOf(originalStatus);
if (process.env.MOVE_ONLY_STAGE) {
  const destinationColumn = stageIds.indexOf(process.env.MOVE_ONLY_STAGE);
  if (destinationColumn < 0) throw new Error(`Unknown MOVE_ONLY_STAGE ${process.env.MOVE_ONLY_STAGE}`);
  await moveCard(token, lead.id, destinationColumn);
  console.log(JSON.stringify({ ok: true, leadId: lead.id, movedTo: process.env.MOVE_ONLY_STAGE }));
  process.exit(0);
}
let cronResult;
let directResult;
try {
  await moveCard(token, lead.id, contactedColumn);
  cronResult = await waitForStatus(cookie, lead.id, "contacted", 85000);
  await waitForSheetState(token, lead.id, contactedColumn, cronResult.lead.updatedAt);
  await moveCard(token, lead.id, saleColumn);
  const directSync = await crm(cookie, "/api/google/kanban/sync", { method: "POST" });
  directResult = await waitForStatus(cookie, lead.id, "sale", 15000);
  const headers = await headerCounts(token);
  if (headers.length !== 8 || !headers[6]?.endsWith("(1)")) throw new Error(`Unexpected sale counters: ${JSON.stringify(headers)}`);
  if (directSync.moved !== 1) throw new Error(`Expected one direct move, received ${directSync.moved}`);
} finally {
  const currentBody = await crm(cookie, "/api/leads");
  const currentLead = currentBody.leads.find((item) => item.id === lead.id);
  if (currentLead.status !== originalStatus) {
    await waitForSheetState(token, lead.id, stageIds.indexOf(currentLead.status), currentLead.updatedAt);
  }
  await moveCard(token, lead.id, originalColumn);
  await crm(cookie, "/api/google/kanban/sync", { method: "POST" });
  await waitForStatus(cookie, lead.id, originalStatus, 15000);
}

const restoredHeaders = await headerCounts(token);
console.log(JSON.stringify({
  ok: true,
  leadId: lead.id,
  cronMoveSeconds: Math.round(cronResult.elapsedMs / 100) / 10,
  directMoveSeconds: Math.round(directResult.elapsedMs / 100) / 10,
  restoredStatus: originalStatus,
  restoredHeaders,
}));
