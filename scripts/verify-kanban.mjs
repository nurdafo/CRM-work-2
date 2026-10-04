import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseDevVars(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

const env = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
const issuedAt = Math.floor(Date.now() / 1000);
const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const claims = base64Url(JSON.stringify({
  iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
  aud: "https://oauth2.googleapis.com/token",
  iat: issuedAt,
  exp: issuedAt + 3600,
}));
const unsigned = `${header}.${claims}`;
const signer = createSign("RSA-SHA256");
signer.update(unsigned);
signer.end();
const signature = signer.sign(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")).toString("base64url");
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(`Google authentication failed (${tokenResponse.status})`);

const spreadsheetId = "1EIaTnBDEoS-z5nIlIqgahkMfSbYelZVqK2xKi6u8aEY";
const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
url.searchParams.set("includeGridData", "true");
url.searchParams.set("ranges", "'Канбан'!A1:H10");
url.searchParams.set("fields", "sheets(properties(sheetId,title,index,gridProperties),data(rowData(values(userEnteredValue,note,userEnteredFormat,textFormatRuns,hyperlink)),rowMetadata(pixelSize),columnMetadata(pixelSize)))");
const response = await fetch(url, { headers: { Authorization: `Bearer ${tokenBody.access_token}` } });
const body = await response.json();
if (!response.ok) throw new Error(`Google Sheets inspection failed (${response.status})`);

const sheet = body.sheets?.[0];
const grid = sheet?.data?.[0];
const headerCells = grid?.rowData?.[0]?.values ?? [];
const cardCells = grid?.rowData?.[1]?.values ?? [];
const allCardCells = (grid?.rowData ?? []).slice(1).flatMap((row) => row?.values ?? []);
const firstCard = allCardCells.find((cell) => cell?.userEnteredValue?.stringValue);
const validPhoneCards = allCardCells.filter((cell) => {
  const value = cell?.userEnteredValue?.stringValue;
  return typeof value === "string" && /\+?\d[\d ()-]{8,}/.test(value);
});
const verificationCardsPresent = cardCells.some((cell) => cell?.userEnteredValue?.stringValue?.includes("Kanban Test"));
const cellHasWhatsAppLink = (cell) => (
  typeof cell?.hyperlink === "string" && cell.hyperlink.startsWith("https://wa.me/")
) || (
  typeof cell?.userEnteredFormat?.textFormat?.link?.uri === "string" && cell.userEnteredFormat.textFormat.link.uri.startsWith("https://wa.me/")
) || (
  Array.isArray(cell?.textFormatRuns)
  && cell.textFormatRuns.some((run) => typeof run?.format?.link?.uri === "string" && run.format.link.uri.startsWith("https://wa.me/"))
);
const populatedCards = allCardCells.filter((cell) => cell?.userEnteredValue?.stringValue);
const checks = {
  firstTab: sheet?.properties?.index === 0,
  frozenHeader: sheet?.properties?.gridProperties?.frozenRowCount === 1,
  gridlinesHidden: sheet?.properties?.gridProperties?.hideGridlines === true,
  eightStages: headerCells.length === 8,
  coloredHeaders: headerCells.every((cell) => cell?.userEnteredFormat?.backgroundColorStyle?.rgbColor),
  wideColumns: (grid?.columnMetadata ?? []).slice(0, 8).every((column) => column?.pixelSize === 285),
  tallCards: grid?.rowMetadata?.[1]?.pixelSize === 230,
  verticalCardFields: !firstCard || (typeof firstCard.userEnteredValue?.stringValue === "string" && firstCard.userEnteredValue.stringValue.includes("\n")),
  whatsappLink: validPhoneCards.length === 0 || validPhoneCards.every(cellHasWhatsAppLink),
  dynamicCounters: headerCells.every((cell, index) => new RegExp(`^${index + 1}\\..+\\(\\d+\\)$`).test(cell?.userEnteredValue?.stringValue ?? "")),
  syncMetadata: populatedCards.every((cell) => /^CRM_ID:[0-9a-f-]{36}$/mi.test(cell?.note ?? "") && /^CRM_REV:.+$/mi.test(cell?.note ?? "")),
  cardsSeparatedByStage: !verificationCardsPresent || (
    cardCells[1]?.userEnteredValue?.stringValue?.includes("Kanban Test Contacted") === true
    && cardCells[4]?.userEnteredValue?.stringValue?.includes("Kanban Test Measurement") === true
    && cardCells[6]?.userEnteredValue?.stringValue?.includes("Kanban Test Sale") === true
  ),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`Kanban verification failed: ${JSON.stringify(checks)}`);
console.log(JSON.stringify({ ok: true, checks }));
