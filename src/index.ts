import { escapeHtml, isStage, normalizePhone, stageLabel, STAGES, whatsappUrl, type StageId } from "./domain";
import { timingSafeEqual } from "node:crypto";

type JsonRecord = Record<string, unknown>;

interface LeadRow {
  id: string;
  meta_lead_id: string;
  form_id: string | null;
  page_id: string | null;
  ad_id: string | null;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  platform: string | null;
  customer_name: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  answers_json: string;
  status: StageId;
  is_quality: number;
  manager: string | null;
  amount: number | null;
  notes: string | null;
  whatsapp_url: string | null;
  google_sheet_row: number | null;
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  quality_sent_at: string | null;
  meta_audience_status: "idle" | "pending" | "sent" | "error";
  meta_audience_error: string | null;
  meta_audience_attempted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MetaLookalikeState {
  id: string | null;
  status: "waiting" | "ready" | "error";
  qualityCount: number;
  lastAttemptAt: string | null;
  error: string | null;
}

interface MetaLead {
  id: string;
  created_time?: string;
  form_id?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
  field_data?: Array<{ name: string; values: string[] }>;
}

const GOOGLE_HEADERS = [
  "ID заявки", "Дата", "Этап", "Качественный", "Имя", "Телефон / WhatsApp", "Email", "Регион",
  "Менеджер", "Сумма", "Комментарий", "Кампания", "Группа объявлений", "Объявление", "Ответы квиза",
  "Meta Lead ID", "Обновлено",
];

const GOOGLE_KANBAN_SHEET_NAME = "Канбан";
const META_LOOKALIKE_NAME = "NurAinur CRM — Похожие 1% — Казахстан";
const META_LOOKALIKE_SETTING_KEY = "meta_lookalike_kz_1pct";
const META_LOOKALIKE_MINIMUM_QUALITY_LEADS = 100;
const GOOGLE_KANBAN_HEADER_COLORS = [
  { red: 0.18, green: 0.36, blue: 0.68 },
  { red: 0.05, green: 0.48, blue: 0.67 },
  { red: 0.55, green: 0.34, blue: 0.73 },
  { red: 0.91, green: 0.42, blue: 0.12 },
  { red: 0.86, green: 0.65, blue: 0.08 },
  { red: 0.12, green: 0.55, blue: 0.38 },
  { red: 0.05, green: 0.48, blue: 0.30 },
  { red: 0.26, green: 0.29, blue: 0.35 },
];
const GOOGLE_KANBAN_CARD_COLORS = [
  { red: 0.91, green: 0.94, blue: 1.00 },
  { red: 0.88, green: 0.97, blue: 0.99 },
  { red: 0.96, green: 0.91, blue: 0.99 },
  { red: 1.00, green: 0.94, blue: 0.88 },
  { red: 1.00, green: 0.98, blue: 0.86 },
  { red: 0.89, green: 0.98, blue: 0.93 },
  { red: 0.86, green: 0.97, blue: 0.91 },
  { red: 0.93, green: 0.94, blue: 0.96 },
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readJson(request: Request, maxBytes = 1_000_000): Promise<unknown> {
  const size = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(size) && size > maxBytes) throw new Error("request_too_large");
  const body = await request.text();
  if (body.length > maxBytes) throw new Error("request_too_large");
  return JSON.parse(body);
}

async function secretEquals(provided: string, expected: string): Promise<boolean> {
  const data = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", data.encode(provided)),
    crypto.subtle.digest("SHA-256", data.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textBase64Url(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

async function hmacBase64Url(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

async function makeSession(secret: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  const payload = textBase64Url(JSON.stringify({ expires }));
  return `${payload}.${await hmacBase64Url(payload, secret)}`;
}

async function validSession(request: Request, secret: string): Promise<boolean> {
  const cookie = request.headers.get("cookie") ?? "";
  const value = cookie.split(/;\s*/).find((item) => item.startsWith("crm_session="))?.slice("crm_session=".length);
  if (!value) return false;
  const [payload, provided] = value.split(".");
  if (!payload || !provided || !(await secretEquals(provided, await hmacBase64Url(payload, secret)))) return false;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))));
    return isRecord(parsed) && typeof parsed.expires === "number" && parsed.expires > Date.now() / 1000;
  } catch {
    return false;
  }
}

function publicLead(row: LeadRow): JsonRecord {
  let answers: unknown = {};
  try { answers = JSON.parse(row.answers_json); } catch { answers = {}; }
  return {
    id: row.id,
    metaLeadId: row.meta_lead_id,
    name: row.customer_name,
    phone: row.phone,
    email: row.email,
    region: row.region,
    whatsappUrl: row.whatsapp_url ?? whatsappUrl(row.phone),
    isTestLead: isMetaTestLead(row),
    status: row.status,
    isQuality: row.is_quality === 1,
    manager: row.manager,
    amount: row.amount,
    notes: row.notes,
    campaignName: row.campaign_name,
    adsetName: row.adset_name,
    adName: row.ad_name,
    answers,
    metaAudience: {
      status: row.meta_audience_status,
      sentAt: row.quality_sent_at,
      attemptedAt: row.meta_audience_attempted_at,
      error: row.meta_audience_error,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isMetaTestLead(lead: Pick<LeadRow, "customer_name" | "phone" | "email">): boolean {
  return [lead.customer_name, lead.phone, lead.email].some((value) => value?.trim().toLowerCase().startsWith("<test lead:") === true);
}

async function getLead(env: Env, id: string): Promise<LeadRow | null> {
  return env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first<LeadRow>();
}

async function listLeads(env: Env): Promise<LeadRow[]> {
  const result = await env.DB.prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT 1000").all<LeadRow>();
  return result.results;
}

async function getIntegrationSetting<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare("SELECT value_json FROM integration_settings WHERE key = ?").bind(key).first<{ value_json: string }>();
  if (!row) return null;
  try { return JSON.parse(row.value_json) as T; } catch { return null; }
}

async function setIntegrationSetting(env: Env, key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO integration_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).bind(key, JSON.stringify(value), now).run();
}

async function addEvent(env: Env, leadId: string, type: string, payload: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO lead_events (id, lead_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), leadId, type, JSON.stringify(payload), new Date().toISOString()).run();
}

function parseMetaLead(value: unknown): MetaLead {
  if (!isRecord(value) || typeof value.id !== "string") throw new Error("invalid_meta_lead");
  const fields: MetaLead["field_data"] = [];
  if (Array.isArray(value.field_data)) {
    for (const entry of value.field_data) {
      if (!isRecord(entry) || typeof entry.name !== "string" || !Array.isArray(entry.values)) continue;
      fields.push({ name: entry.name, values: entry.values.filter((item): item is string => typeof item === "string") });
    }
  }
  return {
    id: value.id,
    created_time: stringValue(value, "created_time"), form_id: stringValue(value, "form_id"),
    ad_id: stringValue(value, "ad_id"), ad_name: stringValue(value, "ad_name"),
    adset_id: stringValue(value, "adset_id"), adset_name: stringValue(value, "adset_name"),
    campaign_id: stringValue(value, "campaign_id"), campaign_name: stringValue(value, "campaign_name"),
    platform: stringValue(value, "platform"), field_data: fields,
  };
}

