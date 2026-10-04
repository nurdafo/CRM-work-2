import fs from "node:fs";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  const key = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  vars[key] = value;
}

const login = await fetch("https://nurainur-crm.jumanur62.workers.dev/api/login", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ password: vars.CRM_PASSWORD }),
});

const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
const leads = cookie
  ? await fetch("https://nurainur-crm.jumanur62.workers.dev/api/leads", { headers: { cookie } })
  : null;

console.log(JSON.stringify({
  loginStatus: login.status,
  leadsStatus: leads?.status ?? null,
  passwordCharacters: [...(vars.CRM_PASSWORD ?? "")].length,
}));
