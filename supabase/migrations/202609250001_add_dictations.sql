-- Upgrade an existing Word Trail database. Fresh projects should run ../schema.sql instead.
begin;

do $$
declare v_constraint record;
begin
  for v_constraint in
    select c.conrelid::regclass as table_name, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.learning_progress'::regclass, 'public.learning_starts'::regclass)
      and cardinality(c.conkey) = 1
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = c.conkey[1] and a.attname = 'scene_id'
      )
  loop
    execute format('alter table %s drop constraint %I', v_constraint.table_name, v_constraint.conname);
  end loop;
end $$;

alter table public.learning_progress add constraint learning_progress_scene_id_format_check
  check (char_length(scene_id) <= 64 and scene_id ~ '^(s[0-9]{3}|c[0-9]{4})$');
alter table public.learning_starts add constraint learning_starts_scene_id_format_check
  check (char_length(scene_id) <= 64 and scene_id ~ '^(s[0-9]{3}|c[0-9]{4})$');

create table public.learning_dictations (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  learner_id text not null default 'default' check (learner_id = 'default'),
  video_id text not null check (char_length(video_id) <= 64 and video_id ~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$'),
  scene_id text not null check (char_length(scene_id) <= 64 and scene_id ~ '^(s[0-9]{3}|c[0-9]{4})$'),
  content_version text not null check (char_length(content_version) <= 64 and content_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  record jsonb not null check (
    jsonb_typeof(record) = 'object'
    and record ?& array['learnerId','videoId','sceneId','contentVersion','reference','answer','attempts','words','updatedAt']
    and record->>'learnerId' = learner_id and record->>'videoId' = video_id
    and record->>'sceneId' = scene_id and record->>'contentVersion' = content_version
    and jsonb_typeof(record->'reference') = 'string' and char_length(record->>'reference') <= 2000
    and jsonb_typeof(record->'answer') = 'string' and char_length(record->>'answer') <= 2000
    and jsonb_typeof(record->'attempts') = 'number' and (record->>'attempts') ~ '^[0-9]+$'
    and (record->>'attempts')::numeric <= 2147483647
    and jsonb_typeof(record->'words') = 'array' and jsonb_array_length(record->'words') <= 200
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
declare v_word jsonb; v_count integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'dictation owner must match authenticated user' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and row(new.user_id,new.learner_id,new.video_id,new.scene_id,new.content_version)
     is distinct from row(old.user_id,old.learner_id,old.video_id,old.scene_id,old.content_version) then
    raise exception 'dictation identity cannot be changed' using errcode = '22023';
  end if;
  if jsonb_typeof(new.record->'words') is distinct from 'array' then
    raise exception 'invalid dictation words' using errcode = '22023';
  end if;
  for v_word in select value from jsonb_array_elements(new.record->'words') loop
    if jsonb_typeof(v_word) is distinct from 'object'
       or jsonb_typeof(v_word->'key') is distinct from 'string' or char_length(v_word->>'key') > 200
       or jsonb_typeof(v_word->'term') is distinct from 'string' or char_length(v_word->>'term') > 100
       or jsonb_typeof(v_word->'kind') is distinct from 'string' or v_word->>'kind' not in ('replace','missing','extra')
       or jsonb_typeof(v_word->'typed') is distinct from 'string' or char_length(v_word->>'typed') > 100
       or jsonb_typeof(v_word->'sourceIndex') is distinct from 'number'
       or (v_word->>'sourceIndex') !~ '^-?[0-9]+$'
       or (v_word->>'sourceIndex')::numeric < -1 or (v_word->>'sourceIndex')::numeric > 10000
       or jsonb_typeof(v_word->'studied') is distinct from 'boolean'
       or jsonb_typeof(v_word->'studyAttempts') is distinct from 'number'
       or (v_word->>'studyAttempts') !~ '^[0-9]+$' or (v_word->>'studyAttempts')::numeric > 2147483647
       or jsonb_typeof(v_word->'lastAnswer') is distinct from 'string' or char_length(v_word->>'lastAnswer') > 2000 then
      raise exception 'invalid dictation word' using errcode = '22023';
    end if;
  end loop;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||':'||new.learner_id||':'||new.video_id||':'||new.scene_id,1));
    if exists(select 1 from public.learning_dictations where user_id=new.user_id and learner_id=new.learner_id
      and video_id=new.video_id and scene_id=new.scene_id and content_version=new.content_version) then return new; end if;
    select count(*) into v_count from public.learning_dictations where user_id=new.user_id and learner_id=new.learner_id
      and video_id=new.video_id and scene_id=new.scene_id;
    if v_count>=5 then raise exception 'a scene can store at most five dictation versions' using errcode='54000'; end if;
  end if;
  return new;
end $$;

create trigger before_dictation_write before insert or update on public.learning_dictations
for each row execute function public.guard_dictation_write();

alter table public.learning_dictations enable row level security;
create policy dictations_own_select on public.learning_dictations for select to authenticated using (user_id = auth.uid());
create policy dictations_own_delete on public.learning_dictations for delete to authenticated using (user_id = auth.uid());

create or replace function public.start_learning(p_video_id text, p_scene_id text, p_learner_id text default 'default')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_today date := (now() at time zone 'utc')::date; v_limit integer; v_used integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_video_id !~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$' or char_length(p_video_id) > 64
     or p_scene_id !~ '^(s[0-9]{3}|c[0-9]{4})$' or char_length(p_scene_id) > 64 then
    raise exception 'invalid video or scene id' using errcode = '22023';
  end if;
  if p_learner_id <> 'default' then raise exception 'only the default learner is supported' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_today::text, 0));
  insert into public.profiles(user_id,learner_id,nickname) values(v_user,'default','학습자1')
    on conflict(user_id,learner_id) do nothing;
  select daily_scene_limit into v_limit from public.app_settings where singleton=true;
  v_limit := coalesce(v_limit,10);
  if exists(select 1 from public.learning_starts where user_id=v_user and video_id=p_video_id and scene_id=p_scene_id) then
    select count(*) into v_used from public.learning_starts where user_id=v_user and started_on=v_today;
    return jsonb_build_object('allowed',true,'remaining',greatest(v_limit-v_used,0),'resumed',true);
  end if;
  select count(*) into v_used from public.learning_starts where user_id=v_user and started_on=v_today;
  if v_used>=v_limit then return jsonb_build_object('allowed',false,'remaining',0,'reason','daily_limit'); end if;
  insert into public.learning_starts(user_id,learner_id,video_id,scene_id,started_on)
    values(v_user,'default',p_video_id,p_scene_id,v_today);
  return jsonb_build_object('allowed',true,'remaining',v_limit-v_used-1,'resumed',false);
