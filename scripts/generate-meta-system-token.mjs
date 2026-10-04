import fs from "node:fs";
import crypto from "node:crypto";

const PATH = ".dev.vars";
const APP_ID = "1378442990934699";
const VERSION = "v26.0";
const requiredScopes = [
  "ads_management",
  "ads_read",
  "business_management",
  "leads_retrieval",
  "pages_manage_ads",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_show_list",
];

const source = fs.readFileSync(PATH, "utf8");
const vars = {};
for (const line of source.split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  vars[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
}
if (!vars.META_SYSTEM_USER_ID || !vars.META_MARKETING_ACCESS_TOKEN || !vars.META_APP_SECRET) {
  throw new Error("System user, admin token, or app secret is missing");
}

const appsecretProof = crypto.createHmac("sha256", vars.META_APP_SECRET)
  .update(vars.META_MARKETING_ACCESS_TOKEN)
  .digest("hex");
const body = new URLSearchParams({
  business_app: APP_ID,
  scope: requiredScopes.join(","),
  appsecret_proof: appsecretProof,
});
const response = await fetch(`https://graph.facebook.com/${VERSION}/${vars.META_SYSTEM_USER_ID}/access_tokens`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${vars.META_MARKETING_ACCESS_TOKEN}`,
    "content-type": "application/x-www-form-urlencoded",
  },
  body,
});
const json = await response.json();
if (!response.ok || json.error || !json.access_token) {
  const error = json.error || {};
  throw new Error(`${error.message || response.statusText} (code ${error.code || response.status})`);
}

const debugResponse = await fetch(
  `https://graph.facebook.com/${VERSION}/debug_token?input_token=${encodeURIComponent(json.access_token)}`,
  { headers: { authorization: `Bearer ${APP_ID}|${vars.META_APP_SECRET}` } },
);
const debug = await debugResponse.json();
if (!debugResponse.ok || debug.error || debug.data?.is_valid !== true) throw new Error("Generated token is invalid");
const actualScopes = debug.data.scopes || [];
const missingScopes = requiredScopes.filter((scope) => !actualScopes.includes(scope));
if (missingScopes.length) {
  console.log(JSON.stringify({
    valid: debug.data.is_valid,
    type: debug.data.type,
    scopes: actualScopes,
    granularScopes: debug.data.granular_scopes || [],
  }, null, 2));
  throw new Error(`Generated token is missing: ${missingScopes.join(", ")}`);
}

let updated = source;
for (const key of ["META_MARKETING_ACCESS_TOKEN", "META_PAGE_ACCESS_TOKEN"]) {
  const line = `${key}=${json.access_token}`;
  updated = new RegExp(`^${key}=.*$`, "m").test(updated)
    ? updated.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${updated.trimEnd()}\n${line}\n`;
}
fs.writeFileSync(PATH, updated, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ generated: true, type: debug.data.type, expiresAt: debug.data.expires_at || null, scopes: actualScopes }, null, 2));
