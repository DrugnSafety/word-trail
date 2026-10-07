begin;

create or replace function public.guard_progress_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
  v_source text;
  v_excerpt text;
  v_start integer;
  v_end integer;
  v_index integer;
  v_position integer;
  v_units integer;
  v_char text;
  v_start_boundary boolean;
  v_end_boundary boolean;
  v_text_units integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'progress owner must match authenticated user' using errcode = '42501';
  end if;
  if new.expression_id like 'sentence-%' then
    if new.record->>'kind' is distinct from 'sentence'
       or jsonb_typeof(new.record->'sentenceCard') is distinct from 'object'
       or jsonb_typeof(new.record->'sentenceCard'->'text') is distinct from 'string'
       or char_length(new.record->'sentenceCard'->>'text') not between 1 and 500
       or jsonb_typeof(new.record->'sentenceCard'->'reference') is distinct from 'string'
       or char_length(new.record->'sentenceCard'->>'reference') > 2000
       or jsonb_typeof(new.record->'sentenceCard'->'start') is distinct from 'number'
       or jsonb_typeof(new.record->'sentenceCard'->'end') is distinct from 'number'
       or coalesce(new.record->'sentenceCard'->>'start', '') !~ '^[0-9]{1,4}$'
       or coalesce(new.record->'sentenceCard'->>'end', '') !~ '^[0-9]{1,4}$' then
      raise exception 'invalid sentence card source' using errcode = '22023';
    end if;
    -- Browser offsets count UTF-16 units; PostgreSQL substrings count code points.
    v_source := new.record->'sentenceCard'->>'reference';
    v_start := (new.record->'sentenceCard'->>'start')::integer;
    v_end := (new.record->'sentenceCard'->>'end')::integer;
    v_excerpt := '';
    v_position := 0;
    v_text_units := 0;
    v_start_boundary := v_start = 0;
    v_end_boundary := v_end = 0;
    for v_index in 1..char_length(v_source) loop
      v_char := substring(v_source from v_index for 1);
      v_units := case when ascii(v_char) > 65535 then 2 else 1 end;
      if v_position >= v_start and v_position + v_units <= v_end then
        v_excerpt := v_excerpt || v_char;
        v_text_units := v_text_units + v_units;
      end if;
      v_position := v_position + v_units;
      v_start_boundary := v_start_boundary or v_position = v_start;
      v_end_boundary := v_end_boundary or v_position = v_end;
    end loop;
    if not v_start_boundary or not v_end_boundary or v_text_units > 500
       or v_position > 2000 or v_end <= v_start or v_end > v_position
       or v_excerpt is distinct from new.record->'sentenceCard'->>'text' then
      raise exception 'sentence card must preserve original source' using errcode = '22023';
    end if;
  elsif new.record->>'kind' = 'sentence' then
    raise exception 'sentence card identity required' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if row(new.user_id, new.learner_id, new.video_id, new.scene_id, new.expression_id, new.content_version)
       is distinct from
       row(old.user_id, old.learner_id, old.video_id, old.scene_id, old.expression_id, old.content_version) then
      raise exception 'progress identity cannot be changed' using errcode = '22023';
    end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    new.user_id::text || ':' || new.learner_id || ':' || new.video_id || ':' || new.scene_id, 1
  ));
  if exists (
    select 1 from public.learning_progress
    where user_id = new.user_id and learner_id = new.learner_id
      and video_id = new.video_id and scene_id = new.scene_id
      and expression_id = new.expression_id and content_version = new.content_version
  ) then
    return new;
  end if;
  select count(*) into v_count from public.learning_progress
  where user_id = new.user_id and learner_id = new.learner_id
    and video_id = new.video_id and scene_id = new.scene_id
    and (expression_id like 'sentence-%') = (new.expression_id like 'sentence-%');
  if new.expression_id like 'sentence-%' and v_count >= 20 then
    raise exception 'a scene can store at most twenty sentence cards' using errcode = '54000';
  elsif new.expression_id not like 'sentence-%' and v_count >= 5 then
    raise exception 'a scene can store at most five progress records' using errcode = '54000';
  end if;
  return new;
end $$;

commit;
