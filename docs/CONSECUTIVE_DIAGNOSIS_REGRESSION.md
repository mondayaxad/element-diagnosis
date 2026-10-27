# 連続2回診断 回帰テスト手順（Preview・実機）

目的：同一ログイン状態でETI v2診断を2回続けて保存したとき、回答コード・DB・MYPAGE表示・結果URL復元が1対1で一致することを確認する。
（過去の「混入」は、MYPAGEのv2リンクに`dv=ETI-2.0`が無かったことと、v2コードを旧版デコーダーで解析したことで説明済み。保存基盤は変更していない。）

## 手順
1. Previewでログインした状態で、ETI v2診断Aを行う（全問「一番左」など極端な回答にすると判別しやすい）。
2. 結果画面で、元素・武器・国家・MIRROR 1位と一致率をメモ（A）。「無料で結果を保存」を押す。
3. ページを閉じずに「もう一度診断する」から診断Bを行う（全問「一番右」）。結果をメモ（B）→保存。
4. MYPAGEを開き、THE RECORDSの2件がそれぞれA・Bのメモと一致することを確認。
5. 各記録の「この結果をもう一度見る」を開き、URLに`dv=ETI-2.0`があり、表示がA・Bそれぞれと一致することを確認。
6. Supabase（Preview）で読み取りのみ実行：
```sql
select s.id, s.client_session_id, s.completed_at, s.mirror_model_version, s.character_profile_version, a.encoded_answers,
       r.v2_rankings->'element'->0->>'name' as top_element,
       r.mirror_snapshot->0->>'name' as top_mirror
from diagnosis_sessions s
join diagnosis_answers a on a.session_id = s.id
join diagnosis_results r on r.session_id = s.id
where s.completed_at > now() - interval '1 hour'
order by s.completed_at desc;
```
7. 2行の`encoded_answers`をそれぞれ `/?dv=ETI-2.0&code=<値>` で開き、`top_element`・`top_mirror`と一致することを確認。
8. 新規保存分の`mirror_model_version`が`ETI-MIRROR-2.0.2`、`character_profile_version`が`ETI-CHAR-2.0.1`であること（旧データは保存時の版のまま）。

## 合格条件
A・Bの4点（メモ／DB／MYPAGE／結果URL）がすべて1対1で一致し、client_session_idが2件で異なること。
