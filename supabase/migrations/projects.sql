-- Story projects: a series made episode by episode. The "Story Bible" (characters, places, what happened,
-- where everyone is now) is stored here, so every new episode is written from the saved record, not from AI memory.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  idea_mm text,                       -- the customer's idea in their own words
  premise_mm text,                    -- what the story is about (AI draft, customer-editable)
  setting_mm text,                    -- places and time (customer-editable)
  state_mm text,                      -- where every character is and what is going on now, after the last episode
  ratio text not null default '9:16',
  quality text not null default 'std',
  status text not null default 'drafting', -- drafting | ready | failed
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.projects (user_id, updated_at desc);

create table public.project_characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  gender text not null default 'male',     -- male | female
  age text not null default 'young',       -- child | young | middle | old
  look_mm text,                            -- face, hair, usual clothes
  personality_mm text,                     -- character and relationships
  photo_path text,                         -- inputs bucket, {user}/...
  voice_id text,                           -- fixed voice for the whole series
  sort int not null default 0,
  unique (project_id, name)
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  num int not null,
  title text,
  input_mode text not null default 'idea', -- script | idea
  input_mm text not null,
  status text not null default 'planning', -- planning | ready | producing | stitching | done | failed
  warnings jsonb not null default '[]',    -- story problems found before paying
  cost int,                                -- credits for all scenes
  summary_mm text,                         -- what happened (written after the episode, customer-editable)
  video_path text,
  stitch_id text,
  error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (project_id, num)
);
create index on public.episodes (status);

create table public.episode_scenes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  idx int not null,
  story_mm text not null,                  -- the scene in Burmese (customer-editable before paying)
  cast_names text[] not null default '{}', -- characters in this scene
  status text not null default 'pending',  -- pending | running | done | failed
  generation_id uuid references public.generations(id),
  attempts int not null default 0,
  unique (episode_id, idx)
);

alter table public.generations add column if not exists episode_id uuid references public.episodes(id) on delete set null;

alter table public.projects enable row level security;
alter table public.project_characters enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_scenes enable row level security;

create policy own_projects on public.projects for select using (user_id = auth.uid() or public.is_admin());
create policy own_chars on public.project_characters for select using (exists (select 1 from public.projects p where p.id = project_id and (p.user_id = auth.uid() or public.is_admin())));
create policy own_episodes on public.episodes for select using (user_id = auth.uid() or public.is_admin());
create policy own_scenes on public.episode_scenes for select using (exists (select 1 from public.episodes e where e.id = episode_id and (e.user_id = auth.uid() or public.is_admin())));
-- all writes go through the "project" edge function (service role) so the Story Bible stays consistent

-- pay for one scene and create its video job (service role only); a failed job refunds itself via finish_generation
create or replace function public.episode_scene_generation(p_scene uuid, p_plan uuid, p_refs jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.episode_scenes; e public.episodes; pr public.projects; v_cost int; v_bal int; v_id uuid;
begin
  select * into s from public.episode_scenes where id = p_scene for update;
  select * into e from public.episodes where id = s.episode_id;
  select * into pr from public.projects where id = e.project_id;
  v_cost := public.gen_cost(pr.quality, 10);
  select credits into v_bal from public.profiles where id = e.user_id for update;
  if v_bal < v_cost then raise exception 'insufficient credits'; end if;
  insert into public.generations (user_id, mode, prompt_mm, quality, duration, ratio, cost, plan_id, refs, episode_id)
  values (e.user_id, 't2v', s.story_mm, pr.quality, 10, pr.ratio, v_cost, p_plan, case when jsonb_array_length(coalesce(p_refs,'[]')) > 0 then p_refs end, e.id)
  returning id into v_id;
  perform public._add_credits(e.user_id, -v_cost, 'အပိုင်း (' || e.num || ') — scene ' || (s.idx + 1), v_id);
  update public.episode_scenes set generation_id = v_id, status = 'running', attempts = attempts + 1 where id = p_scene;
  return v_id;
end $$;
revoke all on function public.episode_scene_generation(uuid, uuid, jsonb) from public, anon, authenticated;

-- one worker at a time per episode
create or replace function public.claim_episode(p_id uuid, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.episodes set locked_until = now() + make_interval(secs => p_seconds)
   where id = p_id and (locked_until is null or locked_until < now());
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.claim_episode(uuid, int) from public, anon, authenticated;

-- background worker: every minute while an episode is being made
select cron.schedule('episode-tick', '* * * * *', $c$
  select net.http_post(url := 'https://isceklnjifckepgumale.supabase.co/functions/v1/project',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token', public.get_app_secret('cron_token')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.episodes where status in ('producing','stitching'));
$c$);

alter table public.episodes add column if not exists stitch_tries int not null default 0;

-- engine: null = Wan + ElevenLabs dubbing, omni = Gemini Omni (speech made by the video model)
alter table public.generations add column if not exists engine text;
