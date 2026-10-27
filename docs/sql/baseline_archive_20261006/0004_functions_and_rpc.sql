-- ============================================================
-- 0004 保存 RPC（Preview 専用／未実行）
-- 本文は本番カタログの pg_get_functiondef の出力そのまま（変更していない）。
--   ・どちらも SECURITY INVOKER（RLS が効く）。search_path は public に固定
--   ・戻り値はどちらも uuid（保存した／既存の diagnosis_sessions.id）
-- 実行権限は 0007 で付ける（authenticated だけ）。
-- 依存：0002・0003（制約名 diagnosis_sessions_client_session_id_unique を本文で参照）
-- ============================================================

-- v1（legacy）保存。diagnosis-save.js:421 から呼ばれる
CREATE OR REPLACE FUNCTION public.save_diagnosis_session(p_diagnosis_type text, p_diagnosis_version text, p_scoring_version text, p_client_session_id uuid, p_completed_at timestamp with time zone, p_answers jsonb, p_encoded_answers text, p_primary_result jsonb, p_scores jsonb, p_character_matches jsonb, p_diagnosis_code text, p_ennea_sorted jsonb DEFAULT NULL::jsonb, p_character_db_version text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_existing record;
  v_has_answers boolean;
  v_has_results boolean;
  v_constraint text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated'
      using errcode = '28000';
  end if;

  begin
    insert into public.diagnosis_sessions (
      user_id,
      diagnosis_type,
      diagnosis_version,
      scoring_version,
      client_session_id,
      completed_at
    )
    values (
      v_user_id,
      p_diagnosis_type,
      p_diagnosis_version,
      p_scoring_version,
      p_client_session_id,
      p_completed_at
    )
    returning id into v_session_id;

  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;

    if v_constraint is distinct from
      'diagnosis_sessions_client_session_id_unique'
    then
      raise;
    end if;

    select *
    into v_existing
    from public.diagnosis_sessions
    where client_session_id = p_client_session_id;

    if not found then
      raise exception 'conflicting_session_not_found'
        using errcode = '55000';
    end if;

    if v_existing.user_id <> v_user_id then
      raise exception 'client_session_id_conflict_other_user'
        using errcode = '23505';
    end if;

    select exists (
      select 1
      from public.diagnosis_answers
      where session_id = v_existing.id
    )
    into v_has_answers;

    select exists (
      select 1
      from public.diagnosis_results
      where session_id = v_existing.id
    )
    into v_has_results;

    if v_has_answers and v_has_results then
      return v_existing.id;
    else
      raise exception 'incomplete_existing_session'
        using errcode = 'P0001';
    end if;
  end;

  insert into public.diagnosis_answers (
    session_id,
    answers,
    encoded_answers
  )
  values (
    v_session_id,
    p_answers,
    p_encoded_answers
  );

  insert into public.diagnosis_results (
    session_id,
    primary_result,
    scores,
    character_matches,
    diagnosis_code,
    ennea_sorted,
    character_db_version
  )
  values (
    v_session_id,
    p_primary_result,
    p_scores,
    p_character_matches,
    p_diagnosis_code,
    p_ennea_sorted,
    p_character_db_version
  );

  return v_session_id;
end;
$function$;

-- v2（ETI-2.0）保存。js/eti_v2_save.js:121 から呼ばれる
CREATE OR REPLACE FUNCTION public.save_diagnosis_session_v2(p_diagnosis_type text, p_diagnosis_version text, p_item_set_version text, p_scoring_version text, p_translation_model_version text, p_character_profile_version text, p_mirror_model_version text, p_client_session_id uuid, p_completed_at timestamp with time zone, p_answers_v2 jsonb, p_encoded_answers text, p_personality jsonb, p_style jsonb, p_values jsonb, p_values_centered jsonb, p_element_ranking jsonb, p_weapon_ranking jsonb, p_nation_ranking jsonb, p_mirror_snapshot jsonb, p_diagnosis_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_session public.diagnosis_sessions%rowtype;
  v_answers public.diagnosis_answers%rowtype;
  v_result public.diagnosis_results%rowtype;
  v_session_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_diagnosis_version is distinct from 'ETI-2.0' then
    raise exception 'unsupported_diagnosis_version' using errcode = '22023';
  end if;

  -- Serialize retries for the same client_session_id.
  perform pg_advisory_xact_lock(hashtextextended(p_client_session_id::text, 0));

  select * into v_session
  from public.diagnosis_sessions
  where client_session_id = p_client_session_id;

  if found then
    if v_session.user_id is distinct from v_user_id then
      raise exception 'session_conflict' using errcode = '23505';
    end if;

    select * into v_answers
    from public.diagnosis_answers
    where session_id = v_session.id;

    select * into v_result
    from public.diagnosis_results
    where session_id = v_session.id;

    if v_answers.id is null or v_result.id is null then
      raise exception 'incomplete_existing_session' using errcode = '23514';
    end if;

    if v_session.diagnosis_type is distinct from p_diagnosis_type
       or v_session.diagnosis_version is distinct from p_diagnosis_version
       or v_session.item_set_version is distinct from p_item_set_version
       or v_session.scoring_version is distinct from p_scoring_version
       or v_result.translation_model_version is distinct from p_translation_model_version
       or v_result.character_profile_version is distinct from p_character_profile_version
       or v_result.mirror_model_version is distinct from p_mirror_model_version
       or v_answers.encoded_answers is distinct from p_encoded_answers then
      raise exception 'idempotency_payload_mismatch' using errcode = '23514';
    end if;

    return v_session.id;
  end if;

  begin
    insert into public.diagnosis_sessions (
      user_id,
      diagnosis_type,
      diagnosis_version,
      item_set_version,
      scoring_version,
      client_session_id,
      completed_at
    ) values (
      v_user_id,
      p_diagnosis_type,
      p_diagnosis_version,
      p_item_set_version,
      p_scoring_version,
      p_client_session_id,
      p_completed_at
    )
    returning id into v_session_id;
  exception when unique_violation then
    -- A row hidden by RLS or created outside this RPC must not be treated as success.
    raise exception 'session_conflict' using errcode = '23505';
  end;

  insert into public.diagnosis_answers (
    session_id,
    answers,
    answers_v2,
    encoded_answers
  ) values (
    v_session_id,
    '{}'::jsonb,
    p_answers_v2,
    p_encoded_answers
  );

  insert into public.diagnosis_results (
    session_id,
    primary_result,
    scores,
    character_matches,
    diagnosis_code,
    diagnosis_version,
    item_set_version,
    scoring_version,
    translation_model_version,
    character_profile_version,
    mirror_model_version,
    v2_scores,
    v2_rankings,
    mirror_snapshot
  ) values (
    v_session_id,
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    p_diagnosis_code,
    p_diagnosis_version,
    p_item_set_version,
    p_scoring_version,
    p_translation_model_version,
    p_character_profile_version,
    p_mirror_model_version,
    jsonb_build_object(
      'personality', p_personality,
      'style', p_style,
      'values', p_values,
      'valuesCentered', p_values_centered
    ),
    jsonb_build_object(
      'element', p_element_ranking,
      'weapon', p_weapon_ranking,
      'nation', p_nation_ranking
    ),
    p_mirror_snapshot
  );

  return v_session_id;
end;
$function$;

-- 関数を作った直後は PUBLIC に実行権限が付く（PostgreSQL の既定）。0007 で付け直すまでの間も
-- 不要な実行を許さないよう、ここで外しておく。
revoke all on function public.save_diagnosis_session(text, text, text, uuid, timestamptz, jsonb, text, jsonb, jsonb, jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_diagnosis_session_v2(text, text, text, text, text, text, text, uuid, timestamptz, jsonb, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
