-- Fresh-project bootstrap only. This is not an upgrade migration:
-- CREATE TABLE IF NOT EXISTS does not add new CHECK constraints to existing tables.
begin;

create table if not exists public.profiles (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  learner_id text not null default 'default' check (learner_id = 'default'),
  nickname text not null default '학습자1' check (char_length(nickname) between 1 and 40),
  updated_at timestamptz not null default now(),
  primary key (user_id, learner_id)
);

create table if not exists public.learning_progress (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  learner_id text not null default 'default' check (learner_id = 'default'),
  video_id text not null check (char_length(video_id) <= 64 and video_id ~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$'),
  scene_id text not null check (char_length(scene_id) <= 64 and scene_id ~ '^(s[0-9]{3}|c[0-9]{4})$'),
  expression_id text not null check (char_length(expression_id) <= 80 and expression_id ~ '^[a-z0-9][a-z0-9-]*$'),
  content_version text not null check (char_length(content_version) <= 64 and content_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  record jsonb not null check (
    jsonb_typeof(record) = 'object'
    and record ?& array['learnerId','videoId','sceneId','expressionId','contentVersion','spelling','reading','review','updatedAt']
    and record->>'learnerId' = learner_id
    and record->>'videoId' = video_id
    and record->>'sceneId' = scene_id
    and record->>'expressionId' = expression_id
    and record->>'contentVersion' = content_version
    and jsonb_typeof(record->'spelling') = 'object'
    and jsonb_typeof(record->'reading') = 'object'
    and jsonb_typeof(record->'review') = 'object'
    and char_length(coalesce(record#>>'{spelling,lastAnswer}', '')) <= 500
    and octet_length(record::text) <= 8192
  ),
  updated_at timestamptz not null default now(),
  primary key (user_id, learner_id, video_id, scene_id, expression_id, content_version),
  foreign key (user_id, learner_id) references public.profiles(user_id, learner_id) on delete cascade
);

create table if not exists public.learning_starts (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  learner_id text not null default 'default' check (learner_id = 'default'),
  video_id text not null check (char_length(video_id) <= 64 and video_id ~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$'),
  scene_id text not null check (char_length(scene_id) <= 64 and scene_id ~ '^(s[0-9]{3}|c[0-9]{4})$'),
  started_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  primary key (user_id, learner_id, video_id, scene_id),
  foreign key (user_id, learner_id) references public.profiles(user_id, learner_id) on delete cascade
);

alter table public.learning_progress
  drop constraint if exists learning_progress_approved_start_fk;
alter table public.learning_progress
  add constraint learning_progress_approved_start_fk
  foreign key (user_id, learner_id, video_id, scene_id)
  references public.learning_starts(user_id, learner_id, video_id, scene_id)
  on delete cascade;

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

drop trigger if exists before_progress_write on public.learning_progress;
create trigger before_progress_write before insert or update on public.learning_progress
for each row execute function public.guard_progress_write();

create table if not exists public.learning_dictations (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  learner_id text not null default 'default' check (learner_id = 'default'),
  video_id text not null check (char_length(video_id) <= 64 and video_id ~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$'),
  scene_id text not null check (char_length(scene_id) <= 64 and scene_id ~ '^(s[0-9]{3}|c[0-9]{4})$'),
  content_version text not null check (char_length(content_version) <= 64 and content_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  record jsonb not null check (
    jsonb_typeof(record) = 'object'
    and record ?& array['learnerId','videoId','sceneId','contentVersion','reference','answer','attempts','words','updatedAt']
    and record->>'learnerId' = learner_id
    and record->>'videoId' = video_id
    and record->>'sceneId' = scene_id
    and record->>'contentVersion' = content_version
    and jsonb_typeof(record->'reference') = 'string'
    and char_length(record->>'reference') <= 2000
    and jsonb_typeof(record->'answer') = 'string'
    and char_length(record->>'answer') <= 2000
    and jsonb_typeof(record->'attempts') = 'number'
    and (record->>'attempts') ~ '^[0-9]+$'
    and (record->>'attempts')::numeric <= 2147483647
    and jsonb_typeof(record->'words') = 'array'
    and jsonb_array_length(record->'words') <= 200
    and octet_length(record::text) <= 65536
  ),
  updated_at timestamptz not null default now(),
  primary key (user_id, learner_id, video_id, scene_id, content_version),
  foreign key (user_id, learner_id) references public.profiles(user_id, learner_id) on delete cascade,
  constraint learning_dictations_approved_start_fk
    foreign key (user_id, learner_id, video_id, scene_id)
    references public.learning_starts(user_id, learner_id, video_id, scene_id) on delete cascade
);

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
    if v_word ? 'sourceTerm' and (jsonb_typeof(v_word->'sourceTerm') is distinct from 'string'
       or char_length(v_word->>'sourceTerm') > 100) then
      raise exception 'invalid source term' using errcode = '22023';
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

drop trigger if exists before_dictation_write on public.learning_dictations;
create trigger before_dictation_write before insert or update on public.learning_dictations
for each row execute function public.guard_dictation_write();

create table if not exists public.app_settings (
  singleton boolean primary key default true check (singleton),
  daily_scene_limit integer not null default 10 check (daily_scene_limit between 0 and 1000),
  updated_at timestamptz not null default now()
);

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

insert into public.app_settings(singleton, daily_scene_limit) values (true, 10)
on conflict (singleton) do nothing;

alter table public.profiles enable row level security;
alter table public.learning_progress enable row level security;
alter table public.learning_starts enable row level security;
alter table public.learning_dictations enable row level security;
alter table public.user_libraries enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists profiles_own_all on public.profiles;
drop policy if exists profiles_own_select on public.profiles;
drop policy if exists profiles_own_insert on public.profiles;
drop policy if exists profiles_own_update on public.profiles;
drop policy if exists progress_own_all on public.learning_progress;
drop policy if exists progress_own_select on public.learning_progress;
drop policy if exists progress_own_delete on public.learning_progress;
drop policy if exists dictations_own_select on public.learning_dictations;
drop policy if exists dictations_own_delete on public.learning_dictations;
drop policy if exists starts_own_select_delete on public.learning_starts;
drop policy if exists starts_own_delete on public.learning_starts;
drop policy if exists starts_own_select on public.learning_starts;
drop policy if exists user_libraries_own_select on public.user_libraries;
create policy profiles_own_select on public.profiles for select to authenticated
using (user_id = auth.uid());
create policy profiles_own_insert on public.profiles for insert to authenticated
with check (user_id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy progress_own_select on public.learning_progress for select to authenticated
using (user_id = auth.uid());
create policy progress_own_delete on public.learning_progress for delete to authenticated
using (user_id = auth.uid());
create policy dictations_own_select on public.learning_dictations for select to authenticated
using (user_id = auth.uid());
create policy dictations_own_delete on public.learning_dictations for delete to authenticated
using (user_id = auth.uid());
create policy starts_own_select on public.learning_starts for select to authenticated using (user_id = auth.uid());
create policy user_libraries_own_select on public.user_libraries for select to authenticated
using (user_id = auth.uid());

create or replace function public.create_default_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(user_id, learner_id, nickname) values (new.id, 'default', '학습자1');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_default_profile();

create or replace function public.start_learning(p_video_id text, p_scene_id text, p_learner_id text default 'default')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_limit integer;
  v_used integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_video_id !~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$' or char_length(p_video_id) > 64
     or p_scene_id !~ '^(s[0-9]{3}|c[0-9]{4})$' or char_length(p_scene_id) > 64 then
    raise exception 'invalid video or scene id' using errcode = '22023';
  end if;
  if p_learner_id <> 'default' then
    raise exception 'only the default learner is supported' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_today::text, 0));
  insert into public.profiles(user_id, learner_id, nickname)
  values (v_user, p_learner_id, '학습자1')
  on conflict (user_id, learner_id) do nothing;
  select daily_scene_limit into v_limit from public.app_settings where singleton = true;
  v_limit := coalesce(v_limit, 10);
  if exists (
    select 1 from public.learning_starts
    where user_id = v_user and video_id = p_video_id and scene_id = p_scene_id
  ) then
    select count(*) into v_used from public.learning_starts
    where user_id = v_user and started_on = v_today;
    return jsonb_build_object('allowed', true, 'remaining', greatest(v_limit - v_used, 0), 'resumed', true);
  end if;
  select count(*) into v_used from public.learning_starts
  where user_id = v_user and started_on = v_today;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'daily_limit');
  end if;
  insert into public.learning_starts(user_id, learner_id, video_id, scene_id, started_on)
  values (v_user, p_learner_id, p_video_id, p_scene_id, v_today);
  return jsonb_build_object('allowed', true, 'remaining', v_limit - v_used - 1, 'resumed', false);
end $$;

create or replace function public.save_progress(p_record jsonb, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_learner text := p_record->>'learnerId';
  v_video text := p_record->>'videoId';
  v_scene text := p_record->>'sceneId';
  v_expression text := p_record->>'expressionId';
  v_version text := p_record->>'contentVersion';
  v_current timestamptz;
  v_now timestamptz := clock_timestamp();
  v_record jsonb;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_record is null or jsonb_typeof(p_record) is distinct from 'object' or v_learner is distinct from 'default'
     or v_video is null or v_video !~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$' or char_length(v_video) > 64
     or v_scene is null or v_scene !~ '^(s[0-9]{3}|c[0-9]{4})$' or char_length(v_scene) > 64
     or v_expression is null or v_expression !~ '^[a-z0-9][a-z0-9-]*$' or char_length(v_expression) > 80
     or v_version is null or v_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or char_length(v_version) > 64 then
    raise exception 'invalid progress record identifiers' using errcode = '22023';
  end if;
  v_record := p_record || jsonb_build_object('learnerId', 'default', 'updatedAt', v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':default:' || v_video || ':' || v_scene, 1
  ));
  select updated_at into v_current from public.learning_progress
  where user_id = v_user and learner_id = 'default' and video_id = v_video and scene_id = v_scene
    and expression_id = v_expression and content_version = v_version
  for update;
  if found then
    if p_expected_updated_at is null or v_current is distinct from p_expected_updated_at then
      raise exception 'progress_conflict: reload before saving again' using errcode = '40001';
    end if;
    update public.learning_progress set record = v_record, updated_at = v_now
    where user_id = v_user and learner_id = 'default' and video_id = v_video and scene_id = v_scene
      and expression_id = v_expression and content_version = v_version;
  else
    if p_expected_updated_at is not null then
      raise exception 'progress_conflict: record no longer exists' using errcode = '40001';
    end if;
    insert into public.learning_progress(
      user_id, learner_id, video_id, scene_id, expression_id, content_version, record, updated_at
    ) values (v_user, 'default', v_video, v_scene, v_expression, v_version, v_record, v_now);
  end if;
  return v_record;
end $$;

create or replace function public.save_dictation(p_record jsonb, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_learner text := p_record->>'learnerId';
  v_video text := p_record->>'videoId';
  v_scene text := p_record->>'sceneId';
  v_version text := p_record->>'contentVersion';
  v_current timestamptz;
  v_now timestamptz := clock_timestamp();
  v_record jsonb;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_record is null or jsonb_typeof(p_record) is distinct from 'object' or v_learner is distinct from 'default'
     or v_video is null or v_video !~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$' or char_length(v_video) > 64
     or v_scene is null or v_scene !~ '^(s[0-9]{3}|c[0-9]{4})$' or char_length(v_scene) > 64
     or v_version is null or v_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or char_length(v_version) > 64 then
    raise exception 'invalid dictation record identifiers' using errcode = '22023';
  end if;
  v_record := p_record || jsonb_build_object('learnerId', 'default', 'updatedAt', v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':default:' || v_video || ':' || v_scene, 1
  ));
  select updated_at into v_current from public.learning_dictations
  where user_id = v_user and learner_id = 'default' and video_id = v_video and scene_id = v_scene
    and content_version = v_version
  for update;
  if found then
    if p_expected_updated_at is null or v_current is distinct from p_expected_updated_at then
      raise exception 'dictation_conflict: reload before saving again' using errcode = '40001';
    end if;
    update public.learning_dictations set record = v_record, updated_at = v_now
    where user_id = v_user and learner_id = 'default' and video_id = v_video and scene_id = v_scene
      and content_version = v_version;
  else
    if p_expected_updated_at is not null then
      raise exception 'dictation_conflict: record no longer exists' using errcode = '40001';
    end if;
    insert into public.learning_dictations(
      user_id, learner_id, video_id, scene_id, content_version, record, updated_at
    ) values (v_user, 'default', v_video, v_scene, v_version, v_record, v_now);
  end if;
  return v_record;
end $$;

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

revoke execute on function public.create_default_profile() from public, anon, authenticated;
revoke execute on function public.guard_progress_write() from public, anon, authenticated;
revoke execute on function public.guard_dictation_write() from public, anon, authenticated;
revoke execute on function public.start_learning(text,text,text) from public, anon;
revoke execute on function public.save_progress(jsonb,timestamptz) from public, anon;
revoke execute on function public.save_dictation(jsonb,timestamptz) from public, anon;
revoke execute on function public.save_user_library(jsonb,timestamptz) from public, anon;
revoke all on public.app_settings from anon, authenticated;
revoke delete on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
revoke insert, update on public.learning_progress from anon, authenticated;
grant select, delete on public.learning_progress to authenticated;
revoke insert, update on public.learning_dictations from anon, authenticated;
grant select, delete on public.learning_dictations to authenticated;
revoke insert, update, delete on public.learning_starts from anon, authenticated;
grant select on public.learning_starts to authenticated;
revoke insert, update, delete on public.user_libraries from anon, authenticated;
grant select on public.user_libraries to authenticated;
grant execute on function public.start_learning(text,text,text) to authenticated;
grant execute on function public.save_progress(jsonb,timestamptz) to authenticated;
grant execute on function public.save_dictation(jsonb,timestamptz) to authenticated;
grant execute on function public.save_user_library(jsonb,timestamptz) to authenticated;

commit;
