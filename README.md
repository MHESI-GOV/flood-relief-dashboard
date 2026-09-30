# จุดบริการ Interactive Dashboard — Progress / Architecture Notes

Status as of 2026-10-01 ~04:17: **All 3 pages built and working**, tested live in a browser
against the real Google Sheet (98 eligible service points, 9/9 categories present, 30 provinces).
Known gaps: no Google Maps (uses Leaflet/OSM instead, see decision #3 below), ตำบล filter has no
data to cascade into, and the Sheet itself still has one missing row + one truncated cell (see
"Known live-data issue" above) — none of these block the dashboard from working correctly against
what the Sheet actually contains today.

**Bug fixed during testing:** the sheet's own "บริการซ่อมรถจักยานยนต์" header has a typo (missing
ร — should be "รถจักรยานยนต์"). The original keyword matcher for the motorcycle category didn't
account for this and silently matched nothing (0 count). Fixed by matching on the shorter, typo-safe
"รถจัก" substring — see `HEADER_MATCHERS.cat_moto` in `js/data.js`. This mattered: eligible count
went from 94 → 98 once fixed (4 points whose only service was motorcycle repair had been wrongly
excluded).

## Data source

Google Sheet: `https://docs.google.com/spreadsheets/d/19MlcneuPV-DXfaYAYz3KzEGfiIv4PtigPNrrieQ883I/edit?gid=0#gid=0`
tab gid=0 ("ข้อมูลจุดบริการ"). **The sheet's own column set already changed once during this
session** (a "บริการตรวจสอบระบบไฟฟ้าในบ้าน (มี/ไม่มี)" column was inserted, and "โทรศัพท์" became
"เบอร์โทรศัพท์", by someone editing the sheet directly) — this is exactly why `data.js` resolves
columns **by matching header text/keywords at load time**, never by fixed column letter/index. If
the sheet's columns move again, `data.js` should keep working unless a header's matched keyword
itself changes (see `HEADER_MATCHERS` at the top of the file — update the keyword there if so).

Columns as of last check (17, A–Q): จังหวัด, เขต/อำเภอ, หน่วยบริการ, สังกัด, ผู้ประสานงาน,
เบอร์โทรศัพท์, Location, บริการซ่อมรถจักยานยนต์ (มี/ไม่มี), บริการซ่อมรถยนต์ (มี/ไม่มี),
บริการซ่อมเครื่องใช้ไฟฟ้าขนาดเล็ก (มี/ไม่มี), บริการซ่อมเครื่องใช้ไฟฟ้าขนาดใหญ่ (มี/ไม่มี),
บริการตรวจสอบระบบไฟฟ้าในบ้าน (มี/ไม่มี), บริการด้านสาธารณะสุข (มี/ไม่มี), บริการด้านอาหาร (มี/ไม่มี),
บริการศูนย์พักพิง (มี/ไม่มี), บริการอื่นๆ (ระบุ), คำอธิบายเพิ่มเติม.

**No ตำบล (subdistrict) column exists at all.** The spec asks for a จังหวัด→อำเภอ→ตำบล cascading
filter; the third tier has nothing to cascade into. Built the filter as จังหวัด→อำเภอ only, with the
ตำบล tier rendered disabled/"ไม่มีข้อมูลตำบลในชุดข้อมูล" rather than fabricating subdistrict data
(spec section 24 explicitly forbids inventing missing data).

This sheet was populated earlier in this session by merging two upstream sources (a Google Form
raw-response tab, and a Power BI export from กรมพัฒนาฝีมือแรงงาน) — see the main D:\Claude session
history / `D:\Claude\Flood Dashboard\รวมข้อมูลจุดบริการ_2แหล่ง_01-10-2569.xlsx` for that lineage.
That is now irrelevant to this dashboard — the dashboard treats the Sheet as the single source of
truth and re-derives everything from its live content, per spec section 19.

