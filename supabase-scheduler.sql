create extension if not exists pgcrypto;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 48),
  editor_token_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.availability (
  participant_id uuid not null references public.participants(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (participant_id, day)
);

create index if not exists availability_day_idx on public.availability(day);

alter table public.participants enable row level security;
alter table public.availability enable row level security;
