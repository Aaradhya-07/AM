-- ==============================================================================
-- ANVILMARK Platform Database Schema (PostgreSQL for Supabase)
-- Run this in your Supabase SQL Editor: Dashboard -> SQL Editor -> New Query
-- ==============================================================================

-- 1. Profiles (linked to Supabase Auth)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  name text,
  avatar_url text,
  role text default 'developer',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Automatically create or update profile on new signup / signin
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'user_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(excluded.name, profiles.name),
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Projects / Monitored Repositories
create table if not exists public.projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  repo_url text not null,
  branch text default 'main' not null,
  contract_version text default '0.1.0-draft.5' not null,
  target_hardware text default 'Llama 3.1 70B · 8xH100 SXM5',
  conformance_status text default 'verified' check (conformance_status in ('verified', 'drift_detected', 'pending_ratification')),
  boundaries_count integer default 0,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.projects enable row level security;

create policy "Users can view their own projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Users can insert their own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own projects"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "Users can delete their own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- 3. Versioned Decision Contracts
create table if not exists public.contracts (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects on delete cascade not null,
  schema_version text not null,
  raw_contract_json jsonb not null,
  approval_hash text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.contracts enable row level security;

create policy "Users can view contracts for their own projects"
  on public.contracts for select
  using (
    exists (
      select 1 from public.projects
      where public.projects.id = public.contracts.project_id
      and public.projects.user_id = auth.uid()
    )
  );

create policy "Users can insert contracts for their own projects"
  on public.contracts for insert
  with check (
    exists (
      select 1 from public.projects
      where public.projects.id = public.contracts.project_id
      and public.projects.user_id = auth.uid()
    )
  );

-- 4. Conformance Runs / Audit Stream
create table if not exists public.conformance_runs (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects on delete cascade not null,
  commit_sha text not null,
  agent_trigger text not null,
  status text not null check (status in ('pass', 'fail', 'warn')),
  details text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.conformance_runs enable row level security;

create policy "Users can view runs for their own projects"
  on public.conformance_runs for select
  using (
    exists (
      select 1 from public.projects
      where public.projects.id = public.conformance_runs.project_id
      and public.projects.user_id = auth.uid()
    )
  );

create policy "Users can insert runs for their own projects"
  on public.conformance_runs for insert
  with check (
    exists (
      select 1 from public.projects
      where public.projects.id = public.conformance_runs.project_id
      and public.projects.user_id = auth.uid()
    )
  );