async function fetchMetaLead(env: Env, leadId: string): Promise<MetaLead> {
  if (!env.META_PAGE_ACCESS_TOKEN) throw new Error("meta_token_missing");
  const fields = "id,created_time,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,field_data";
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(leadId)}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", env.META_PAGE_ACCESS_TOKEN);
  const response = await fetch(url);
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`meta_lead_fetch_failed_${response.status}`);
  return parseMetaLead(body);
}

async function fetchRecentMetaLeads(env: Env): Promise<MetaLead[]> {
  if (!env.META_PAGE_ACCESS_TOKEN || !env.META_FORM_ID) return [];
  const fields = "id,created_time,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,field_data";
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(env.META_FORM_ID)}/leads`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", "100");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.META_PAGE_ACCESS_TOKEN}` } });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || !Array.isArray(body.data)) throw new Error(`meta_leads_poll_failed_${response.status}`);
  return body.data.map(parseMetaLead).filter((lead) => {
    const fullName = lead.field_data?.find((field) => field.name === "full_name")?.values[0] ?? "";
    return !fullName.startsWith("<test lead: dummy data for ");
  });
}

async function saveMetaLead(env: Env, lead: MetaLead, pageId: string | null): Promise<LeadRow> {
  const fields: Record<string, string> = {};
  for (const field of lead.field_data ?? []) fields[field.name] = field.values.join(", ");
  const first = fields.first_name ?? "";
  const last = fields.last_name ?? "";
  const name = fields.full_name ?? fields.name ?? (`${first} ${last}`.trim() || null);
  const phone = fields.phone_number ?? fields.phone ?? null;
  const email = fields.email ?? null;
  const customRegionKey = Object.keys(fields).find((key) => key.includes("городе") && key.includes("районе"));
  const region = fields.city ?? fields.state ?? fields.region ?? (customRegionKey ? fields[customRegionKey] : null) ?? null;
  const normalized = normalizePhone(phone);
  const now = new Date().toISOString();
  const created = lead.created_time ? new Date(lead.created_time).toISOString() : now;
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO leads (
      id, meta_lead_id, form_id, page_id, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
      platform, customer_name, phone, email, region, answers_json, whatsapp_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(meta_lead_id) DO UPDATE SET
      form_id=excluded.form_id, page_id=excluded.page_id, ad_id=excluded.ad_id, ad_name=excluded.ad_name,
      adset_id=excluded.adset_id, adset_name=excluded.adset_name, campaign_id=excluded.campaign_id,
      campaign_name=excluded.campaign_name, platform=excluded.platform, customer_name=excluded.customer_name,
      phone=excluded.phone, email=excluded.email, region=excluded.region, answers_json=excluded.answers_json,
      whatsapp_url=excluded.whatsapp_url, updated_at=excluded.updated_at
  `).bind(
    id, lead.id, lead.form_id ?? null, pageId, lead.ad_id ?? null, lead.ad_name ?? null,
    lead.adset_id ?? null, lead.adset_name ?? null, lead.campaign_id ?? null, lead.campaign_name ?? null,
    lead.platform ?? null, name, normalized ?? phone, email, region, JSON.stringify(fields),
    whatsappUrl(normalized ?? phone), created, now,
  ).run();
  const saved = await env.DB.prepare("SELECT * FROM leads WHERE meta_lead_id = ?").bind(lead.id).first<LeadRow>();
  if (!saved) throw new Error("lead_save_failed");
  return saved;
}

function metaLeadIds(payload: unknown): Array<{ leadId: string; pageId: string | null; formId: string | null }> {
  const result: Array<{ leadId: string; pageId: string | null; formId: string | null }> = [];
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return result;
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    const pageId = typeof entry.id === "string" ? entry.id : null;
    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== "leadgen" || !isRecord(change.value)) continue;
      const leadId = stringValue(change.value, "leadgen_id");
      const formId = stringValue(change.value, "form_id") ?? null;
      if (leadId) result.push({ leadId, pageId, formId });
    }
  }
  return result;
}

async function verifyMetaSignature(raw: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const expected = `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return secretEquals(signature, expected);
}

function telegramKeyboard(lead: LeadRow): JsonRecord {
  const stageButtons = STAGES.map((stage) => ({ text: stage.label, callback_data: `status:${stage.id}:${lead.id}` }));
  const whatsapp = lead.whatsapp_url ?? whatsappUrl(lead.phone);
  return {
    inline_keyboard: [
      [{ text: lead.is_quality ? "★ Качественный" : "☆ Отметить качественным", callback_data: `quality:${lead.is_quality ? 0 : 1}:${lead.id}` }],
      ...Array.from({ length: Math.ceil(stageButtons.length / 2) }, (_, index) => stageButtons.slice(index * 2, index * 2 + 2)),
      ...(whatsapp ? [[{ text: "Открыть WhatsApp", url: whatsapp }]] : []),
    ],
  };
}

function telegramText(lead: LeadRow): string {
  const answers = (() => { try { return JSON.parse(lead.answers_json) as unknown; } catch { return {}; } })();
  const answerLines = isRecord(answers)
    ? Object.entries(answers).map(([key, value]) => `• <b>${escapeHtml(key)}:</b> ${escapeHtml(String(value))}`).join("\n")
    : "";
  return [
    "🏠 <b>Новая заявка — Нурайнур</b>",
    `👤 ${escapeHtml(lead.customer_name ?? "Имя не указано")}`,
    `📞 ${escapeHtml(lead.phone ?? "Телефон не указан")}`,
    lead.region ? `📍 ${escapeHtml(lead.region)}` : "",
    `📌 Этап: <b>${escapeHtml(stageLabel(lead.status))}</b>`,
    lead.campaign_name ? `📣 ${escapeHtml(lead.campaign_name)}` : "",
    answerLines ? `\n<b>Ответы квиза</b>\n${answerLines}` : "",
  ].filter(Boolean).join("\n");
}

async function telegramCall(env: Env, method: string, payload: JsonRecord): Promise<JsonRecord> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("telegram_token_missing");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || body.ok !== true) throw new Error(`telegram_${method}_failed_${response.status}`);
  return body;
}

async function notifyTelegram(env: Env, lead: LeadRow): Promise<void> {
  if (!env.TELEGRAM_CHAT_ID || !env.TELEGRAM_BOT_TOKEN) return;
  const body = await telegramCall(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID, text: telegramText(lead), parse_mode: "HTML",
    reply_markup: telegramKeyboard(lead), disable_web_page_preview: true,
  });
  const result = isRecord(body.result) ? body.result : null;
  const messageId = result && typeof result.message_id === "number" ? String(result.message_id) : null;
  if (messageId) {
    await env.DB.prepare("UPDATE leads SET telegram_chat_id = ?, telegram_message_id = ? WHERE id = ?")
      .bind(env.TELEGRAM_CHAT_ID, messageId, lead.id).run();
  }
}

