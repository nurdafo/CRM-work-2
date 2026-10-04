import assert from "node:assert/strict";
import test from "node:test";
import { normalizePhone, whatsappUrl } from "../src/domain.ts";

test("normalizes Kazakhstan phone formats for WhatsApp", () => {
  const expected = "77001234567";
  assert.equal(normalizePhone("+7 (700) 123-45-67"), expected);
  assert.equal(normalizePhone("8 700 123 45 67"), expected);
  assert.equal(normalizePhone("7001234567"), expected);
  assert.equal(whatsappUrl("+7 (700) 123-45-67"), `https://wa.me/${expected}`);
  assert.equal(whatsappUrl("8 700 123 45 67"), `https://wa.me/${expected}`);
  assert.equal(whatsappUrl("7001234567"), `https://wa.me/${expected}`);
});

test("rejects Meta test placeholders and malformed phone values", () => {
  assert.equal(whatsappUrl("<test lead: dummy data for phone_number>"), null);
  assert.equal(whatsappUrl("12345"), null);
  assert.equal(whatsappUrl(null), null);
});