end $$;

create or replace function public.save_progress(p_record jsonb, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid:=auth.uid(); v_learner text:=p_record->>'learnerId'; v_video text:=p_record->>'videoId';
  v_scene text:=p_record->>'sceneId'; v_expression text:=p_record->>'expressionId';
  v_version text:=p_record->>'contentVersion'; v_current timestamptz; v_now timestamptz:=clock_timestamp(); v_record jsonb;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_record is null or jsonb_typeof(p_record) is distinct from 'object' or v_learner is distinct from 'default'
     or v_video is null or v_video !~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$' or char_length(v_video)>64
     or v_scene is null or v_scene !~ '^(s[0-9]{3}|c[0-9]{4})$' or char_length(v_scene)>64
     or v_expression is null or v_expression !~ '^[a-z0-9][a-z0-9-]*$' or char_length(v_expression)>80
     or v_version is null or v_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or char_length(v_version)>64 then
    raise exception 'invalid progress record identifiers' using errcode='22023';
  end if;
  v_record:=p_record||jsonb_build_object('learnerId','default','updatedAt',v_now);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':default:'||v_video||':'||v_scene,1));
  select updated_at into v_current from public.learning_progress where user_id=v_user and learner_id='default'
    and video_id=v_video and scene_id=v_scene and expression_id=v_expression and content_version=v_version for update;
  if found then
    if p_expected_updated_at is null or v_current is distinct from p_expected_updated_at then
      raise exception 'progress_conflict: reload before saving again' using errcode='40001'; end if;
    update public.learning_progress set record=v_record,updated_at=v_now where user_id=v_user and learner_id='default'
      and video_id=v_video and scene_id=v_scene and expression_id=v_expression and content_version=v_version;
  else
    if p_expected_updated_at is not null then raise exception 'progress_conflict: record no longer exists' using errcode='40001'; end if;
    insert into public.learning_progress(user_id,learner_id,video_id,scene_id,expression_id,content_version,record,updated_at)
      values(v_user,'default',v_video,v_scene,v_expression,v_version,v_record,v_now);
  end if;
  return v_record;
end $$;

create or replace function public.save_dictation(p_record jsonb, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid:=auth.uid(); v_learner text:=p_record->>'learnerId'; v_video text:=p_record->>'videoId';
  v_scene text:=p_record->>'sceneId'; v_version text:=p_record->>'contentVersion';
  v_current timestamptz; v_now timestamptz:=clock_timestamp(); v_record jsonb;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_record is null or jsonb_typeof(p_record) is distinct from 'object' or v_learner is distinct from 'default'
     or v_video is null or v_video !~ '^(video-[0-9]{2}|custom-[A-Za-z0-9_-]{11})$' or char_length(v_video)>64
     or v_scene is null or v_scene !~ '^(s[0-9]{3}|c[0-9]{4})$' or char_length(v_scene)>64
     or v_version is null or v_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' or char_length(v_version)>64 then
    raise exception 'invalid dictation record identifiers' using errcode='22023';
  end if;
  v_record:=p_record||jsonb_build_object('learnerId','default','updatedAt',v_now);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':default:'||v_video||':'||v_scene,1));
  select updated_at into v_current from public.learning_dictations where user_id=v_user and learner_id='default'
    and video_id=v_video and scene_id=v_scene and content_version=v_version for update;
  if found then
    if p_expected_updated_at is null or v_current is distinct from p_expected_updated_at then
      raise exception 'dictation_conflict: reload before saving again' using errcode='40001'; end if;
    update public.learning_dictations set record=v_record,updated_at=v_now where user_id=v_user and learner_id='default'
      and video_id=v_video and scene_id=v_scene and content_version=v_version;
  else
    if p_expected_updated_at is not null then raise exception 'dictation_conflict: record no longer exists' using errcode='40001'; end if;
    insert into public.learning_dictations(user_id,learner_id,video_id,scene_id,content_version,record,updated_at)
      values(v_user,'default',v_video,v_scene,v_version,v_record,v_now);
  end if;
  return v_record;
end $$;

revoke execute on function public.guard_dictation_write() from public,anon,authenticated;
revoke execute on function public.save_dictation(jsonb,timestamptz) from public,anon;
revoke insert,update on public.learning_dictations from public,anon,authenticated;
grant select,delete on public.learning_dictations to authenticated;
grant execute on function public.save_dictation(jsonb,timestamptz) to authenticated;

commit;
