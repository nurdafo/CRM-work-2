INSERT OR IGNORE INTO leads (
  id, meta_lead_id, customer_name, phone, email, region, answers_json, status,
  is_quality, whatsapp_url, campaign_name, created_at, updated_at
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'test-lead-1', 'Айдар С.', '77001234567', 'aidar@example.kz', 'Алматы', '{"Желаемая площадь":"60 м²","Бюджет":"10–15 млн ₸","Участок":"Есть"}', 'new', 1, 'https://wa.me/77001234567', 'Модульные дома — Алматы', datetime('now'), datetime('now')),
  ('22222222-2222-4222-8222-222222222222', 'test-lead-2', 'Алия К.', '77007654321', NULL, 'Астана', '{"Желаемая площадь":"80 м²","Срок строительства":"Весна"}', 'calculation', 0, 'https://wa.me/77007654321', 'Модульные дома — Казахстан', datetime('now', '-1 day'), datetime('now')),
  ('33333333-3333-4333-8333-333333333333', 'test-lead-3', 'Марат Т.', '77005550101', NULL, 'Каскелен', '{"Желаемая площадь":"45 м²","Участок":"Есть"}', 'qualification', 0, 'https://wa.me/77005550101', 'Модульные дома — Алматы', datetime('now', '-2 day'), datetime('now'));
