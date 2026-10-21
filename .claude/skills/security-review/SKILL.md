---
name: security-review
description: Security checklist for this project's Next.js + Supabase + Vercel web app and its Pi/ESP32 sync channel. Use when adding auth, Server Actions, API routes, RLS policies, secrets, the Pi sync endpoint, payments, or anything that touches another customer's data.
---

# Security Review

The two biggest risks in this product are **one customer reading or changing another
customer's data**, and **a leaked privileged key**. Review those first, then the rest.

## 1. Keys and secrets

- Supabase **publishable/anon** key: may reach the browser, but only because RLS protects
  every table (see `supabase-postgres`).
- Supabase **service_role/secret** key: server-only. Never prefix it with `NEXT_PUBLIC_`,
  never import it in a file that runs in the browser, never send it to a Pi or ESP32,
  never log it. Code that uses it bypasses RLS, so it must filter by tenant itself.
- Any variable named `NEXT_PUBLIC_*` ships to every visitor. Treat it as public.
- Secrets live in Vercel environment variables and local `.env.local` (git-ignored).
- Before committing, search for leaked keys:

  ```bash
  git diff --cached | grep -nE 'sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}\.|sk_live_|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY' || true
  ```

## 2. Authentication (Supabase + Next.js)

- Use `@supabase/ssr` and let it manage the auth cookies. Do not override them to
  `SameSite=Strict`, which breaks the redirect back from OAuth and email links. The
  library's default (`Lax`, `HttpOnly` where applicable, `Secure` in production) is right.
- In server code (Server Components, Server Actions, route handlers, `proxy.ts`), verify
  the user with `supabase.auth.getUser()` (or `getClaims()` on newer versions). Do not
  trust `getSession()` on the server; it reads the cookie without validating it.
- Never put a token in `localStorage`.

## 3. Authorization: every server entry point

Server Actions and route handlers are public HTTP endpoints, even when only your own UI
calls them. Every one of them must:

1. Authenticate the user.
2. Load the target row and confirm the user belongs to its `customer_id` with the right
   role. **Never trust a `customer_id`, `site_id` or role that came from the client.**
3. Validate input with a schema (`zod`; read errors from `error.issues`).

Define Server Actions in a separate file that starts with `'use server'`, not inline in
a `'use client'` file.

```ts
'use server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Input = z.object({ channelId: z.string().uuid(), label: z.string().min(1).max(60) })

export async function renameChannel(raw: unknown) {
  const input = Input.parse(raw)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  // RLS limits the update to channels of customers this user belongs to;
  // zero updated rows means "not found or not allowed".
  const { data, error } = await supabase
    .from('channels')
    .update({ label: input.label })
    .eq('id', input.channelId)
    .select('id')
  if (error) throw new Error('Update failed')
  if (!data?.length) throw new Error('Channel not found')
}
```

Prefer the user-scoped client, so RLS enforces isolation. Use the service-role client
only when unavoidable, and then filter by the verified tenant explicitly.

## 4. The Pi sync channel

Per `CLAUDE.md`, the Pi pulls config/schedules and pushes status. It never relays
real-time commands through the cloud.

- Each site gets its own random device token, shown once at provisioning. The database
  stores only a hash. Support revoking and rotating it.
- The sync endpoint resolves the token to exactly one `site_id` and can only read that
  site's config and write that site's status. No other parameters select the site.
- HTTPS only. Validate the payload shape and size of everything the Pi uploads.
- The Pi holds no Supabase credentials.
- Version the sync payload. Offline Pis may run older code, so the endpoint must stay
  backward compatible (see `db-migrations`).

## 5. On-site network (Pi, Mosquitto, ESP32)

- Mosquitto: no anonymous access. Use a username/password per ESP32 unit and ACLs that
  restrict each unit to its own topics. Listen on the LAN only, never port-forwarded.
- Node-RED: editor protected with a password (`adminAuth`), not exposed to the internet.
- ESP32 OTA updates (build phase 5): accept only signed images from the expected source.

## 6. Abuse protection

- Rate-limit login, sign-up, password reset and the Pi sync endpoint with a shared
  store (e.g. Upstash Redis or the platform's firewall). In-memory counters do not work
  on Vercel's serverless functions.
- Identify clients by the platform-provided IP or by the device token, not by a raw
  `x-forwarded-for` header you parse yourself.

## 7. Browser hardening

- Content Security Policy: start strict (`default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`). Use Next.js nonces instead of
  `'unsafe-inline'`. Add the Supabase project URL to `connect-src`.
- React escapes output by default. Avoid `dangerouslySetInnerHTML`. If it is unavoidable,
  sanitize with DOMPurify first.

## 8. Errors and logs

- Return generic messages to the client. Log details server-side.
- Never log tokens, keys, passwords or full phone numbers (the later IVR phase handles
  phone numbers, which are personal data).

## 9. Payments (build phase 7)

- Verify every webhook signature and process each event idempotently by event id.
- Grant access (activate a channel, extend a subscription) only from verified webhooks,
  never from a client redirect.

## Checklist before merging

- [ ] No privileged key in client code, `NEXT_PUBLIC_*` variables, logs or git history
- [ ] Every new table has RLS and policies; isolation tested with two users
- [ ] Every Server Action / route handler authenticates, authorizes by tenant, validates input
- [ ] No `customer_id` / `site_id` / role trusted from the client
- [ ] Pi endpoint scoped to one site by a hashed, revocable token
- [ ] Rate limiting on auth and sync endpoints uses a shared store
- [ ] Error responses leak no internals

---
Adapted from the `security-review` skill of ECC (MIT License, © 2026 Affaan Mustafa).
Generic and blockchain sections removed; Supabase, multi-tenant and device sections added.