async function syncTelegramMessage(env: Env, lead: LeadRow): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !lead.telegram_chat_id || !lead.telegram_message_id) return;
  await telegramCall(env, "editMessageText", {
    chat_id: lead.telegram_chat_id,
    message_id: Number(lead.telegram_message_id),
    text: telegramText(lead),
    parse_mode: "HTML",
    reply_markup: telegramKeyboard(lead),
    disable_web_page_preview: true,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeMetaText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function safeIntegrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

async function metaMarketingRequest(env: Env, path: string, init: RequestInit = {}): Promise<JsonRecord> {
  if (!env.META_MARKETING_ACCESS_TOKEN) throw new Error("Не задан токен Marketing API");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.META_MARKETING_ACCESS_TOKEN}`);
  const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`, { ...init, headers });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body)) {
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : `HTTP ${response.status}`;
    throw new Error(`Meta: ${message}`);
  }
  return body;
}

async function metaAudiencePayload(lead: LeadRow): Promise<{ schema: string[]; values: string[] }> {
  const schema: string[] = [];
  const values: string[] = [];
  if (lead.email) {
    schema.push("EMAIL");
    values.push(await sha256Hex(normalizeMetaText(lead.email)));
  }
  const phone = normalizePhone(lead.phone);
  if (phone) {
    schema.push("PHONE");
    values.push(await sha256Hex(phone));
  }
  const nameParts = normalizeMetaText(lead.customer_name ?? "").split(" ").filter(Boolean);
  if (nameParts.length > 0) {
    schema.push("FN");
    values.push(await sha256Hex(nameParts[0]));
  }
  if (nameParts.length > 1) {
    schema.push("LN");
    values.push(await sha256Hex(nameParts[nameParts.length - 1]));
  }
  if (lead.region) {
    schema.push("CT");
    values.push(await sha256Hex(normalizeMetaText(lead.region)));
  }
  if (schema.length > 0) {
    schema.push("COUNTRY");
    values.push(await sha256Hex("kz"));
  }
  return { schema, values };
}

async function qualityLeadCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM leads WHERE is_quality = 1 AND meta_audience_status = 'sent'").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function metaLookalikeStatus(env: Env): Promise<MetaLookalikeState> {
  const saved = await getIntegrationSetting<MetaLookalikeState>(env, META_LOOKALIKE_SETTING_KEY);
  return {
    id: saved?.id ?? null,
    status: saved?.status ?? "waiting",
    qualityCount: await qualityLeadCount(env),
    lastAttemptAt: saved?.lastAttemptAt ?? null,
    error: saved?.error ?? null,
  };
}

async function metaIntegrationStatus(env: Env): Promise<JsonRecord> {
  const counts = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN is_quality = 1 THEN 1 ELSE 0 END) AS quality_count,
      SUM(CASE WHEN meta_audience_status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
      SUM(CASE WHEN meta_audience_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN meta_audience_status = 'error' THEN 1 ELSE 0 END) AS error_count
    FROM leads
  `).first<{ quality_count: number | null; sent_count: number | null; pending_count: number | null; error_count: number | null }>();
  return {
    sourceAudience: {
      id: env.META_CUSTOM_AUDIENCE_ID || null,
      name: "NurAinur CRM - Quality Leads",
      qualityCount: Number(counts?.quality_count ?? 0),
      sentCount: Number(counts?.sent_count ?? 0),
      pendingCount: Number(counts?.pending_count ?? 0),
      errorCount: Number(counts?.error_count ?? 0),
    },
    lookalike: await metaLookalikeStatus(env),
  };
}

async function ensureMetaLookalikeAudience(env: Env, force = false): Promise<MetaLookalikeState> {
  const current = await metaLookalikeStatus(env);
  if (current.id && current.status === "ready") return current;
  if (current.qualityCount < META_LOOKALIKE_MINIMUM_QUALITY_LEADS) {
    const waiting: MetaLookalikeState = {
      ...current,
      status: "waiting",
      error: `Накоплено ${current.qualityCount} из ${META_LOOKALIKE_MINIMUM_QUALITY_LEADS} качественных клиентов`,
    };
    if (current.status !== waiting.status || current.qualityCount !== waiting.qualityCount || current.error !== waiting.error) {
      await setIntegrationSetting(env, META_LOOKALIKE_SETTING_KEY, waiting);
    }
    return waiting;
  }
  if (!force && current.lastAttemptAt && Date.now() - new Date(current.lastAttemptAt).getTime() < 24 * 60 * 60 * 1000) return current;

  const lastAttemptAt = new Date().toISOString();
  try {
    if (!env.META_AD_ACCOUNT_ID || !env.META_CUSTOM_AUDIENCE_ID) throw new Error("Не настроены рекламный аккаунт или исходная аудитория Meta");
    const list = await metaMarketingRequest(
      env,
      `act_${encodeURIComponent(env.META_AD_ACCOUNT_ID)}/customaudiences?fields=id,name,subtype,lookalike_spec&limit=100`,
    );
    const existing = Array.isArray(list.data)
      ? list.data.find((item) => isRecord(item) && item.name === META_LOOKALIKE_NAME && typeof item.id === "string")
      : null;
    let id = existing && isRecord(existing) && typeof existing.id === "string" ? existing.id : null;
    if (!id) {
      const body = new URLSearchParams({
        name: META_LOOKALIKE_NAME,
        subtype: "LOOKALIKE",
        origin_audience_id: env.META_CUSTOM_AUDIENCE_ID,
        lookalike_spec: JSON.stringify({ type: "similarity", country: "KZ", ratio: 0.01 }),
      });
      const created = await metaMarketingRequest(env, `act_${encodeURIComponent(env.META_AD_ACCOUNT_ID)}/customaudiences`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      id = typeof created.id === "string" ? created.id : null;
    }
    if (!id) throw new Error("Meta не вернула ID похожей аудитории");
    const ready: MetaLookalikeState = { id, status: "ready", qualityCount: current.qualityCount, lastAttemptAt, error: null };
    await setIntegrationSetting(env, META_LOOKALIKE_SETTING_KEY, ready);
    return ready;
  } catch (error) {
    const failed: MetaLookalikeState = {
      id: null,
      status: "error",
      qualityCount: current.qualityCount,
      lastAttemptAt,
      error: safeIntegrationError(error),
    };
    await setIntegrationSetting(env, META_LOOKALIKE_SETTING_KEY, failed);
    return failed;
  }
}

async function syncMetaCustomAudience(env: Env, lead: LeadRow): Promise<void> {
  const desiredQuality = lead.is_quality;
  const attemptedAt = new Date().toISOString();
  await env.DB.prepare("UPDATE leads SET meta_audience_status = 'pending', meta_audience_error = NULL, meta_audience_attempted_at = ? WHERE id = ?")
    .bind(attemptedAt, lead.id).run();
  try {
    if (!env.META_CUSTOM_AUDIENCE_ID || !env.META_MARKETING_ACCESS_TOKEN) throw new Error("Интеграция Meta не настроена");
    if (isMetaTestLead(lead)) throw new Error("Тестовые лиды Meta не отправляются в рекламную аудиторию");
    const { schema, values } = await metaAudiencePayload(lead);
    if (schema.length === 0) throw new Error("У клиента нет корректных данных для сопоставления в Meta");
  const body = new URLSearchParams({
    payload: JSON.stringify({ schema, data: [values] }),
  });
    await metaMarketingRequest(env, `${encodeURIComponent(env.META_CUSTOM_AUDIENCE_ID)}/users`, {
    method: desiredQuality === 1 ? "POST" : "DELETE",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
    const completedAt = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE leads SET quality_sent_at = ?, meta_audience_status = ?, meta_audience_error = NULL
      WHERE id = ? AND is_quality = ?
    `).bind(desiredQuality === 1 ? completedAt : null, desiredQuality === 1 ? "sent" : "idle", lead.id, desiredQuality).run();
    if (desiredQuality === 1) await ensureMetaLookalikeAudience(env, true);
    const latest = await getLead(env, lead.id);
    if (latest && latest.is_quality !== desiredQuality) await syncMetaCustomAudience(env, latest);
  } catch (error) {
    await env.DB.prepare("UPDATE leads SET meta_audience_status = 'error', meta_audience_error = ? WHERE id = ? AND is_quality = ?")
      .bind(safeIntegrationError(error), lead.id, desiredQuality).run();
    throw error;
  }
}

