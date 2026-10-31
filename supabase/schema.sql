create extension if not exists pgcrypto;

create table if not exists public.assist_users (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (char_length(trim(full_name)) between 1 and 120),
    username text not null check (char_length(username) between 3 and 30),
    email text not null check (char_length(email) between 3 and 254),
    password_salt text not null,
    password_hash text not null,
    created_at timestamptz not null default now()
);

create unique index if not exists assist_users_username_lower_unique
    on public.assist_users (lower(username));
create unique index if not exists assist_users_email_lower_unique
    on public.assist_users (lower(email));

create table if not exists public.assist_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.assist_users(id) on delete cascade,
    requester text not null check (char_length(trim(requester)) between 1 and 120),
    title text not null check (char_length(trim(title)) between 1 and 180),
    priority text not null check (priority in ('Low', 'Medium', 'High')),
    status text not null default 'Pending' check (status in ('Pending', 'Completed')),
    created_at timestamptz not null default now()
);

create index if not exists assist_requests_user_created_idx
    on public.assist_requests (user_id, created_at desc);

alter table public.assist_users enable row level security;
alter table public.assist_requests enable row level security;