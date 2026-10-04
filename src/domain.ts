export const STAGES = [
  { id: "new", label: "Новая заявка" },
  { id: "contacted", label: "Связались" },
  { id: "calculation", label: "Расчёт" },
  { id: "qualification", label: "Квалификация" },
  { id: "measurement", label: "Замер" },
  { id: "contract", label: "Договор" },
  { id: "sale", label: "Продажа" },
  { id: "delivery", label: "Доставка" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export function isStage(value: unknown): value is StageId {
  return typeof value === "string" && STAGES.some((stage) => stage.id === value);
}

export function stageLabel(id: string): string {
  return STAGES.find((stage) => stage.id === id)?.label ?? id;
}

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function whatsappUrl(value: string | null | undefined): string | null {
  const digits = normalizePhone(value);
  return digits ? `https://wa.me/${digits}` : null;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] ?? char);
}
