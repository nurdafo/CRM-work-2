import fs from "node:fs";

const DEV_VARS_PATH = ".dev.vars";
const GRAPH_VERSION = "v26.0";
const PAGE_ID = "1076700328863815";
const FORM_ID = "28378756615092458";
const AD_ACCOUNT_ID = "1623369248931085";
const BUSINESS_ID = "1076837885516726";

const source = fs.readFileSync(DEV_VARS_PATH, "utf8");
const vars = {};
for (const line of source.split(/\r?\n/)) {
  const index = line.indexOf("=");
  if (index <= 0 || line.trimStart().startsWith("#")) continue;
  const key = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  vars[key] = value;
}

if (!vars.META_MARKETING_ACCESS_TOKEN) throw new Error("META_MARKETING_ACCESS_TOKEN is empty");
if (!vars.META_APP_SECRET) throw new Error("META_APP_SECRET is empty");

const graph = async (path, token, init = {}) => {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    const error = json.error || {};
    throw new Error(`Meta API ${path}: ${error.message || response.statusText} (code ${error.code || response.status})`);
  }
  return json;
};

const marketingToken = vars.META_MARKETING_ACCESS_TOKEN;
const identity = await graph("me?fields=id,name", marketingToken);
const requestedForm = await graph(`${FORM_ID}?fields=id,name,status,page`, marketingToken).catch(() => null);
let resolvedPageId = PAGE_ID;
let pageToken = identity.id === PAGE_ID ? marketingToken : null;
let availablePages = [];
let availableForms = [];

if (!pageToken) {
  const accounts = await graph("me/accounts?fields=id,name,access_token,tasks&limit=100", marketingToken);
  availablePages = accounts.data || [];
  const page = accounts.data?.find((item) => item.id === PAGE_ID);
  pageToken = page?.access_token || null;

  if (!pageToken) {
    const uniquePages = [...new Map(availablePages.map((page) => [page.id, page])).values()];
    const formResults = await Promise.allSettled(uniquePages.map(async (pageItem) => ({
      page: { id: pageItem.id, name: pageItem.name },
      forms: (await graph(`${pageItem.id}/leadgen_forms?fields=id,name,status&limit=100`, pageItem.access_token)).data || [],
      token: pageItem.access_token,
    })));
    availableForms = formResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const formOwner = availableForms.find((item) => item.forms.some((form) => form.id === FORM_ID));
    if (formOwner) {
      resolvedPageId = formOwner.page.id;
      pageToken = formOwner.token;
    }
  }
}

if (!pageToken) {
  const businessEdges = await Promise.allSettled([
    graph(`${BUSINESS_ID}/owned_pages?fields=id,name,access_token,tasks&limit=100`, marketingToken),
    graph(`${BUSINESS_ID}/client_pages?fields=id,name,access_token,tasks&limit=100`, marketingToken),
    graph(`${PAGE_ID}?fields=id,name,access_token,tasks`, marketingToken),
  ]);
  const businessPages = businessEdges.flatMap((result) => result.status === "fulfilled"
    ? (result.value.data || [result.value])
    : []);
  const page = businessPages.find((item) => item.id === PAGE_ID && item.access_token);
  pageToken = page?.access_token || null;
  if (!pageToken) {
    console.log(JSON.stringify({
      identity: { id: identity.id, name: identity.name },
      requestedForm: requestedForm ? { id: requestedForm.id, name: requestedForm.name, status: requestedForm.status, page: requestedForm.page } : null,
      availablePages: [...availablePages, ...businessPages].map(({ id, name }) => ({ id, name })),
      availableForms: availableForms.map(({ page, forms }) => ({ page, forms })),
    }, null, 2));
    throw new Error(`Page ${PAGE_ID} is not available to this token`);
  }
}

const replacement = `META_PAGE_ACCESS_TOKEN=${pageToken}`;
const updated = /^META_PAGE_ACCESS_TOKEN=.*$/m.test(source)
  ? source.replace(/^META_PAGE_ACCESS_TOKEN=.*$/m, replacement)
  : `${source.trimEnd()}\n${replacement}\n`;
fs.writeFileSync(DEV_VARS_PATH, updated, { encoding: "utf8", mode: 0o600 });

const subscriptionBody = new URLSearchParams({ subscribed_fields: "leadgen" });
const subscription = await graph(`${resolvedPageId}/subscribed_apps`, pageToken, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: subscriptionBody,
});

const [form, adAccount, appSubscriptions, pageSubscriptions, tokenDebug, businessApps, userPermissions] = await Promise.all([
  graph(`${FORM_ID}?fields=id,name,status`, pageToken),
  graph(`act_${AD_ACCOUNT_ID}?fields=id,name,account_status`, marketingToken),
  graph("1378442990934699/subscriptions", `1378442990934699|${vars.META_APP_SECRET}`),
  graph(`${resolvedPageId}/subscribed_apps?fields=id,name,subscribed_fields`, pageToken),
  graph(`debug_token?input_token=${encodeURIComponent(marketingToken)}`, `1378442990934699|${vars.META_APP_SECRET}`),
  graph(`${BUSINESS_ID}/owned_apps?fields=id,name&limit=100`, marketingToken),
  graph("me/permissions", marketingToken),
]);

console.log(JSON.stringify({
  identity: { id: identity.id, name: identity.name },
  pageTokenDerived: identity.id !== PAGE_ID,
  pageSubscribedToLeadgen: subscription.success === true,
  pageInstalledApps: (pageSubscriptions.data || []).map(({ id, name, subscribed_fields }) => ({ id, name, subscribed_fields })),
  appLeadgenSubscription: appSubscriptions.data?.find((item) => item.object === "page") || null,
  form: { id: form.id, name: form.name, status: form.status },
  adAccount: { id: adAccount.id, name: adAccount.name, accountStatus: adAccount.account_status },
  token: {
    valid: tokenDebug.data?.is_valid === true,
    type: tokenDebug.data?.type,
    expiresAt: tokenDebug.data?.expires_at ? new Date(tokenDebug.data.expires_at * 1000).toISOString() : null,
    scopes: tokenDebug.data?.scopes || [],
  },
  appOwnedByBusiness: businessApps.data?.some((app) => app.id === "1378442990934699") === true,
  metadataPermission: userPermissions.data?.find((permission) => permission.permission === "pages_manage_metadata") || null,
}, null, 2));