**Known live-data issue, re-checked 2026-10-01 ~02:50 and still present:** one row (2nd submission
for "สถาบันบัณฑิตพัฒนบริหารศาสตร์ (นิด้า)") is missing from the live Sheet, and
"สาขาวิชาเทคโนโลยีและสื่อสารการศึกษา คณะครุศาสตร์อุตสาหกรรมและเทคโนโลยี
มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี" is truncated down to just
"มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี" — both from a paste/rendering corruption earlier in the
session (Chrome window was backgrounded, screenshots were failing —
`document.visibilityState: "hidden"`). Phone-number formatting, which had the same kind of
corruption (leading zeros dropped), **has since been fixed in the live sheet** (by the user, or it
resolved itself — confirmed clean on re-check), so the dashboard does not need to special-case that
anymore. The two remaining issues (missing row, truncated name) are genuine source-data gaps the
cleaning layer cannot recover — **TODO when the Chrome window is visible again:** re-paste row 28
("สถาบันบัณฑิตพัฒนบริหารศาสตร์ (นิด้า)", full data still sitting in
`...scratchpad\mapped_source1.json` index 26) and fix the truncated name cell; the dashboard will
pick up the fix automatically on next load (no code changes needed).

## Key architecture decisions

1. **Not a Claude Artifact.** A published claude.ai Artifact runs under a strict CSP that blocks
   *all* external requests (scripts, fetch, images, tiles) — verified against the
   `artifact-capabilities` skill's capability list (`artifact, assets, comments, db, downloads,
   files, mcp, permissions, room, sample, self, user` — no generic "fetch a URL" capability).
   Google Sheets live-fetch and Google Maps tiles both require loading from external hosts, which
   an Artifact cannot do. So this is built as an ordinary **local static web app** (plain
   HTML/CSS/JS, no build step) meant to be served by a simple local HTTP server (browsers block
   `fetch`/module scripts on `file://`) and opened in a normal browser tab, where there is no such
   CSP restriction.
