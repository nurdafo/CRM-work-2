import fs from "node:fs";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}

const response = await fetch("https://graph.facebook.com/v26.0/1076837885516726/system_users?fields=id,name,role&limit=100", {
  headers: { authorization: `Bearer ${vars.META_MARKETING_ACCESS_TOKEN}` },
});
const json = await response.json();
if (!response.ok || json.error) throw new Error(json.error?.message || response.statusText);
console.log(JSON.stringify({ systemUsers: json.data || [] }, null, 2));
