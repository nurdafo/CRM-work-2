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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const env = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
if (!env.CRM_PASSWORD) throw new Error("CRM_PASSWORD is missing from .dev.vars");

const baseUrl = "https://nurainur-crm.jumanur62.workers.dev";
const login = await fetch(`${baseUrl}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: env.CRM_PASSWORD }),
});
if (!login.ok) throw new Error(`CRM login failed (${login.status})`);

const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
const rebuild = await fetch(`${baseUrl}/api/google/kanban/rebuild`, {
  method: "POST",
  headers: { Cookie: cookie },
});
const result = await rebuild.json();
if (!rebuild.ok) throw new Error(`Kanban rebuild failed (${rebuild.status})`);
console.log(JSON.stringify(result));