2. **Live fetch technique:** Google Sheets' CSV/JSON export endpoints don't send
   `Access-Control-Allow-Origin`, so a plain `fetch()` from a different origin is blocked by CORS
   (verified with curl — no CORS header present). The **gviz JSONP endpoint** works around this:
   `https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:json&gid=<GID>` returns
   `google.visualization.Query.setResponse({...})` wrapped for script-tag loading, not JSON fetch —
   loaded via a dynamically-inserted `<script>` tag (classic JSONP pattern), which browsers don't
   subject to CORS the same way `fetch` is. This is what `js/data.js` does. Every page load re-fetches
   the Sheet fresh (a short in-memory cache avoids re-fetching when switching tabs within one session) —
   this satisfies "when the Sheet changes, the dashboard updates" (reload the page = fresh data; no
   polling/websocket, which the spec doesn't require).
3. **Google Maps substitution → Leaflet + OpenStreetMap.** The spec asks for Google Maps JS API with
   an env-var key. A build-less static app has no real "environment variable" mechanism, and I have
   no Google Maps API key from the user. Default: **Leaflet + OpenStreetMap tiles** (free, no key,
   same marker-clustering capability via the `Leaflet.markercluster` plugin, CDN-loaded — fine here
   since this isn't a CSP-sandboxed Artifact). `config.js` exposes `window.GOOGLE_MAPS_API_KEY` as an
   empty-string placeholder the user can fill in later; `js/location.js` is written so the map
   provider is a single swappable module if they want to switch to real Google Maps later. This
   substitution was a judgment call made to keep the dashboard actually runnable today — flagged to
   the user in chat, not silently done.
4. **9 standard service categories are *derived*, not stored 1:1.** The Sheet has 7 explicit
   "(มี/ไม่มี)" boolean columns (รถจักรยานยนต์, รถยนต์, เครื่องใช้ไฟฟ้าเล็ก, เครื่องใช้ไฟฟ้าใหญ่,
   สาธารณสุข, อาหาร, ศูนย์พักพิง) plus one free-text "บริการอื่นๆ (ระบุ)" column. The spec's 9th and
   5th categories (อื่นๆ, ซ่อมระบบไฟฟ้าในครัวเรือน) don't have dedicated Sheet columns — ซ่อมระบบไฟฟ้าในครัวเรือน
   is derived by keyword-matching "ระบบไฟฟ้า" inside บริการอื่นๆ text (that's where it was recorded
   during the earlier merge); อื่นๆ = บริการอื่นๆ (ระบุ) is non-empty. See `deriveCategories()` in
   `js/data.js` — this mapping is documented there too, change both places together if it's wrong.
5. **Service Point ID.** The Sheet has no explicit ID column. Each row is one service point by this
   schema's own convention (established when the Sheet was populated), so `data.js` synthesizes
   `SP-<row index>` as the unique key for counting/dedup, per spec section 8 ("นับจาก Unique Service
   Point ID"). Exact full-row duplicates (all 16 fields identical) are dropped during cleaning.
6. **Eligibility rule** (spec section 5): a row is included only if at least one of the 9 derived
   service-category booleans is true. Applied once, in `data.js`, before the dataset is handed to
   any page — not a per-page UI filter.

## File layout

- `index.html` — app shell, sidebar + header, three `<section>` "pages" toggled by hash route
- `config.js` — `window.GOOGLE_MAPS_API_KEY` placeholder (empty = use Leaflet/OSM)
- `css/style.css` — purple/white/light-gray "modern government" theme, responsive breakpoints
- `js/data.js` — fetch (gviz JSONP) → clean → eligibility rule → category derivation → dedupe →
  shared dataset + console-only data-quality report (spec section 11)
- `js/main.js` — router, sidebar toggle, calls `data.js` once, passes dataset to whichever page
  module is active
- `js/summary.js`, `js/location.js`, `js/detail.js` — one page each, all read the same shared
  dataset object (never re-derive or re-fetch independently) so counts reconcile across pages per
  spec section 23's acceptance criterion

## How to run

No build step. From this folder: `python -m http.server 8080` (or any static file server), then
open `http://localhost:8080/`. Opening `index.html` directly via `file://` will NOT work (module
scripts and the JSONP fetch need an http:// origin).

## Task checklist (mirrors the session's TaskCreate list)

- [x] data.js pipeline (fetch/clean/rules/normalize/dedupe)
- [x] app shell + navigation
- [x] Page 1 Summary
- [x] Page 2 Location (map)
- [x] Page 3 Detail table
- [x] error handling + data-quality console + browser test pass — verified: normal load, forced
      load-failure (bad sheet ID) shows a friendly Thai error banner and keeps the last good data
      on screen rather than crashing, click-to-filter from the category chart correctly lands on
      Location with that category pre-applied, row click on Detail opens a modal with full record
      + service tags, pagination/sort/search/cascading filters all checked live.

## Follow-up changes (same session, after initial build)

- Service-category filter on Location and Detail pages converted from `<select multiple>` to a
  checkbox list (`.checkbox-list` in `css/style.css`) — easier multi-select UX.
- Added a **global "เฉพาะ กทม. และปริมณฑล" toggle** in the topbar (`index.html` `#bkkToggle` +
  `js/main.js`). `window.App.state.bkkOnly` + `window.App.filterRecords()` is the shared gate —
  every page's `render()` now calls `window.App.filterRecords(dataset.records)` as its base record
  set instead of `dataset.records` directly, so the toggle applies consistently across all three
  pages (this is also why `summary.js` no longer reads category/province counts from the static
  `dataset.quality` — those were computed once over the *whole* dataset and would've ignored the
  toggle; it now recomputes counts from the live filtered `records` list on every render).
  BKK-metro province list: กรุงเทพมหานคร, นครปฐม, ปทุมธานี, นนทบุรี, สมุทรปราการ, สมุทรสาคร — same
  6-province grouping already used elsewhere in this user's Flood Dashboard project.
- Detail table: "เบอร์ติดต่อ" and "สังกัด" columns given a `fit-col` CSS class (`width:1%;
  white-space:nowrap`) so they shrink to their content instead of stretching.

## Not done / possible next steps

- Fix the two known Sheet data issues (missing นิด้า row, truncated org name) once the Chrome
  window is visible — see "Known live-data issue" above.
- If the user gets a Google Maps API key, swap `js/location.js`'s Leaflet calls for the Google
  Maps JS API (paste the key into `config.js`'s `GOOGLE_MAPS_API_KEY` first).
- Mobile responsive layout was written with standard breakpoints (`css/style.css`, `@media
  max-width: 820px / 520px`) but could not be visually verified — `resize_window` did not actually
  change the browser viewport in this session's browser-automation tooling (confirmed via
  `window.innerWidth` staying at 958 after a resize request), a tooling limitation, not something
  to "fix" in the app. Worth a manual check in a real mobile browser or DevTools device toolbar.
- True cross-viewer live sync (dashboard auto-updating the instant the Sheet changes without a
  page reload) isn't implemented — each page load re-fetches fresh, which satisfies the spec's
  "when Sheets data changes, Dashboard updates" in the reload sense, but there's no push/poll.
  Could add a `setInterval` re-fetch if the user wants near-real-time updates without a manual
  reload.
