import fs from "node:fs";

const DEV_VARS_PATH = ".dev.vars";
const BUSINESS_ID = "1076837885516726";
const APP_ID = "1378442990934699";
const PAGE_ID = "1076700328863815";
const AD_ACCOUNT_ID = "act_1623369248931085";
const VERSION = "v26.0";

const source = fs.readFileSync(DEV_VARS_PATH, "utf8");
const vars = {};
for (const line of source.split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}
if (!vars.META_MARKETING_ACCESS_TOKEN) throw new Error("META_MARKETING_ACCESS_TOKEN is empty");

const graph = async (path, init = {}) => {
  const response = await fetch(`https://graph.facebook.com/${VERSION}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${vars.META_MARKETING_ACCESS_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    const error = json.error || {};
    throw new Error(`${path}: ${error.message || response.statusText} (code ${error.code || response.status})`);
  }
  return json;
};

const post = (path, values) => graph(path, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values),
});

const existing = await graph(`${BUSINESS_ID}/system_users?fields=id,name,role&limit=100`);
let systemUser = existing.data?.find((item) => item.name === "NurAinur CRM");
let created = false;
if (!systemUser) {
  const result = await post(`${BUSINESS_ID}/system_users`, { name: "NurAinur CRM", role: "EMPLOYEE" });
  systemUser = { id: result.id, name: "NurAinur CRM", role: "EMPLOYEE" };
  created = true;
}

const operations = [];
for (const [name, action] of [
  ["app", () => post(`${systemUser.id}/applications`, { business_app: APP_ID })],
  ["appRole", () => post(`${APP_ID}/assigned_users`, { user: systemUser.id, tasks: JSON.stringify(["MANAGE", "DEVELOP"]) })],
  ["page", () => post(`${PAGE_ID}/assigned_users`, { user: systemUser.id, tasks: JSON.stringify(["MANAGE", "ADVERTISE", "ANALYZE"]) })],
  ["adAccount", () => post(`${AD_ACCOUNT_ID}/assigned_users`, { user: systemUser.id, tasks: JSON.stringify(["ADVERTISE", "ANALYZE"]) })],
]) {
  try {
    await action();
    operations.push({ name, success: true });
  } catch (error) {
    operations.push({ name, success: false, error: String(error) });
  }
}

const line = `META_SYSTEM_USER_ID=${systemUser.id}`;
const updated = /^META_SYSTEM_USER_ID=.*$/m.test(source)
  ? source.replace(/^META_SYSTEM_USER_ID=.*$/m, line)
  : `${source.trimEnd()}\n${line}\n`;
fs.writeFileSync(DEV_VARS_PATH, updated, { encoding: "utf8", mode: 0o600 });

console.log(JSON.stringify({ created, systemUser, operations }, null, 2));
