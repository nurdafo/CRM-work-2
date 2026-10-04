import fs from "node:fs";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}

if (!vars.META_PAGE_ACCESS_TOKEN) throw new Error("META_PAGE_ACCESS_TOKEN is empty");

const fieldData = [
  { name: "какой_объект_вас_интересует?", values: ["Баня"] },
  { name: "какая_площадь_вам_нужна?", values: ["10-30 м²"] },
  { name: "есть_ли_у_вас_участок?", values: ["Да"] },
  { name: "когда_планируете_строительство?", values: ["В ближайший месяц"] },
  { name: "в_каком_городе_или_районе_находится_участок?", values: ["Алматы — тест CRM"] },
  { name: "full_name", values: ["Тестовая заявка CRM"] },
  { name: "phone_number", values: ["+77010000000"] },
];

const body = new URLSearchParams({ field_data: JSON.stringify(fieldData) });
const response = await fetch("https://graph.facebook.com/v26.0/28378756615092458/test_leads", {
  method: "POST",
  headers: {
    authorization: `Bearer ${vars.META_PAGE_ACCESS_TOKEN}`,
    "content-type": "application/x-www-form-urlencoded",
  },
  body,
});
const json = await response.json();
if (!response.ok || json.error) {
  const error = json.error || {};
  throw new Error(`${error.message || response.statusText} (code ${error.code || response.status})`);
}
console.log(JSON.stringify({ created: true, leadId: json.id }, null, 2));
