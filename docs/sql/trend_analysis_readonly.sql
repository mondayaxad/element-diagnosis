-- 傾向分析（匿名の集計）：読み取り専用。SELECT だけ。何も書き換えない。
--   ・user_id・session id・diagnosis_code・メール・日時の細かい値は出さない（月単位・件数のみ）
--   ・件数が 5 未満の行は出さない（少人数から個人が推測されないように）
--   ・対象は新診断（ETI-2.0）の保存済み診断。保存していないゲストの診断は含まれない（GA4 の diagnosis_profile で見る）
-- 実行: Supabase の SQL Editor（本番）。読み取り専用の接続でも動く。

-- 1) 月ごとの 元素 / 武器 / 国 の分布
select date_trunc('month', s.completed_at)::date as month,
       r.primary_result->>'element' as element,
       r.primary_result->>'weapon'  as weapon,
       r.primary_result->>'nation'  as nation,
       count(*) as n
from public.diagnosis_sessions s
join public.diagnosis_results r on r.session_id = s.id
where s.diagnosis_version = 'ETI-2.0'
group by 1, 2, 3, 4
having count(*) >= 5
order by 1, n desc;

-- 2) 質問ごとの回答分布（-2〜+2 の人数）。Q001〜Q100
select a.key as item_id, a.value::int as answer, count(*) as n
from public.diagnosis_sessions s
join public.diagnosis_answers d on d.session_id = s.id
cross join lateral jsonb_each_text(d.answers_v2) as a(key, value)
where s.diagnosis_version = 'ETI-2.0' and d.answers_v2 is not null
group by 1, 2
having count(*) >= 5
order by 1, 2;

-- 3) 軸ごとの平均点（v2_scores の構造に依存。先に1行の形を確かめてから使う：
--    select jsonb_pretty(v2_scores) from public.diagnosis_results where v2_scores is not null limit 1;）
