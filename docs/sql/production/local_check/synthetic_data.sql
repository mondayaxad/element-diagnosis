-- 合成データ（本番の件数だけを再現。実データではない）
-- auth.users 3 → handle_new_user により profiles 3
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
update public.profiles set newsletter_opted_in = true, newsletter_opted_in_at = '2026-08-01T00:00:00Z' where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set newsletter_opted_in = false where id = '00000000-0000-4000-8000-000000000002';
-- 8 sessions / answers / results（利用者3人に配分）
insert into public.diagnosis_sessions(id, user_id, diagnosis_version, scoring_version, client_session_id, completed_at)
select ('00000000-0000-4000-9000-00000000000'||g)::uuid,
       ('00000000-0000-4000-8000-00000000000'||(1 + g % 3))::uuid, 'v1', 's1',
       ('00000000-0000-4000-a000-00000000000'||g)::uuid, '2026-08-10T00:00:00Z'::timestamptz + (g||' days')::interval
from generate_series(1,8) g;
insert into public.diagnosis_answers(session_id, answers) select id, '{"q1":3}'::jsonb from public.diagnosis_sessions;
insert into public.diagnosis_results(session_id, primary_result, scores, diagnosis_code)
select s.id, '{"t":"x"}', '{"a":1}', 'SYNTHCODE' || right(s.id::text, 1) from public.diagnosis_sessions s;
-- purchase_entitlements 9：live 1（¥1,000）・test 8（各¥1,000）、すべて active・core1
insert into public.purchase_entitlements(diagnosis_code_hash, stripe_checkout_session_id, product_type, amount, currency, status, created_at, purchased_at)
select encode(sha256(convert_to('SYNTHCODE'||g, 'UTF8')), 'hex'),
       case when g = 1 then 'cs_live_SYNTHETIC0001' else 'cs_test_SYNTHETIC000'||g end, 'core1', 1000, 'jpy', 'active',
       timestamptz '2026-09-01 00:00:00+00' + g * interval '1 day', timestamptz '2026-09-01 00:00:00+00' + g * interval '1 day'  -- 基準の締め切り 2026-10-06 より前
from generate_series(1,9) g;