function pemBytes(pem: string): ArrayBuffer {
  const value = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function googleAccessToken(env: Env): Promise<string> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) throw new Error("google_credentials_missing");
  const now = Math.floor(Date.now() / 1000);
  const header = textBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = textBase64Url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(env.GOOGLE_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string") throw new Error(`google_auth_failed_${response.status}`);
  return body.access_token;
}

async function googleRequest(env: Env, token: string, path: string, init: RequestInit = {}): Promise<JsonRecord> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}${path}`, { ...init, headers });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body)) {
    const detail = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : "unknown_error";
    throw new Error(`google_sheets_failed_${response.status}_${detail}`);
  }
  return body;
}

async function ensureGoogleSheet(env: Env, token: string): Promise<number> {
  const meta = await googleRequest(env, token, "?fields=sheets.properties(sheetId,title)");
  let sheetId: number | null = null;
  if (Array.isArray(meta.sheets)) {
    for (const sheet of meta.sheets) {
      if (!isRecord(sheet) || !isRecord(sheet.properties)) continue;
      if (sheet.properties.title === env.GOOGLE_SHEET_NAME && typeof sheet.properties.sheetId === "number") sheetId = sheet.properties.sheetId;
    }
  }
  if (sheetId === null) {
    const created = await googleRequest(env, token, ":batchUpdate", {
      method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: env.GOOGLE_SHEET_NAME } } }] }),
    });
    const reply = Array.isArray(created.replies) && isRecord(created.replies[0]) ? created.replies[0] : null;
    const properties = reply && isRecord(reply.addSheet) && isRecord(reply.addSheet.properties) ? reply.addSheet.properties : null;
    if (!properties || typeof properties.sheetId !== "number") throw new Error("google_sheet_create_failed");
    sheetId = properties.sheetId;
  }
  const escaped = env.GOOGLE_SHEET_NAME.replace(/'/g, "''");
  const range = encodeURIComponent(`'${escaped}'!A1:Q1`);
  const current = await googleRequest(env, token, `/values/${range}`);
  if (!Array.isArray(current.values) || current.values.length === 0) {
    await googleRequest(env, token, `/values/${range}?valueInputOption=RAW`, {
      method: "PUT", body: JSON.stringify({ range: `'${escaped}'!A1:Q1`, majorDimension: "ROWS", values: [GOOGLE_HEADERS] }),
    });
    await googleRequest(env, token, ":batchUpdate", {
      method: "POST", body: JSON.stringify({ requests: [
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.12, green: 0.18, blue: 0.15 } }, textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }, bold: true } } }, fields: "userEnteredFormat(backgroundColorStyle,textFormat)" } },
        { setDataValidation: { range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }, rule: { condition: { type: "ONE_OF_LIST", values: STAGES.map((stage) => ({ userEnteredValue: stage.label })) }, strict: true, showCustomUi: true } } },
        { setDataValidation: { range: { sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }, rule: { condition: { type: "BOOLEAN" }, strict: true, showCustomUi: true } } },
        { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: GOOGLE_HEADERS.length } } },
      ] }),
    });
  }
  return sheetId;
}

interface GoogleKanbanSheet {
  sheetId: number;
  rowCount: number;
}

async function ensureGoogleKanbanSheet(env: Env, token: string, requiredRows: number): Promise<GoogleKanbanSheet> {
  const meta = await googleRequest(env, token, "?fields=sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))");
  let sheetId: number | null = null;
  let rowCount = 0;
  let columnCount = 0;
  if (Array.isArray(meta.sheets)) {
    for (const sheet of meta.sheets) {
      if (!isRecord(sheet) || !isRecord(sheet.properties)) continue;
      const properties = sheet.properties;
      if (properties.title !== GOOGLE_KANBAN_SHEET_NAME || typeof properties.sheetId !== "number") continue;
      sheetId = properties.sheetId;
      if (isRecord(properties.gridProperties)) {
        rowCount = typeof properties.gridProperties.rowCount === "number" ? properties.gridProperties.rowCount : 0;
        columnCount = typeof properties.gridProperties.columnCount === "number" ? properties.gridProperties.columnCount : 0;
      }
    }
  }

  const minimumRows = Math.max(100, requiredRows);
  if (sheetId === null) {
    const created = await googleRequest(env, token, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: {
        title: GOOGLE_KANBAN_SHEET_NAME,
        index: 0,
        gridProperties: { rowCount: minimumRows, columnCount: STAGES.length, frozenRowCount: 1, hideGridlines: true },
      } } }] }),
    });
    const reply = Array.isArray(created.replies) && isRecord(created.replies[0]) ? created.replies[0] : null;
    const properties = reply && isRecord(reply.addSheet) && isRecord(reply.addSheet.properties) ? reply.addSheet.properties : null;
    if (!properties || typeof properties.sheetId !== "number") throw new Error("google_kanban_create_failed");
    return { sheetId: properties.sheetId, rowCount: minimumRows };
  }

  const requests: JsonRecord[] = [{ updateSheetProperties: {
    properties: { sheetId, index: 0, gridProperties: { frozenRowCount: 1, hideGridlines: true } },
    fields: "index,gridProperties.frozenRowCount,gridProperties.hideGridlines",
  } }];
  if (rowCount < minimumRows) requests.push({ appendDimension: { sheetId, dimension: "ROWS", length: minimumRows - rowCount } });
  if (columnCount < STAGES.length) requests.push({ appendDimension: { sheetId, dimension: "COLUMNS", length: STAGES.length - columnCount } });
  await googleRequest(env, token, ":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  return { sheetId, rowCount: Math.max(rowCount, minimumRows) };
}

function compactCardValue(value: string, maxLength = 500): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function readableQuizKey(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function googlePhoneText(lead: LeadRow): string {
  if (normalizePhone(lead.phone)) return lead.phone ?? "Телефон не указан";
  if (isMetaTestLead(lead)) return "Тестовый номер — WhatsApp недоступен";
  return lead.phone ? `${lead.phone} — WhatsApp недоступен` : "Телефон не указан";
}

function googleKanbanCard(lead: LeadRow): string {
  const lines = [
    `👤 ${lead.customer_name || "Имя не указано"}`,
    `📞 ${googlePhoneText(lead)}`,
  ];
  if (isMetaTestLead(lead)) lines.push("🧪 Тестовый лид Meta");
  if (lead.email) lines.push(`✉️ ${compactCardValue(lead.email, 150)}`);
  if (lead.region) lines.push(`📍 ${compactCardValue(lead.region, 150)}`);
  if (lead.manager) lines.push(`👨‍💼 ${compactCardValue(lead.manager, 150)}`);
  if (lead.amount !== null) lines.push(`💰 ${new Intl.NumberFormat("ru-RU").format(lead.amount)} ₸`);
  if (lead.is_quality === 1) lines.push("⭐ Качественный клиент");

  let answers: unknown = {};
  try { answers = JSON.parse(lead.answers_json); } catch { answers = {}; }
  const contactKeys = new Set(["full_name", "name", "first_name", "last_name", "phone_number", "phone", "email", "city", "state", "region"]);
  if (isRecord(answers)) {
    for (const [key, value] of Object.entries(answers)) {
      if (contactKeys.has(key) || value === null || value === undefined || String(value).trim() === "") continue;
      lines.push(`• ${readableQuizKey(key)}: ${compactCardValue(String(value), 300)}`);
    }
  }
  if (lead.notes) lines.push(`📝 ${compactCardValue(lead.notes)}`);
  const created = new Date(lead.created_at);
  const createdLabel = Number.isNaN(created.getTime())
    ? lead.created_at
    : new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Qyzylorda", dateStyle: "short", timeStyle: "short" }).format(created);
  lines.push(`🕒 ${createdLabel}`);
  return lines.join("\n");
}

async function syncGoogleKanban(env: Env, token: string): Promise<void> {
  const leads = await listLeads(env);
  const groups = new Map<StageId, LeadRow[]>(STAGES.map((stage) => [stage.id, []]));
  for (const lead of leads) groups.get(lead.status)?.push(lead);
  const cardRows = Math.max(1, ...STAGES.map((stage) => groups.get(stage.id)?.length ?? 0));
  const usedRows = cardRows + 1;
  const { sheetId, rowCount } = await ensureGoogleKanbanSheet(env, token, usedRows);
  const escaped = GOOGLE_KANBAN_SHEET_NAME.replace(/'/g, "''");
  await googleRequest(env, token, `/values/${encodeURIComponent(`'${escaped}'!A1:H`)}:clear`, {
    method: "POST", body: JSON.stringify({}),
  });

  const rows: JsonRecord[] = [];
  rows.push({ values: STAGES.map((stage, index) => ({
    userEnteredValue: { stringValue: `${index + 1}. ${stage.label} (${groups.get(stage.id)?.length ?? 0})` },
    userEnteredFormat: {
      backgroundColorStyle: { rgbColor: GOOGLE_KANBAN_HEADER_COLORS[index] },
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      wrapStrategy: "WRAP",
      textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
      borders: { bottom: { style: "SOLID_MEDIUM", colorStyle: { rgbColor: GOOGLE_KANBAN_HEADER_COLORS[index] } } },
    },
  })) });

  for (let rowIndex = 0; rowIndex < cardRows; rowIndex += 1) {
    rows.push({ values: STAGES.map((stage, stageIndex) => {
      const lead = groups.get(stage.id)?.[rowIndex];
      if (!lead) return { userEnteredValue: { stringValue: "" } };
      const cardWhatsApp = lead.whatsapp_url ?? whatsappUrl(lead.phone);
      const cardValue = googleKanbanCard(lead);
      const phoneText = googlePhoneText(lead);
      const phoneStart = cardValue.indexOf(phoneText);
      const textFormatRuns = cardWhatsApp && phoneStart >= 0 ? [
        { startIndex: phoneStart, format: { link: { uri: cardWhatsApp }, foregroundColorStyle: { rgbColor: { red: 0.07, green: 0.45, blue: 0.26 } }, underline: true } },
        { startIndex: phoneStart + phoneText.length, format: { foregroundColorStyle: { rgbColor: { red: 0.12, green: 0.14, blue: 0.18 } }, underline: false } },
      ] : [];
      return {
        userEnteredValue: { stringValue: cardValue },
        textFormatRuns,
        note: `CRM_ID:${lead.id}\nCRM_REV:${lead.updated_at}\nПереместите ячейку в колонку нужного этапа. Изменение попадёт в CRM в течение минуты.`,
        userEnteredFormat: {
          backgroundColorStyle: { rgbColor: GOOGLE_KANBAN_CARD_COLORS[stageIndex] },
          horizontalAlignment: "LEFT",
          verticalAlignment: "TOP",
          wrapStrategy: "WRAP",
          textFormat: {
            fontSize: 10,
            foregroundColorStyle: { rgbColor: { red: 0.12, green: 0.14, blue: 0.18 } },
            underline: false,
          },
          borders: {
            top: { style: "SOLID", colorStyle: { rgbColor: { red: 0.78, green: 0.81, blue: 0.85 } } },
            bottom: { style: "SOLID", colorStyle: { rgbColor: { red: 0.78, green: 0.81, blue: 0.85 } } },
            left: { style: "SOLID", colorStyle: { rgbColor: { red: 0.78, green: 0.81, blue: 0.85 } } },
            right: { style: "SOLID", colorStyle: { rgbColor: { red: 0.78, green: 0.81, blue: 0.85 } } },
          },
        },
      };
    }) });
  }

  await googleRequest(env, token, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: [
      { repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: STAGES.length },
        cell: { userEnteredFormat: {
          backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: "LEFT", verticalAlignment: "TOP", wrapStrategy: "WRAP",
          textFormat: { bold: false, fontSize: 10, foregroundColorStyle: { rgbColor: { red: 0.12, green: 0.14, blue: 0.18 } }, underline: false },
          borders: { top: { style: "NONE" }, bottom: { style: "NONE" }, left: { style: "NONE" }, right: { style: "NONE" } },
        } },
        fields: "userEnteredFormat",
      } },
      { repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: STAGES.length },
        cell: { note: "", textFormatRuns: [] },
        fields: "note,textFormatRuns",
      } },
      { updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: usedRows, startColumnIndex: 0, endColumnIndex: STAGES.length },
        rows,
        fields: "userEnteredValue,note,textFormatRuns,userEnteredFormat",
      } },
      { updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: STAGES.length },
        properties: { pixelSize: 285 }, fields: "pixelSize",
      } },
      { updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 52 }, fields: "pixelSize",
      } },
      { updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: usedRows },
        properties: { pixelSize: 230 }, fields: "pixelSize",
      } },
    ] }),
  });
}

function googleRow(lead: LeadRow): unknown[] {
  return [
    lead.id, lead.created_at, stageLabel(lead.status), lead.is_quality === 1, lead.customer_name ?? "", lead.phone ?? "",
    lead.email ?? "", lead.region ?? "", lead.manager ?? "", lead.amount ?? "", lead.notes ?? "",
    lead.campaign_name ?? "", lead.adset_name ?? "", lead.ad_name ?? "", lead.answers_json, lead.meta_lead_id, lead.updated_at,
  ];
}

async function applyGooglePhoneLink(env: Env, token: string, sheetId: number, rowNumber: number, lead: LeadRow): Promise<void> {
  const whatsapp = lead.whatsapp_url ?? whatsappUrl(lead.phone);
  if (!lead.phone || !whatsapp) return;
  await googleRequest(env, token, ":batchUpdate", {
    method: "POST", body: JSON.stringify({ requests: [{ updateCells: {
      range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 5, endColumnIndex: 6 },
      rows: [{ values: [{ userEnteredValue: { stringValue: lead.phone }, userEnteredFormat: { textFormat: { link: { uri: whatsapp }, foregroundColorStyle: { rgbColor: { red: 0.07, green: 0.45, blue: 0.26 } }, underline: true } } }] }],
      fields: "userEnteredValue,userEnteredFormat.textFormat",
    } }] }),
  });
}

async function syncGoogleRegistryRow(env: Env, token: string, lead: LeadRow, knownSheetId?: number): Promise<void> {
  const sheetId = knownSheetId ?? await ensureGoogleSheet(env, token);
  const escaped = env.GOOGLE_SHEET_NAME.replace(/'/g, "''");
  let rowNumber = lead.google_sheet_row;
  if (rowNumber) {
    const range = encodeURIComponent(`'${escaped}'!A${rowNumber}:Q${rowNumber}`);
    await googleRequest(env, token, `/values/${range}?valueInputOption=RAW`, {
      method: "PUT", body: JSON.stringify({ range: `'${escaped}'!A${rowNumber}:Q${rowNumber}`, majorDimension: "ROWS", values: [googleRow(lead)] }),
    });
  } else {
    const idColumnRange = encodeURIComponent(`'${escaped}'!A2:A`);
    const idColumn = await googleRequest(env, token, `/values/${idColumnRange}`);
    const values = Array.isArray(idColumn.values) ? idColumn.values : [];
    let rowOffset = 0;
    while (rowOffset < values.length) {
      const row = values[rowOffset];
      if (!Array.isArray(row) || row.length === 0 || row[0] === "" || row[0] === null || row[0] === undefined) break;
      rowOffset += 1;
    }
    rowNumber = rowOffset + 2;
    const targetRange = encodeURIComponent(`'${escaped}'!A${rowNumber}:Q${rowNumber}`);
    await googleRequest(env, token, `/values/${targetRange}?valueInputOption=RAW`, {
      method: "PUT", body: JSON.stringify({ range: `'${escaped}'!A${rowNumber}:Q${rowNumber}`, majorDimension: "ROWS", values: [googleRow(lead)] }),
    });
    await env.DB.prepare("UPDATE leads SET google_sheet_row = ? WHERE id = ?").bind(rowNumber, lead.id).run();
  }
  if (rowNumber) await applyGooglePhoneLink(env, token, sheetId, rowNumber, lead);
}

async function syncGoogleSheet(env: Env, lead: LeadRow): Promise<void> {
  if (!env.GOOGLE_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return;
  const token = await googleAccessToken(env);
  await syncGoogleRegistryRow(env, token, lead);
  await syncGoogleKanbanMoves(env, token, true);
}

function parseGoogleKanbanNote(note: unknown): { id: string; revision: string } | null {
  if (typeof note !== "string") return null;
  const id = note.match(/^CRM_ID:([0-9a-f-]{36})$/mi)?.[1];
  const revision = note.match(/^CRM_REV:(.+)$/mi)?.[1]?.trim();
  return id && revision ? { id, revision } : null;
}

async function syncGoogleKanbanMovesPass(env: Env, token: string): Promise<LeadRow[]> {
  const range = encodeURIComponent(`'${GOOGLE_KANBAN_SHEET_NAME.replace(/'/g, "''")}'!A2:H1001`);
  const sheet = await googleRequest(
    env,
    token,
    `?includeGridData=true&ranges=${range}&fields=sheets(data(startColumn,rowData(values(note))))`,
  );
  const occurrences = new Map<string, Array<{ stage: StageId; revision: string }>>();
  if (Array.isArray(sheet.sheets)) {
    for (const sheetItem of sheet.sheets) {
      if (!isRecord(sheetItem) || !Array.isArray(sheetItem.data)) continue;
      for (const gridData of sheetItem.data) {
        if (!isRecord(gridData) || !Array.isArray(gridData.rowData)) continue;
        const startColumn = typeof gridData.startColumn === "number" ? gridData.startColumn : 0;
        for (const row of gridData.rowData) {
          if (!isRecord(row) || !Array.isArray(row.values)) continue;
          row.values.forEach((cell, relativeColumnIndex) => {
            const columnIndex = startColumn + relativeColumnIndex;
            if (!isRecord(cell) || columnIndex >= STAGES.length) return;
            const metadata = parseGoogleKanbanNote(cell.note);
            if (!metadata) return;
            const stage = STAGES[columnIndex]?.id;
            if (!stage) return;
            const items = occurrences.get(metadata.id) ?? [];
            items.push({ stage, revision: metadata.revision });
            occurrences.set(metadata.id, items);
          });
        }
      }
    }
  }

  const leads = await listLeads(env);
  const moved: LeadRow[] = [];
  for (const lead of leads) {
    const placements = occurrences.get(lead.id);
    if (!placements || placements.length !== 1) continue;
    const placement = placements[0];
    if (placement.revision !== lead.updated_at || placement.stage === lead.status) continue;
    moved.push(await updateLead(env, lead.id, { status: placement.stage }, "google_sheets"));
  }

  if (moved.length > 0) {
    const registrySheetId = await ensureGoogleSheet(env, token);
    for (const lead of moved) {
      const results = await Promise.allSettled([
        syncGoogleRegistryRow(env, token, lead, registrySheetId),
        syncTelegramMessage(env, lead),
      ]);
      for (const result of results) {
        if (result.status === "rejected") console.error(JSON.stringify({ message: "google_move_sync_failed", leadId: lead.id, error: String(result.reason) }));
      }
      await addEvent(env, lead.id, "lead_sync_completed", {
        source: "google_sheets",
        googleSheets: results[0]?.status === "fulfilled",
        telegram: results[1]?.status === "fulfilled",
      });
    }
  }
  return moved;
}

