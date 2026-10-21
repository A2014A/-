---
name: supabase-postgres
description: Postgres schema, RLS, indexing and query patterns for this project's Supabase database (multi-tenant customer -> site -> ESP32 unit -> channel, plus schedules). Use when designing tables, writing RLS policies, writing SQL or Supabase queries, or reviewing database code.
---

# Supabase Postgres Patterns

Database rules for "עוזר לגבאי". The database is hosted Supabase Postgres and is the
source of truth for config, schedules and channel mapping (see `CLAUDE.md`). Every
table holds data that belongs to exactly one customer, so tenant isolation comes first.

## Hard rules

- **Never run `ALTER SYSTEM`, `REVOKE ... ON SCHEMA public`, or change role grants**
  on Supabase. Hosted Supabase does not allow some of these and the rest can break
  PostgREST/Auth. Server settings are changed from the dashboard or the CLI, not SQL.
- **Every table in an exposed schema (`public`) has RLS enabled in the same migration
  that creates it**, with explicit policies. A table without RLS is readable by anyone
  holding the publishable/anon key.
- **Never rely on `auth.jwt() -> 'user_metadata'` in policies.** Users can edit their
  own user metadata. Use membership tables (preferred) or `app_metadata`.
- Do not use destructive SQL (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`) without
  explicit approval from the user.

## Data types

| Use case | Type | Notes |
|---|---|---|
| Rows linked to users/tenants | `uuid default gen_random_uuid()` | `auth.users.id` is `uuid`; tenant keys must match it |
| High-volume internal logs (status reports) | `bigint generated always as identity` | fine where ids never leave the server |
| Any point in time | `timestamptz` | never `timestamp`; store UTC |
| Site time zone | `text` holding an IANA name, e.g. `'Asia/Jerusalem'` | needed for civil and halachic times |
| Site location | `numeric(9,6)` latitude / longitude | needed for sunrise/sunset |
| Wall-clock time of an action | `time` | plus `time_type` / offset columns, see below |
| Money | `numeric(12,2)` | never `float` |
| Fixed sets (day category, action) | `text` + `check` constraint, or a Postgres `enum` | prefer `check` while values still change |

## Tenant model

```sql
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.customer_members (
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'viewer')),
  primary key (customer_id, user_id)
);
create index on public.customer_members (user_id);
```

Child tables (`sites`, `esp_units`, `channels`, `schedule_actions`, ...) carry a
`customer_id uuid not null` column even when it could be derived through a parent.
This keeps every RLS policy a single indexed lookup instead of a chain of joins.

## RLS pattern

Put the membership check in a function in a schema that is **not** exposed through
the API, so clients cannot call it over RPC:

```sql
create schema if not exists private;

create or replace function private.is_member(target_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customer_members m
    where m.customer_id = target_customer
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_edit(target_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customer_members m
    where m.customer_id = target_customer
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

alter table public.sites enable row level security;

create policy "members read sites" on public.sites
  for select to authenticated
  using ((select private.is_member(customer_id)));

create policy "editors insert sites" on public.sites
  for insert to authenticated
  with check ((select private.can_edit(customer_id)));

create policy "editors update sites" on public.sites
  for update to authenticated
  using ((select private.can_edit(customer_id)))
  with check ((select private.can_edit(customer_id)));

create policy "editors delete sites" on public.sites
  for delete to authenticated
  using ((select private.can_edit(customer_id)));
```

Notes:

- Wrap `auth.uid()` and helper calls in `(select ...)` so Postgres evaluates them once
  per query instead of once per row.
- `security definer` functions must set `search_path = ''` and use schema-qualified names.
- Write separate policies per command when roles differ (e.g. `viewer` may only select).
  Always give insert/update policies a `with check`, or a user can move a row into
  another tenant.
- Index every column a policy filters on (`customer_id`, `user_id`).
- Views bypass RLS unless created with `with (security_invoker = true)`.
- Test isolation: as user A, selecting user B's rows must return nothing, and inserting
  a row with B's `customer_id` must fail.

## Project-specific schema rules

These come from `CLAUDE.md` and exist to avoid a bug already shipped once:

- A schedule entry is **an on+off pair, an on-only action, or an off-only action**.
  Model actions as rows, each with **its own day category** (weekday / Friday /
  Erev Shabbat / Shabbat / Erev Chag / Chag). Never store one day category per event.
- The time type (fixed clock time vs. halachic offset) defaults to fixed time.
- Weekly recurring rules and Hebrew-date special programs are separate tables.
- Multi-day holiday programs carry their own weekday / Shabbat / Chag split. Which civil
  dates fall into each category is computed per year (Hebcal), never stored as weekdays.
- ESP32 units are assigned by physical panel, so each channel has its own category label.
  Never derive category from the unit.

## Access from the on-site Pi

The Pi never gets database credentials, and never the `service_role`/secret key.
It talks to a server endpoint (Next.js route on Vercel) with a per-device token. The
server stores only a hash of that token, resolves it to one `site_id`, and filters every
query by that site. See the `security-review` skill.

## Indexes

| Query pattern | Index |
|---|---|
| `where customer_id = ?` (every tenant table) | b-tree on `customer_id` |
| `where site_id = ? and updated_at > ?` (Pi sync) | composite `(site_id, updated_at)` |
| Only active rows | partial: `... where deleted_at is null` |
| `jsonb @> '{...}'` | GIN |

Put equality columns first and range columns last in composite indexes. Tables in this
project are small, so do not add indexes "just in case". Add them for the RLS and sync
paths above, or when `explain analyze` shows a sequential scan that matters.

## Query patterns

```sql
-- Upsert
insert into public.channel_settings (channel_id, key, value)
values (...)
on conflict (channel_id, key) do update set value = excluded.value;

-- Cursor pagination
select * from public.status_reports
where site_id = ... and id > ...
order by id
limit 50;
```

From TypeScript use the Supabase client query builder (parameterised by design) and
select only the columns you need. Never build SQL strings from user input; in Postgres
functions use parameters or `format()` with `%L` / `%I`.

## Statement timeouts

Set per role from a migration or the dashboard, not with `ALTER SYSTEM`:

```sql
alter role authenticated set statement_timeout = '8s';
```

---
Adapted from the `postgres-patterns` skill of ECC (MIT License, © 2026 Affaan Mustafa),
with the Supabase-unsafe parts removed and project rules added.
