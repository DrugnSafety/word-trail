begin;

do $$
declare
  v_constraint record;
  v_definition text;
  v_function regprocedure;
begin
  for v_constraint in
    select c.conrelid::regclass as table_name, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in (
        'public.learning_progress'::regclass,
        'public.learning_starts'::regclass,
        'public.learning_dictations'::regclass
      )
      and cardinality(c.conkey) = 1
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = c.conkey[1] and a.attname = 'video_id'
      )
  loop
    execute format('alter table %s drop constraint %I', v_constraint.table_name, v_constraint.conname);
  end loop;

  foreach v_function in array array[
    'public.start_learning(text,text,text)'::regprocedure,
    'public.save_progress(jsonb,timestamp with time zone)'::regprocedure,
    'public.save_dictation(jsonb,timestamp with time zone)'::regprocedure
  ]
  loop
    v_definition := pg_get_functiondef(v_function);
    v_definition := replace(
      v_definition,
      '^video-[0-9]{2}$',
      '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$'
    );
    execute v_definition;
  end loop;
end $$;

alter table public.learning_progress add constraint learning_progress_video_id_format_check
  check (char_length(video_id) <= 64 and video_id ~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$');
alter table public.learning_starts add constraint learning_starts_video_id_format_check
  check (char_length(video_id) <= 64 and video_id ~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$');
alter table public.learning_dictations add constraint learning_dictations_video_id_format_check
  check (char_length(video_id) <= 64 and video_id ~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$');

create table if not exists public.user_libraries (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  record jsonb not null default '{"version":1,"channels":[],"videos":[]}'::jsonb check (
    jsonb_typeof(record) = 'object'
    and record->>'version' = '1'
    and jsonb_typeof(record->'channels') = 'array'
    and jsonb_typeof(record->'videos') = 'array'
    and jsonb_array_length(record->'channels') <= 100
    and jsonb_array_length(record->'videos') <= 500
    and octet_length(record::text) <= 524288
  ),
  updated_at timestamptz not null default now()
);

alter table public.user_libraries enable row level security;
drop policy if exists user_libraries_own_select on public.user_libraries;
create policy user_libraries_own_select on public.user_libraries for select to authenticated
using (user_id = auth.uid());

create or replace function public.validate_dictation_source_terms()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_word jsonb;
begin
  if jsonb_typeof(new.record->'words') = 'array' then
    for v_word in select value from jsonb_array_elements(new.record->'words') loop
      if v_word ? 'sourceTerm' and (jsonb_typeof(v_word->'sourceTerm') is distinct from 'string'
         or char_length(v_word->>'sourceTerm') > 100) then
        raise exception 'invalid source term' using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists validate_dictation_source_terms on public.learning_dictations;
create trigger validate_dictation_source_terms before insert or update on public.learning_dictations
for each row execute function public.validate_dictation_source_terms();

create or replace function public.save_user_library(p_record jsonb, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_current timestamptz;
  v_now timestamptz := clock_timestamp();
  v_saved public.user_libraries;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_record is null or jsonb_typeof(p_record) is distinct from 'object'
     or p_record->>'version' is distinct from '1'
     or jsonb_typeof(p_record->'channels') is distinct from 'array'
     or jsonb_typeof(p_record->'videos') is distinct from 'array'
     or jsonb_array_length(p_record->'channels') > 100
     or jsonb_array_length(p_record->'videos') > 500
     or octet_length(p_record::text) > 524288 then
    raise exception 'invalid user library' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':library', 1));
  select updated_at into v_current from public.user_libraries where user_id = v_user for update;
  if found then
    if p_expected_updated_at is null or v_current is distinct from p_expected_updated_at then
      raise exception 'library_conflict: reload before saving again' using errcode = '40001';
    end if;
    update public.user_libraries set record = p_record, updated_at = v_now
    where user_id = v_user returning * into v_saved;
  else
    if p_expected_updated_at is not null then
      raise exception 'library_conflict: record no longer exists' using errcode = '40001';
    end if;
    insert into public.user_libraries(user_id, record, updated_at)
    values (v_user, p_record, v_now) returning * into v_saved;
  end if;
  return to_jsonb(v_saved);
end $$;

revoke execute on function public.validate_dictation_source_terms() from public, anon, authenticated;
revoke execute on function public.save_user_library(jsonb,timestamptz) from public, anon;
revoke insert, update, delete on public.user_libraries from anon, authenticated;
grant select on public.user_libraries to authenticated;
grant execute on function public.save_user_library(jsonb,timestamptz) to authenticated;

commit;