async function syncGoogleKanbanMoves(env: Env, token: string, rebuild = true): Promise<LeadRow[]> {
  const movedById = new Map<string, LeadRow>();
  for (let pass = 0; pass < 2; pass += 1) {
    const moved = await syncGoogleKanbanMovesPass(env, token);
    for (const lead of moved) movedById.set(lead.id, lead);
  }
  if (rebuild) await syncGoogleKanban(env, token);
  return [...movedById.values()];
}

async function updateLead(env: Env, id: string, patch: JsonRecord, source: string): Promise<LeadRow> {
  const before = await getLead(env, id);
  if (!before) throw new Error("lead_not_found");
  const status = patch.status === undefined ? before.status : patch.status;
  if (!isStage(status)) throw new Error("invalid_status");
  const quality = patch.isQuality === undefined ? before.is_quality : patch.isQuality === true ? 1 : patch.isQuality === false ? 0 : -1;
  if (quality === -1) throw new Error("invalid_quality");
  const qualityChanged = quality !== before.is_quality;
  const manager = patch.manager === undefined ? before.manager : typeof patch.manager === "string" ? patch.manager.slice(0, 100) : null;
  const notes = patch.notes === undefined ? before.notes : typeof patch.notes === "string" ? patch.notes.slice(0, 5000) : null;
  const amount = patch.amount === undefined ? before.amount : typeof patch.amount === "number" && Number.isFinite(patch.amount) ? patch.amount : null;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE leads SET status = ?, is_quality = ?, manager = ?, amount = ?, notes = ?,
      meta_audience_status = ?, meta_audience_error = ?, updated_at = ? WHERE id = ?
  `).bind(
    status, quality, manager, amount, notes,
    qualityChanged ? "pending" : before.meta_audience_status,
    qualityChanged ? null : before.meta_audience_error,
    now, id,
  ).run();
  await addEvent(env, id, "lead_updated", { source, before: { status: before.status, isQuality: before.is_quality === 1 }, after: { status, isQuality: quality === 1 } });
  const updated = await getLead(env, id);
  if (!updated) throw new Error("lead_not_found");
  return updated;
}

async function deliverLead(env: Env, lead: LeadRow): Promise<void> {
  const results = await Promise.allSettled([notifyTelegram(env, lead), syncGoogleSheet(env, lead)]);
  for (const result of results) {
    if (result.status === "rejected") console.error(JSON.stringify({ message: "lead_delivery_failed", leadId: lead.id, error: String(result.reason) }));
  }
}

async function deliverIncompleteLead(env: Env, lead: LeadRow): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (!lead.telegram_message_id) tasks.push(notifyTelegram(env, lead));
  if (!lead.google_sheet_row) tasks.push(syncGoogleSheet(env, lead));
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") console.error(JSON.stringify({ message: "lead_delivery_failed", leadId: lead.id, error: String(result.reason) }));
  }
}

async function importMetaLead(env: Env, metaLead: MetaLead, pageId: string | null, source: string): Promise<void> {
  const existing = await env.DB.prepare("SELECT * FROM leads WHERE meta_lead_id = ?").bind(metaLead.id).first<LeadRow>();
  if (existing) {
    await deliverIncompleteLead(env, existing);
    return;
  }
  const lead = await saveMetaLead(env, metaLead, pageId);
  await addEvent(env, lead.id, "meta_lead_received", { metaLeadId: metaLead.id, source });
  await deliverIncompleteLead(env, lead);
}

async function importMetaLeadScheduled(env: Env, metaLead: MetaLead, pageId: string | null, googleToken: string | null): Promise<boolean> {
  const existing = await env.DB.prepare("SELECT * FROM leads WHERE meta_lead_id = ?").bind(metaLead.id).first<LeadRow>();
  if (existing) {
    const tasks: Promise<void>[] = [];
    if (!existing.telegram_message_id) tasks.push(notifyTelegram(env, existing));
    if (!existing.google_sheet_row && googleToken) tasks.push(syncGoogleRegistryRow(env, googleToken, existing));
    const results = await Promise.allSettled(tasks);
    for (const result of results) if (result.status === "rejected") console.error(JSON.stringify({ message: "scheduled_lead_delivery_failed", leadId: existing.id, error: String(result.reason) }));
    return false;
  }
  const lead = await saveMetaLead(env, metaLead, pageId);
  await addEvent(env, lead.id, "meta_lead_received", { metaLeadId: metaLead.id, source: "scheduled_poll" });
  const tasks: Promise<void>[] = [notifyTelegram(env, lead)];
  if (googleToken) tasks.push(syncGoogleRegistryRow(env, googleToken, lead));
  const results = await Promise.allSettled(tasks);
  for (const result of results) if (result.status === "rejected") console.error(JSON.stringify({ message: "scheduled_lead_delivery_failed", leadId: lead.id, error: String(result.reason) }));
  return true;
}

async function handleTelegramWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || !(await secretEquals(request.headers.get("x-telegram-bot-api-secret-token") ?? "", env.TELEGRAM_WEBHOOK_SECRET))) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const payload = await readJson(request);
  if (!isRecord(payload) || !isRecord(payload.callback_query)) return json({ ok: true });
  const callback = payload.callback_query;
  const data = stringValue(callback, "data");
  const callbackId = stringValue(callback, "id");
  if (!data || !callbackId) return json({ ok: true });
  const [action, value, leadId] = data.split(":");
  try {
    const patch: JsonRecord = action === "status" ? { status: value } : action === "quality" ? { isQuality: value === "1" } : {};
    const lead = await updateLead(env, leadId, patch, "telegram");
    ctx.waitUntil(Promise.allSettled([
      syncGoogleSheet(env, lead),
      syncTelegramMessage(env, lead),
      ...(action === "quality" ? [syncMetaCustomAudience(env, lead)] : []),
    ]).then((results) => {
      for (const result of results) if (result.status === "rejected") console.error(JSON.stringify({ message: "telegram_update_sync_failed", leadId, error: String(result.reason) }));
    }));
    ctx.waitUntil(telegramCall(env, "answerCallbackQuery", { callback_query_id: callbackId, text: "Заявка обновлена" }).then(() => undefined));
  } catch (error) {
    ctx.waitUntil(telegramCall(env, "answerCallbackQuery", { callback_query_id: callbackId, text: "Не удалось обновить заявку", show_alert: true }).then(() => undefined));
    console.error(JSON.stringify({ message: "telegram_callback_failed", error: String(error) }));
  }
  return json({ ok: true });
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (path === "/api/login" && request.method === "POST") {
    const body = await readJson(request, 10_000);
    const password = isRecord(body) ? stringValue(body, "password") : undefined;
    if (!password || !(await secretEquals(password, env.CRM_PASSWORD))) return json({ error: "Неверный пароль" }, { status: 401 });
    const session = await makeSession(env.SESSION_SECRET);
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return json({ ok: true }, { headers: { "Set-Cookie": `crm_session=${session}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=43200` } });
  }
  if (path === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, { headers: { "Set-Cookie": "crm_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" } });
  }
  if (!(await validSession(request, env.SESSION_SECRET))) return json({ error: "unauthorized" }, { status: 401 });
  if (path === "/api/leads" && request.method === "GET") {
    const leads = await listLeads(env);
    return json({ stages: STAGES, leads: leads.map(publicLead) });
  }
  if (path === "/api/meta/status" && request.method === "GET") return json(await metaIntegrationStatus(env));
  if (path === "/api/meta/lookalike/retry" && request.method === "POST") {
    return json({ lookalike: await ensureMetaLookalikeAudience(env, true) });
  }
  if (path === "/api/google/kanban/rebuild" && request.method === "POST") {
    if (!env.GOOGLE_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
      return json({ error: "google_credentials_missing" }, { status: 503 });
    }
    const token = await googleAccessToken(env);
    await syncGoogleKanbanMoves(env, token, true);
    return json({ ok: true, sheet: GOOGLE_KANBAN_SHEET_NAME });
  }
  if (path === "/api/google/kanban/sync" && request.method === "POST") {
    if (!env.GOOGLE_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
      return json({ error: "google_credentials_missing" }, { status: 503 });
    }
    const moved = await syncGoogleKanbanMoves(env, await googleAccessToken(env));
    return json({ ok: true, moved: moved.length });
  }
  const retryMatch = path.match(/^\/api\/leads\/([0-9a-f-]+)\/meta\/retry$/i);
  if (retryMatch && request.method === "POST") {
    const current = await getLead(env, retryMatch[1]);
    if (!current) throw new Error("lead_not_found");
    await env.DB.prepare("UPDATE leads SET meta_audience_status = 'pending', meta_audience_error = NULL WHERE id = ?").bind(current.id).run();
    const lead = await getLead(env, current.id);
    if (!lead) throw new Error("lead_not_found");
    ctx.waitUntil(syncMetaCustomAudience(env, lead).catch((error) => {
      console.error(JSON.stringify({ message: "meta_audience_retry_failed", leadId: lead.id, error: String(error) }));
    }));
    return json({ lead: publicLead(lead) });
  }
  const match = path.match(/^\/api\/leads\/([0-9a-f-]+)$/i);
  if (match && request.method === "PATCH") {
    const body = await readJson(request, 20_000);
    if (!isRecord(body)) return json({ error: "invalid_body" }, { status: 400 });
    const lead = await updateLead(env, match[1], body, "dashboard");
    ctx.waitUntil(Promise.allSettled([
      syncGoogleSheet(env, lead),
      syncTelegramMessage(env, lead),
      ...(typeof body.isQuality === "boolean" ? [syncMetaCustomAudience(env, lead)] : []),
    ]).then((results) => {
      for (const result of results) if (result.status === "rejected") console.error(JSON.stringify({ message: "dashboard_update_sync_failed", leadId: lead.id, error: String(result.reason) }));
    }));
    return json({ lead: publicLead(lead) });
  }
  return json({ error: "not_found" }, { status: 404 });
}

async function handleMetaWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode") ?? "";
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && await secretEquals(token, env.META_VERIFY_TOKEN)) return new Response(challenge);
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response("Payload Too Large", { status: 413 });
  if (!env.META_APP_SECRET || !(await verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const payload: unknown = JSON.parse(raw);
  const ids = metaLeadIds(payload);
  for (const item of ids) {
    if (env.META_PAGE_ID && item.pageId !== env.META_PAGE_ID) continue;
    if (env.META_FORM_ID && item.formId !== env.META_FORM_ID) continue;
    try {
      const metaLead = await fetchMetaLead(env, item.leadId);
      ctx.waitUntil(importMetaLead(env, metaLead, item.pageId, "webhook"));
    } catch (error) {
      console.error(JSON.stringify({ message: "meta_lead_processing_failed", metaLeadId: item.leadId, error: String(error) }));
    }
  }
  return new Response("EVENT_RECEIVED");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ ok: true, app: env.APP_NAME });
      if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx, url.pathname);
      if (url.pathname === "/webhooks/meta") return handleMetaWebhook(request, env, ctx);
      if (url.pathname === "/webhooks/telegram") return handleTelegramWebhook(request, env, ctx);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      console.error(JSON.stringify({ message: "request_failed", path: url.pathname, error: message }));
      const status = message === "lead_not_found" ? 404 : message.startsWith("invalid_") ? 400 : message === "request_too_large" ? 413 : 500;
      return json({ error: status === 500 ? "internal_error" : message }, { status });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      let googleToken: string | null = null;
      let shouldRebuildKanban = false;
      if (env.GOOGLE_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
        try {
          googleToken = await googleAccessToken(env);
          const moved = await syncGoogleKanbanMoves(env, googleToken, false);
          shouldRebuildKanban ||= moved.length > 0;
        } catch (error) {
          console.error(JSON.stringify({ message: "google_kanban_poll_failed", error: String(error) }));
        }
      }
      try {
        const leads = await fetchRecentMetaLeads(env);
        for (const lead of leads) {
          const imported = await importMetaLeadScheduled(env, lead, env.META_PAGE_ID || null, googleToken);
          shouldRebuildKanban = imported || shouldRebuildKanban;
        }
      } catch (error) {
        console.error(JSON.stringify({ message: "meta_leads_poll_failed", error: String(error) }));
      }
      try {
        const pending = await env.DB.prepare(`
          SELECT * FROM leads
          WHERE meta_audience_status = 'pending'
            AND (meta_audience_attempted_at IS NULL OR strftime('%s', meta_audience_attempted_at) < strftime('%s', 'now') - 300)
          ORDER BY updated_at ASC LIMIT 20
        `).all<LeadRow>();
        for (const lead of pending.results) {
          try { await syncMetaCustomAudience(env, lead); }
          catch (error) { console.error(JSON.stringify({ message: "meta_audience_pending_retry_failed", leadId: lead.id, error: String(error) })); }
        }
        await ensureMetaLookalikeAudience(env);
      } catch (error) {
        console.error(JSON.stringify({ message: "meta_audience_cron_failed", error: String(error) }));
      }
      if (googleToken) {
        try {
          const moved = await syncGoogleKanbanMoves(env, googleToken, false);
          shouldRebuildKanban ||= moved.length > 0;
          if (shouldRebuildKanban) await syncGoogleKanbanMoves(env, googleToken, true);
        }
        catch (error) { console.error(JSON.stringify({ message: "google_kanban_rebuild_failed", error: String(error) })); }
      }
    })());
  },
} satisfies ExportedHandler<Env>;
