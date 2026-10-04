import fs from "node:fs";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}

const leadId = process.argv[2];
if (!/^\d+$/.test(leadId || "")) throw new Error("Pass a numeric test lead ID");
const response = await fetch(`https://graph.facebook.com/v26.0/${leadId}`, {
  method: "DELETE",
  headers: { authorization: `Bearer ${vars.META_PAGE_ACCESS_TOKEN}` },
});
const json = await response.json();
if (!response.ok || json.error) throw new Error(json.error?.message || response.statusText);
console.log(JSON.stringify({ deleted: json.success === true }));
