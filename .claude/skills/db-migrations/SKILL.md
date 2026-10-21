---
name: db-migrations
description: How to create and ship database schema changes for this project's Supabase database with the Supabase CLI, safely and without breaking Pis that run older sync code. Use when adding or changing tables, columns, indexes, RLS policies or Postgres functions.
---

# Database Migrations (Supabase CLI)

## Rules

1. **Every schema change is a migration file** in `supabase/migrations/`, committed to git.
   Never change the production schema by hand in the dashboard.
2. **Never edit a migration that has already been applied** anywhere shared. Fix it with
   a new migration.
3. **Every new table enables RLS and adds its policies in the same migration**
   (see `supabase-postgres`).
4. **Ask the user before** anything that touches a remote database
   (`supabase db push`, `supabase link`) and before any destructive change
   (`drop table`, `drop column`, `truncate`, data-deleting `update`/`delete`).
5. Keep schema changes and data backfills in separate migrations.

## Workflow

```bash
supabase migration new add_channel_label    # creates supabase/migrations/<timestamp>_add_channel_label.sql
# write the SQL in that file
supabase db reset                            # LOCAL ONLY: rebuilds the local DB from all migrations + seed
supabase gen types typescript --local > src/lib/database.types.ts
supabase db push                             # remote; only with the user's explicit approval
```

`supabase db reset` wipes the local database. Never point it at a remote project.
`supabase db diff` can draft SQL from changes made locally in Studio, but read and clean
the output before committing it.

## Safe change patterns

**Add a column:** nullable, or `not null default <constant>` (instant on Postgres 11+).
Do not add `not null` without a default to a table that already has rows.

**Rename or change a column (expand -> migrate -> contract):**

1. Add the new column. Deploy code that writes both and reads the new one, falling back
   to the old one.
2. Backfill in a separate migration.
3. Only after **every client** has stopped using the old column, drop it.

**Why this matters here:** on-site Pis sync periodically and may stay offline for days
on old code, per `CLAUDE.md`. The sync endpoint must keep serving the payload shape those
Pis expect. Version the payload, and drop an old field only when no active site still
reports an old sync version.

**Indexes:** project tables are small, so a plain `create index` inside the migration is
fine. `create index concurrently` cannot run inside a transaction block. Use it only for
a large table, as a migration of its own, and check how the CLI applies that file first.

**Large backfills:** update in batches by primary key range instead of one statement over
the whole table.

## Review checklist for a migration

- [ ] RLS enabled and policies present for every new table
- [ ] `customer_id` present and indexed on every tenant table
- [ ] `timestamptz`, not `timestamp`
- [ ] No destructive statement without the user's approval
- [ ] Old Pi sync payloads still served after this change
- [ ] `supabase db reset` runs clean locally; types regenerated

---
Adapted from the `database-migrations` skill of ECC (MIT License, © 2026 Affaan Mustafa),
reduced to the Supabase CLI workflow and this project's sync constraints.
