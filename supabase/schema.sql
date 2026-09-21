-- 7419 Outreach Tracker — Supabase schema
-- Run this once in the Supabase SQL editor (Database → SQL). Safe to run again.
--
-- What it sets up:
--   profiles         one row per account (name, grade, role: member | admin)
--   settings         a single row: semester dates, required hours, what has to be in every photo
--   sessions         one row per clock-in, with server-side timestamps and photo paths
--   member_progress  a view with approved / waiting hours per member for the current semester
--   clock-photos     a private storage bucket; members write to their own folder, leads can read everything
--   RPCs             clock_in, clock_out, review_session, close_session (timestamps come from the server)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  email       text not null default '',
  grade       text,
  role        text not null default 'member' check (role in ('member', 'admin')),
  excused     boolean not null default false,
  excused_note text,
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists excused boolean not null default false;
alter table public.profiles add column if not exists excused_note text;

create table if not exists public.settings (
  id                   int primary key default 1 check (id = 1),
  semester_name        text not null default 'Fall 2026',
  semester_start       date not null default '2026-08-17',
  semester_end         date not null default '2026-12-18',
  required_hours       numeric not null default 10,
  verification_object  text not null default 'the object specified by an admin',
  updated_at           timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  event            text not null default '',
  clock_in_at      timestamptz not null default now(),
  clock_in_photo   text,                -- null for hours an admin added by hand
  clock_out_at     timestamptz,
  clock_out_photo  text,
  note             text,
  status           text not null default 'open' check (status in ('open', 'pending', 'approved', 'rejected')),
  approved_hours   numeric,
  admin_note       text,
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  manual           boolean not null default false,
  created_at       timestamptz not null default now()
);
alter table public.sessions alter column clock_in_photo drop not null;
alter table public.sessions add column if not exists manual boolean not null default false;
create index if not exists sessions_user_time on public.sessions (user_id, clock_in_at desc);
create index if not exists sessions_status on public.sessions (status);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- create a profile row when someone signs up.
-- The very first account becomes an admin, so sign up yourself before sharing the link.
-- Admins can add or remove other admins from Settings in admin.html.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles where role = 'admin') into first_user;
  insert into public.profiles (id, name, email, grade, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), coalesce(new.email, ''), nullif(new.raw_user_meta_data->>'grade', ''),
          case when first_user then 'admin' else 'member' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- only a lead (or the SQL editor) can change roles
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only a lead can change roles';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ---------------------------------------------------------------- RPCs (server-side timestamps)
create or replace function public.clock_in(p_event text, p_photo text)
returns public.sessions language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_photo is null or p_photo = '' then raise exception 'A photo is needed to clock in'; end if;
  if exists (select 1 from public.sessions where user_id = auth.uid() and status = 'open') then
    raise exception 'You are already clocked in. Clock out first.';
  end if;
  insert into public.sessions (user_id, event, clock_in_photo)
  values (auth.uid(), coalesce(left(p_event, 80), ''), p_photo)
  returning * into s;
  return s;
end $$;

create or replace function public.clock_out(p_session uuid, p_photo text, p_note text)
returns public.sessions language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_photo is null or p_photo = '' then raise exception 'A photo is needed to clock out'; end if;
  update public.sessions
     set clock_out_at = now(), clock_out_photo = p_photo, note = nullif(left(coalesce(p_note, ''), 300), ''), status = 'pending'
   where id = p_session and user_id = auth.uid() and status = 'open'
  returning * into s;
  if s.id is null then raise exception 'No open session found'; end if;
  return s;
end $$;

