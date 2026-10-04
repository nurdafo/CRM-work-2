import fs from "node:fs";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}

const response = await fetch("https://graph.facebook.com/v26.0/28378756615092458?fields=id,name,questions", {
  headers: { authorization: `Bearer ${vars.META_PAGE_ACCESS_TOKEN}` },
});
const json = await response.json();
if (!response.ok || json.error) throw new Error(json.error?.message || response.statusText);
console.log(JSON.stringify(json, null, 2));
