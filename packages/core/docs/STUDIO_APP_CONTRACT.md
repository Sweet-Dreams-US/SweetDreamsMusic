# Studio App Contract — {{STUDIO_NAME}} (apps/{{SLUG}})

**Read this at the start of every Claude Code design session in this app.**
This file is the standing instruction set. The goal of a design session is to
give {{STUDIO_NAME}} its own feel — never to change how the platform works.

## Yours to restyle (go wild)
- `app/globals.css` — colors, fonts, design tokens. This is the studio's skin.
- Page **layouts, sections, imagery, motion** on the marketing pages
  (home, about, pricing display, engineers, contact, events, bands, media).
- `public/` — their photos, logo, icons, og-image.
- Component *styling* (classNames, ordering, animation) anywhere.

## Never touch (the contract)
1. **`packages/core/` is off-limits from a studio app session.** Core changes
   are platform releases that affect EVERY studio — they happen in their own
   sessions, land on Sweet Dreams (ring 0) first, and require the golden
   battery. CODEOWNERS enforces this in CI.
2. **No hardcoded brand, prices, hours, or copy.** Brand → `brand_settings`
   (Control Panel → Brand). Copy → `site_content` (Control Panel → Content).
   Prices/hours/rooms → `studio_rooms` (Control Panel → Studios & Pricing).
   If a string you want to change isn't CMS-driven yet, add the CMS key in
   core (separate core session), don't inline it.
3. **Flow contracts stay intact**: the booking flow's steps and pricing math,
   checkout, auth, the dashboard/hub/admin route structure, API routes. Move
   them around the page, restyle them — never fork their logic.
4. **SEO surface changes must be deliberate.** Title/description templates
   come from brand + page templates in core. Run the SEO golden against THIS
   app before shipping metadata changes.

## Definition of done for a design session
- `npm run build` clean from the repo root
- The golden battery green against this studio's database
- No diffs outside `apps/{{SLUG}}/`
- Screenshots of home/book/pricing at mobile + desktop in the PR

## The one-liner to remember
**Core is the engine, this app is the paint. Paint never touches the engine.**
