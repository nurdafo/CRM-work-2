import crypto from "node:crypto";
import fs from "node:fs";

const vars = {};
for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}

if (!vars.META_APP_SECRET) throw new Error("META_APP_SECRET is empty");
const leadId = process.argv[2];
if (!/^\d+$/.test(leadId || "")) throw new Error("Pass a numeric lead ID");

const body = JSON.stringify({
  object: "page",
  entry: [{
    id: "1076700328863815",
    time: Math.floor(Date.now() / 1000),
    changes: [{
      field: "leadgen",
      value: {
        leadgen_id: leadId,
        form_id: "28378756615092458",
        page_id: "1076700328863815",
        created_time: Math.floor(Date.now() / 1000),
      },
    }],
  }],
});
const signature = crypto.createHmac("sha256", vars.META_APP_SECRET).update(body).digest("hex");
const response = await fetch("https://nurainur-crm.jumanur62.workers.dev/webhooks/meta", {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` },
  body,
});
console.log(JSON.stringify({ status: response.status, body: await response.text() }, null, 2));
if (!response.ok) process.exitCode = 1;
