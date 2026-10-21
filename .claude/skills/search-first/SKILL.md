---
name: search-first
description: Look for an existing, well-maintained library or the repo's own code before writing a new utility, and vet any dependency before adding it. Installing anything requires the user's approval. Use when starting a feature, adding a dependency or integration, or about to write a helper that may already exist.
---

# Search First

Before writing a new utility or integration, check whether it already exists. Then
recommend; do not install on your own.

## Approval rule

This skill is **read-only research**. Do not install packages, add Node-RED nodes,
configure MCP servers, flash firmware or change project-wide config until the user
approves that specific change in the current task. When something needs credentials,
a paid service or network writes, stop and present a recommendation instead.

## Steps

1. **Search the repo first** for an existing module, helper or test that does this.
2. **Search the ecosystem** relevant to the layer you are working in (table below).
3. **Vet each candidate** (checklist below).
4. **Decide:** adopt as-is, wrap thinly, combine 2-3 small packages, or build custom.
   Explain why.
5. **Ask for approval**, naming the exact package and version, then implement.

## Where to look, by layer

| Layer | Look first at |
|---|---|
| Hebrew calendar, zmanim, holidays | `@hebcal/core` (already the project's source for halachic times) |
| Web app (Next.js / React) | the framework's built-ins, then `zod`, `@supabase/ssr`, `@supabase/supabase-js` |
| Excel import/export (build phase 4) | `exceljs` |
| Pi: Node-RED | built-in nodes first, then the Node-RED flow library (`node-red-contrib-*`) |
| Pi / server: MQTT | the `mqtt` npm package |
| ESP32 | the ESP32 Arduino core libraries, `PubSubClient` (MQTT), `ArduinoJson` |

## Vetting checklist

- [ ] Actively maintained (recent releases, issues answered)
- [ ] License compatible with a commercial product (MIT, Apache-2.0, BSD)
- [ ] Exact package name checked; no look-alike or typo-squatted name
- [ ] Few dependencies, and no unexplained `postinstall` / install scripts
- [ ] Small enough for the job; no large framework pulled in for one function
- [ ] For the Pi and ESP32: runs within the device's memory and CPU limits
- [ ] Never install with `curl ... | bash` or similar fetch-and-run commands

## Example

```
Need:      parse an uploaded .xlsx of channel mappings
Repo:      no existing parser
Found:     exceljs (MIT, maintained, no install scripts)
Decision:  ADOPT. Ask the user before running the install.
```

---
Adapted from the `search-first` skill of ECC (MIT License, © 2026 Affaan Mustafa),
keeping the approval checkpoint and adding this project's stack.
