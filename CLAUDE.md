# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is currently empty — no application code, build tooling, or tests exist yet.
There are no build/lint/test commands to document because none of the app scaffolding has been
created. Once real code lands, replace this section with actual commands (how to install deps,
run the dev server, run a single test, lint, etc.) instead of leaving this note.

## What this project is

A multi-tenant SaaS product ("**עוזר לגבאי**") that turns an existing single-site home/synagogue
automation system into something installable and centrally manageable across many independent
customer sites (private homes, synagogues, yeshivas).

The existing (already working, single-site) hardware/software this product is built on:
- One **Raspberry Pi** per site running **Node-RED** (scheduling engine + dashboard) and
  **Mosquitto** (local MQTT broker).
- Multiple **ESP32** units per site (generic IDs A, B, C…), each driving an 8-channel relay
  board (AC units, lighting, water heater/boiler) and optionally a DFPlayer Mini module for
  music/PA over MQTT.
- A scheduling engine that fires events by civil time **and** by halachic time (sunrise/sunset
  ± offset, via Hebcal), aware of day categories (weekday / Friday / Erev Shabbat / Shabbat /
  Erev Chag / Chag).

The full product/planning spec (Hebrew) is in `docs/product-plan.md` — read it before making
architectural decisions; the summary below only hits the points that affect how code should be
structured.

## Key architecture decision: hybrid cloud + local

(`docs/product-plan.md` §0.3)

- **Config, schedules, and channel mapping live in a central cloud database.** Customers always
  manage their site from one central web app, from anywhere — never tied to the site's local
  network.
- **Each on-site Pi keeps running its own scheduling engine and MQTT/ESP32 control locally**,
  exactly as it does today. It does **not** proxy every on/off command through the cloud in real
  time — only config changes and status reports go over that channel.
- **The Pi syncs with the cloud periodically** (pulls latest config/schedules, pushes status).
  If the site loses internet, the Pi keeps executing the last schedule it received; only *new*
  edits are delayed until connectivity returns.

This split (cloud = source of truth for config, Pi = source of truth for real-time execution)
should drive how any future backend/sync layer is designed — don't build a design that routes
every control command through the cloud in real time.

## ESP32 unit wiring convention

Units are assigned **geographically**, by physical electrical panel/location (e.g. one unit per
floor or per panel) — **not** by device category. A single unit's 8 channels normally mix AC +
lighting + whatever else happens to be wired to that panel. The channel-mapping UI must let each
channel take an independent category label regardless of which unit/panel it physically lives on
— don't assume "unit = category."

## Scheduling engine data model (get this right from the start)

(`docs/product-plan.md`, existing capabilities #3-#4 and §10 "תכונות מנוע תזמון...")

There are **two separate scheduling systems**, not one:
- A **weekly recurring engine**, keyed by day category (weekday / Friday / Erev Shabbat /
  Shabbat / Erev Chag / Chag, computed from Hebcal).
- A **Hebrew-date "special programs" engine**, for one-off/holiday events tied to a specific
  Hebrew date (Chanukah, Pesach, etc.) — layered alongside the weekly engine, not replacing it.

For multi-day holidays (Pesach, Sukkot), a special program needs the **same three-way day-category
model as the weekly engine (weekday / Shabbat / Chag), scoped to the holiday's own date range**,
not a single override for the whole holiday. A weekday that falls in Chol HaMoed, a Shabbat that
falls in Chol HaMoed, and Yom Tov itself each need their own action/time — and which civil dates
map to which of those three categories **shifts every year** (the holiday isn't pinned to a
weekday), so this mapping must be recomputed each year via Hebcal against the holiday's actual
civil dates, never hardcoded to a weekday. When Yom Tov itself coincides with Shabbat, don't
silently resolve it via a hardcoded priority — surface it to the user (see "Conflict warnings"
below) showing which category actually fires that year.

## Conflict warnings, not silent priority resolution

A "חוק-על" (priority override) already resolves conflicting schedule definitions, but resolving
silently isn't enough — the product needs to **surface the conflict to the user**, both when they
save a new definition that overlaps an existing one on the same channel with a contradictory
action, and for conflicts that only become known at a given year's computation (the Yom Tov /
Shabbat overlap above is one instance of this, not a special case to hardcode separately).

Within either engine, an event's day category must be assignable **per action (start vs. end),
not per event**. The home project shipped a real bug from getting this wrong: day category is
computed at civil midnight (not halachic nightfall), so a single event starting under "Erev
Shabbat" late at night and ending after midnight silently failed its closing action once the
category flipped to "Shabbat" underneath it. The fix that's already proven in production: let
each event be an on+off pair, an on-only action, or an off-only action, with day category set
independently per action. Design the schema this way up front — modeling it as "one day category
per event" will reproduce the same bug on every future site.

Also: the time-type field (fixed clock time vs. atmospheric/halachic offset) should default to
fixed time, exposed as a single toggle rather than a dropdown — this is a deliberate UX choice
from the home project, not an incidental detail.

## Decisions made after the plan document was written

These refine or add to `docs/product-plan.md` and aren't yet reflected in that file's text:

- **Product name:** "עוזר לגבאי" (an earlier placeholder, "אור-זמן", was used in early drafts —
  no longer current).
- **New feature (not in the original spec):** reminders for סוף זמן קריאת שמע and סוף זמן תפילה,
  toggleable per-time, shown alongside the daily zmanim.
- **Zmanim refresh cadence:** halachic times recalculate **daily**, not weekly.
- **Recommended stack** (accepted by the product owner, not yet built): Next.js (TypeScript) +
  Tailwind for the web app/API, Supabase (Postgres + Auth) for the backend/DB, Vercel for
  hosting.

## Design reference

A landing page and a customer dashboard (overview + channel-mapping screen) were designed as
Hebrew/RTL HTML mockups and approved as the visual direction — brand palette (dusk indigo +
amber), type pairing (Frank Ruhl Libre for display, Heebo for body). These currently exist only
as artifacts from planning sessions, not as files in this repo. Ask the user for the mockup links
if the real frontend needs to match them closely.

## Build order

(`docs/product-plan.md` §11 — follow this order; later phases depend on earlier ones)

1. Architecture decision — done, see above.
2. Central web server: auth + public landing page.
3. Multi-tenant data model: customer → ESP32 units → channel mapping.
4. Excel export/import for channel mapping.
5. Super-admin fleet management + ESP32 OTA updates (build together — both need a remote
   management channel to every Pi).
6. Code/firmware protection layer (easier to build in from the start than bolt on later).
7. Payments integration (subscription billing, separate from pay-to-activate-a-channel flows).
8. IVR phone control (ימות המשיח) — most complex/expensive integration, do last.
