-- 合成データのみ（実データ・実コード・購入トークンなし）。tests/pg/legacy_handoff.pg.test.js が使う
-- 合成データ（実データ・購入トークンなし）。code A：旧購入あり／B：旧購入あり／C：旧購入なし
insert into public.diagnosis_sessions(id,user_id,diagnosis_version,scoring_version,client_session_id,completed_at,item_set_version) values
 ('a1000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','element-v1','s1','a1000000-1111-4000-8000-000000000001',now(),null),  -- U1 が旧版 code A を保存
 ('a1000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','element-v1','s1','a1000000-1111-4000-8000-000000000002',now(),null),  -- U2 も同じ結果 code A を保存（結果の共有）
 ('a1000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','element-v1','s1','a1000000-1111-4000-8000-000000000003',now(),null),  -- U3 が旧版 code C（旧購入なし）
 ('a1000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','ETI-2.0','s1','a1000000-1111-4000-8000-000000000004',now(),'ETI-ITEM-2.0.0'), -- U1 の v2 記録：同じ文字列 code A
 ('a1000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000003','ETI-2.0','s1','a1000000-1111-4000-8000-000000000005',now(),'ETI-ITEM-2.0.0'), -- U3 の v2 記録（解析レポートを購入済み）
 ('a1000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','element-v1','s1','a1000000-1111-4000-8000-000000000006',now(),null);  -- U2 が旧版 code B
insert into public.diagnosis_answers(session_id,answers,encoded_answers) values
 ('a1000000-0000-4000-8000-000000000001','{"q":1}','e2ecodeaaaaaaaaaaaaaaaaaaaaa'),
 ('a1000000-0000-4000-8000-000000000002','{"q":1}','e2ecodeaaaaaaaaaaaaaaaaaaaaa'),
 ('a1000000-0000-4000-8000-000000000003','{"q":1}','e2ecodecccccccccccccccccccc'),
 ('a1000000-0000-4000-8000-000000000004','{"q":1}','e2ecodeaaaaaaaaaaaaaaaaaaaaa'),
 ('a1000000-0000-4000-8000-000000000005','{"q":1}','e2ecodev2vvvvvvvvvvvvvvvvvvv'),
 ('a1000000-0000-4000-8000-000000000006','{"q":1}','e2ecodebbbbbbbbbbbbbbbbbbbbb');
insert into public.purchase_entitlements(id,diagnosis_code_hash,stripe_checkout_session_id,product_type,amount,currency,status) values
 ('e2000000-0000-4000-8000-00000000000a', encode(sha256(convert_to('e2ecodeaaaaaaaaaaaaaaaaaaaaa','UTF8')),'hex'), 'cs_test_E2EA00000000000001','core1',1000,'jpy','active'),
 ('e2000000-0000-4000-8000-00000000000b', encode(sha256(convert_to('e2ecodebbbbbbbbbbbbbbbbbbbbb','UTF8')),'hex'), 'cs_test_E2EB00000000000001','core1',1000,'jpy','active');
-- U3 の v2 記録：解析レポートの権利（新 Checkout）
insert into public.diagnosis_results(session_id,primary_result,scores,diagnosis_code,diagnosis_version,item_set_version,scoring_version,translation_model_version,character_profile_version,mirror_model_version)
 values ('a1000000-0000-4000-8000-000000000005','{"t":"x"}','{"a":1}','e2ecodev2vvvvvvvvvvvvvvvvvvv','ETI-2.0','ETI-ITEM-2.0.0','ETI-SCORE-2.0.0','ETI-TRANS-2.0.0','ETI-CHAR-2.1.0','ETI-MIRROR-2.1.0');
insert into public.complete_orders(id,user_id,diagnosis_session_id,offer,amount,stripe_mode,status,idempotency_key,stripe_checkout_session_id,paid_at,buyer)
 values ('0d000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000005','analysis',1000,'live','paid','e2e-idem-1','cs_live_E2EV2000000000000001',now(),'user');
insert into public.record_entitlements(user_id,diagnosis_session_id,right_type,source_order_id,status)
 values ('00000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000005','analysis','0d000000-0000-4000-8000-000000000001','active');