create or replace function public.review_session(p_session uuid, p_status text, p_hours numeric, p_note text)
returns public.sessions language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  if not public.is_admin() then raise exception 'Only a lead can review sessions'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Status must be approved or rejected'; end if;
  update public.sessions
     set status = p_status,
         approved_hours = case when p_status = 'approved' then greatest(coalesce(p_hours, 0), 0) else null end,
         admin_note = nullif(left(coalesce(p_note, ''), 300), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_session and status <> 'open'
  returning * into s;
  if s.id is null then raise exception 'Session not found or still open'; end if;
  return s;
end $$;

create or replace function public.close_session(p_session uuid, p_note text)
returns public.sessions language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  if not public.is_admin() then raise exception 'Only a lead can close sessions'; end if;
  update public.sessions
     set clock_out_at = now(), status = 'pending', admin_note = left(coalesce(p_note, 'Closed by a lead.'), 300)
   where id = p_session and status = 'open'
  returning * into s;
  if s.id is null then raise exception 'That session is not open'; end if;
  return s;
end $$;

-- admins can take a member off the roster: sessions, profile and the login itself.
-- (Photos are removed by the admin page through the Storage API; Supabase does not allow deleting storage rows from SQL.)
create or replace function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can remove members'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  delete from public.sessions where user_id = p_user;
  delete from public.profiles where id = p_user;
  begin
    delete from auth.users where id = p_user;
  exception when insufficient_privilege then
    null; -- profile is gone, so the app treats the account as signed out
  end;
end $$;

-- admins can add approved hours by hand (no photos), e.g. for work done off the app
create or replace function public.add_hours(p_user uuid, p_hours numeric, p_event text, p_note text, p_date date)
returns public.sessions language plpgsql security definer set search_path = public as $$
declare s public.sessions; t timestamptz;
begin
  if not public.is_admin() then raise exception 'Only an admin can add hours'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 then raise exception 'Hours must be between 0.25 and 24'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found'; end if;
  t := (coalesce(p_date, current_date)::timestamp + interval '12 hours') at time zone 'UTC';
  insert into public.sessions (user_id, event, clock_in_at, clock_out_at, status, approved_hours, admin_note, reviewed_by, reviewed_at, manual)
  values (p_user, coalesce(left(p_event, 80), ''), t, t + (p_hours * interval '1 hour'), 'approved', p_hours,
          nullif(left(coalesce(p_note, ''), 300), ''), auth.uid(), now(), true)
  returning * into s;
  return s;
end $$;

grant execute on function public.is_admin(), public.clock_in(text, text), public.clock_out(uuid, text, text),
  public.review_session(uuid, text, numeric, text), public.close_session(uuid, text), public.remove_member(uuid),
  public.add_hours(uuid, numeric, text, text, date) to authenticated;

-- ---------------------------------------------------------------- progress view
create or replace view public.member_progress with (security_invoker = true) as
select p.id, p.name, p.email, p.grade, p.role,
  coalesce(sum(case when s.status = 'approved' then s.approved_hours end), 0)                                                  as approved_hours,
  coalesce(sum(case when s.status = 'pending'  then extract(epoch from (s.clock_out_at - s.clock_in_at)) / 3600 end), 0)       as pending_hours,
  count(s.id) filter (where s.status = 'open')                                                                                  as open_sessions,
  p.excused, p.excused_note
from public.profiles p
left join public.settings st on st.id = 1
left join public.sessions s
  on s.user_id = p.id
 and s.clock_in_at >= st.semester_start::timestamptz
 and s.clock_in_at <  (st.semester_end + 1)::timestamptz
group by p.id, p.name, p.email, p.grade, p.role, p.excused, p.excused_note;

grant select on public.member_progress to authenticated;

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.sessions enable row level security;

drop policy if exists "profiles: read own or lead" on public.profiles;
create policy "profiles: read own or lead" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles: update own or lead" on public.profiles;
create policy "profiles: update own or lead" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists "settings: everyone signed in can read" on public.settings;
drop policy if exists "settings: anyone can read" on public.settings;
-- the landing page shows the semester name and required hours before sign-in, so anon can read this one row
create policy "settings: anyone can read" on public.settings for select to anon, authenticated using (true);
drop policy if exists "settings: leads update" on public.settings;
create policy "settings: leads update" on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sessions: read own or lead" on public.sessions;
create policy "sessions: read own or lead" on public.sessions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- inserts and updates go through the RPCs above, so no direct insert/update policies are needed

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clock-photos', 'clock-photos', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "clock photos: members upload to their own folder" on storage.objects;
create policy "clock photos: members upload to their own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'clock-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "clock photos: members replace their own" on storage.objects;
create policy "clock photos: members replace their own" on storage.objects for update to authenticated
  using (bucket_id = 'clock-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "clock photos: read own or lead" on storage.objects;
create policy "clock photos: read own or lead" on storage.objects for select to authenticated
  using (bucket_id = 'clock-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "clock photos: admins delete" on storage.objects;
create policy "clock photos: admins delete" on storage.objects for delete to authenticated
  using (bucket_id = 'clock-photos' and public.is_admin());

-- ---------------------------------------------------------------- leads
-- The first account that signs up is an admin automatically. To make anyone else an admin by hand:
--   update public.profiles set role = 'admin' where email = 'them@school.org';
