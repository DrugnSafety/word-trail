-- Add selected-vocabulary metadata validation to an existing dictation installation.
-- Apply once after 202609250001_add_dictations.sql. Fresh projects use ../schema.sql.
begin;

create or replace function public.guard_dictation_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_word jsonb;
  v_value jsonb;
  v_result jsonb;
  v_mode text;
  v_text text;
  v_selected_keys text[] := array[]::text[];
  v_word_keys text[] := array[]::text[];
  v_normalized_term text;
  v_source_indexes integer[];
  v_count integer;
  v_modern_vocabulary boolean := new.record ? 'selectedKeys';
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'dictation owner must match authenticated user' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and row(new.user_id, new.learner_id, new.video_id, new.scene_id, new.content_version)
     is distinct from row(old.user_id, old.learner_id, old.video_id, old.scene_id, old.content_version) then
    raise exception 'dictation identity cannot be changed' using errcode = '22023';
  end if;
  if jsonb_typeof(new.record->'words') is distinct from 'array' then
    raise exception 'invalid dictation words' using errcode = '22023';
  end if;
  if new.record ? 'selectedKeys' then
    if jsonb_typeof(new.record->'selectedKeys') is distinct from 'array'
       or jsonb_array_length(new.record->'selectedKeys') > 200 then
      raise exception 'invalid selected vocabulary keys' using errcode = '22023';
    end if;
    for v_value in select value from jsonb_array_elements(new.record->'selectedKeys') loop
      if jsonb_typeof(v_value) is distinct from 'string' then
        raise exception 'invalid selected vocabulary key' using errcode = '22023';
      end if;
      v_text := v_value #>> '{}';
      if char_length(v_text) > 200 or v_text !~ '^word:.+' or array_position(v_selected_keys, v_text) is not null then
        raise exception 'invalid or duplicate selected vocabulary key' using errcode = '22023';
      end if;
      v_selected_keys := array_append(v_selected_keys, v_text);
    end loop;
  end if;
  for v_word in select value from jsonb_array_elements(new.record->'words') loop
    if jsonb_typeof(v_word) is distinct from 'object'
       or jsonb_typeof(v_word->'key') is distinct from 'string' or char_length(v_word->>'key') > 200
       or jsonb_typeof(v_word->'term') is distinct from 'string' or char_length(v_word->>'term') > 100
       or jsonb_typeof(v_word->'kind') is distinct from 'string'
       or v_word->>'kind' not in ('replace', 'missing', 'extra', 'manual')
       or jsonb_typeof(v_word->'typed') is distinct from 'string' or char_length(v_word->>'typed') > 100
       or jsonb_typeof(v_word->'sourceIndex') is distinct from 'number'
       or (v_word->>'sourceIndex') !~ '^-?[0-9]+$'
       or (v_word->>'sourceIndex')::numeric < -1 or (v_word->>'sourceIndex')::numeric > 10000
       or jsonb_typeof(v_word->'studied') is distinct from 'boolean'
       or jsonb_typeof(v_word->'studyAttempts') is distinct from 'number'
       or (v_word->>'studyAttempts') !~ '^[0-9]+$'
       or (v_word->>'studyAttempts')::numeric > 2147483647
       or jsonb_typeof(v_word->'lastAnswer') is distinct from 'string' or char_length(v_word->>'lastAnswer') > 2000 then
      raise exception 'invalid dictation word' using errcode = '22023';
    end if;
    if v_modern_vocabulary then
      v_normalized_term := lower(btrim(replace(replace(replace(
        normalize(v_word->>'term', NFKC), '‘', ''''), '’', ''''), 'ʼ', '''')));
      v_text := 'word:' || v_normalized_term;
      if v_normalized_term = '' or v_word->>'key' <> v_text or array_position(v_word_keys, v_text) is not null then
        raise exception 'modern vocabulary words require unique canonical keys' using errcode = '22023';
      end if;
      v_word_keys := array_append(v_word_keys, v_text);
    end if;
    if v_word ? 'sourceIndexes' then
      if jsonb_typeof(v_word->'sourceIndexes') is distinct from 'array'
         or jsonb_array_length(v_word->'sourceIndexes') > 200 then
        raise exception 'invalid source indexes' using errcode = '22023';
      end if;
      v_source_indexes := array[]::integer[];
      for v_value in select value from jsonb_array_elements(v_word->'sourceIndexes') loop
        if jsonb_typeof(v_value) is distinct from 'number' or (v_value #>> '{}') !~ '^-?[0-9]+$'
           or (v_value #>> '{}')::numeric < -1 or (v_value #>> '{}')::numeric > 10000
           or array_position(v_source_indexes, (v_value #>> '{}')::integer) is not null then
          raise exception 'invalid or duplicate source index' using errcode = '22023';
        end if;
        v_source_indexes := array_append(v_source_indexes, (v_value #>> '{}')::integer);
      end loop;
    end if;
    if v_word ? 'registeredAt' and (jsonb_typeof(v_word->'registeredAt') is distinct from 'string'
       or char_length(v_word->>'registeredAt') > 40
       or (v_word->>'registeredAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$') then
      raise exception 'invalid vocabulary registration timestamp' using errcode = '22023';
    end if;
    if v_word ? 'registeredAt' then perform (v_word->>'registeredAt')::timestamptz; end if;
    if v_word ? 'meaningKo' and (jsonb_typeof(v_word->'meaningKo') is distinct from 'string'
       or char_length(v_word->>'meaningKo') > 300) then
      raise exception 'invalid Korean meaning' using errcode = '22023';
    end if;
    if v_word ? 'lastPracticedAt' and (jsonb_typeof(v_word->'lastPracticedAt') is distinct from 'string'
       or char_length(v_word->>'lastPracticedAt') > 40
       or (v_word->>'lastPracticedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$') then
      raise exception 'invalid last-practiced timestamp' using errcode = '22023';
    end if;
    if v_word ? 'lastPracticedAt' then perform (v_word->>'lastPracticedAt')::timestamptz; end if;
    if v_word ? 'practice' then
      if jsonb_typeof(v_word->'practice') is distinct from 'object' then
        raise exception 'invalid vocabulary practice' using errcode = '22023';
      end if;
      for v_mode, v_result in select key, value from jsonb_each(v_word->'practice') loop
        if v_mode not in ('spelling', 'cloze', 'meaning', 'audio', 'reading')
           or jsonb_typeof(v_result) is distinct from 'object'
           or not (v_result ?& array['attempts','correct','lastPracticedAt'])
           or jsonb_typeof(v_result->'attempts') is distinct from 'number'
           or (v_result->>'attempts') !~ '^[0-9]+$' or (v_result->>'attempts')::numeric > 2147483647
           or jsonb_typeof(v_result->'correct') is distinct from 'number'
           or (v_result->>'correct') !~ '^[0-9]+$' or (v_result->>'correct')::numeric > (v_result->>'attempts')::numeric
           or jsonb_typeof(v_result->'lastPracticedAt') is distinct from 'string'
           or char_length(v_result->>'lastPracticedAt') > 40
           or (v_result->>'lastPracticedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
          raise exception 'invalid vocabulary practice result' using errcode = '22023';
        end if;
        perform (v_result->>'lastPracticedAt')::timestamptz;
      end loop;
    end if;
    if v_word ? 'review' and (jsonb_typeof(v_word->'review') is distinct from 'object'
       or not ((v_word->'review') ?& array['step','dueAt','lastReviewedDate'])
       or jsonb_typeof(v_word#>'{review,step}') is distinct from 'number'
       or (v_word#>>'{review,step}') !~ '^[0-3]$'
       or jsonb_typeof(v_word#>'{review,dueAt}') is distinct from 'string'
       or char_length(v_word#>>'{review,dueAt}') > 40
       or (v_word#>>'{review,dueAt}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
       or jsonb_typeof(v_word#>'{review,lastReviewedDate}') is distinct from 'string'
       or (v_word#>>'{review,lastReviewedDate}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'invalid vocabulary review schedule' using errcode = '22023';
    end if;
    if v_word ? 'review' then
      perform (v_word#>>'{review,dueAt}')::timestamptz;
      perform (v_word#>>'{review,lastReviewedDate}')::date;
    end if;
  end loop;
  if v_modern_vocabulary and exists (
    select 1 from unnest(v_selected_keys) selected_key
    where array_position(v_word_keys, selected_key) is null
  ) then
    raise exception 'selected vocabulary key must reference a stored word' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(
      new.user_id::text || ':' || new.learner_id || ':' || new.video_id || ':' || new.scene_id, 1
    ));
    if exists (
      select 1 from public.learning_dictations where user_id = new.user_id and learner_id = new.learner_id
        and video_id = new.video_id and scene_id = new.scene_id and content_version = new.content_version
    ) then
      return new;
    end if;
    select count(*) into v_count from public.learning_dictations
    where user_id = new.user_id and learner_id = new.learner_id
      and video_id = new.video_id and scene_id = new.scene_id;
    if v_count >= 5 then
      raise exception 'a scene can store at most five dictation versions' using errcode = '54000';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.guard_dictation_write() from public, anon, authenticated;

commit;

