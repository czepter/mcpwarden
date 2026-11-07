# UI backlog: deferred mockup items

As of: 2026-11-05 · Source: [`docs/ui-mockup-review.md`](../ui-mockup-review.md) (owner decisions on the 11 open design items).

Language: this document is English; the drafts and the product UI are German, so UI labels are quoted in German.

These items from the mockup review were deferred by the owner. They are not rejected: each one stays here with what the mockup shows, why it is out of scope now, the trigger to revisit it and rough implementation notes. The mockup boards are no longer readable as a Claude artifact; the screenshots in [`docs/ui-review/`](../ui-review/) are the reference.

| Item | Page | Revisit when |
|---|---|---|
| ~~[U4](#u4-time-window-letzte-7-tage-in-the-upstream-list)~~ | Upstream list | Done: time window with p95 and "Letzte 24 Aufrufe" (`?window=`) |
| [U7](#u7-paging-footer-in-the-upstream-list) | Upstream list | The per-user upstream limit is raised |
| ~~[T1](#t1-upstream-list-with-24-h-bars-left-of-the-detail)~~ | Upstream detail | Done: side list with 24 h bars, availability and heatmap (`features.healthHistory`) |
| ~~[S6](#s6-statistics-filter-alle-upstreams)~~ | Statistics | Done with the statistics page (`?upstream=<slug>`) |
| ~~[D6 phase 2](#d6-phase-2-attention-card-beside-the-kpi-row)~~ | Dashboard | Done: KPI row, chart "Aufrufe pro Minute", attention card in the right column |

## U4: time window "Letzte 7 Tage" in the upstream list

**What the mockup shows.** The header of the upstream list carries a time window control "Letzte 7 Tage" next to the actions. The effect on the list is not defined in the draft (comparison item 8): there are no time-dependent columns in the list.
Screenshots: [`upstreams-mockup.png`](../ui-review/upstreams-mockup.png), [`upstreams-m-mockup.png`](../ui-review/upstreams-m-mockup.png); current state [`upstreams-impl-after.png`](../ui-review/upstreams-impl-after.png).

**Why it is out of scope now.** The list shows the current status, type, tools and last test. Nothing in it depends on a window, so a control would be decoration without effect. A window needs data that is only aggregated in phase 2 (per-upstream call counts and error rates over time).

**Trigger to revisit.** Phase 2 statistics or `health-history` adds a time-dependent column to the list (for example calls or error rate per upstream).

**Implementation notes.**
- Reuse `TimeWindow.vue` (already used by the statistics page) and keep the choice in the route query (`?window=7d`) so reloads and links keep it.
- Extend `GET /api/upstreams` (or a separate `stats/summary` call per page of upstreams) with the aggregated column; do not add the control before a column consumes it.
- Contract schema in `tests/contract/schemas.ts` and the mock in `mocks/handlers/upstreams.ts` change together; add a mockup-parity check that the control exists and the column changes with it.

## U7: paging footer in the upstream list

**What the mockup shows.** A footer below the table: "Zeige 1–7 von 7 · 10 pro Seite" with paging.
Screenshots: [`upstreams-mockup.png`](../ui-review/upstreams-mockup.png), [`upstreams-m-mockup.png`](../ui-review/upstreams-m-mockup.png).

**Why it is out of scope now.** The per-user limit is 50 upstreams (`limits.maxUpstreams`), so the list is small enough to render in one piece. The implementation already has the count line "7 Upstreams" above the table (U6). Paging would add a control with no benefit at this size and complicates filtering and the attention hint.

**Trigger to revisit.** The upstream limit is raised well above 50 (or removed for some roles), or the list shows measurable slowness or scrolling pain at the current limit.

**Implementation notes.**
- Prefer server paging (`?page=&pageSize=`, total in the response) over client paging once the limit grows; keep filters and the text search server side then.
- Footer through the `footer` slot of `DataSection.vue`; page size choice 10/25/50 in the query, 44 px targets for the controls.
- Keep the "N Upstreams" count line; the footer adds the range ("Zeige 1–10 von 120").

## T1: upstream list with 24 h bars left of the detail

**What the mockup shows.** The upstream detail page has a second column to its left with the list of all upstreams, each with a 24-bar sparkline of the last 24 hours. Selecting an entry moves from detail to detail without going back to the list.
Screenshots: [`upstream-detail-mockup.png`](../ui-review/upstream-detail-mockup.png), [`upstream-detail-m-mockup.png`](../ui-review/upstream-detail-m-mockup.png); current state [`upstream-detail-impl-after.png`](../ui-review/upstream-detail-impl-after.png).

**Why it is out of scope now.** The bars need `health-history` (status per hour), which arrives with phase 2 (comparison decision 7; T3 stays deliberately omitted until then). Without the bars the side list would only duplicate the list page and cost horizontal space on the detail page, which already holds tabs and a two-column overview.

**Trigger to revisit.** `health-history` ships (`features.healthHistory` becomes true in `/api/me/capabilities`), together with the statistics work of phase 2.

**Implementation notes.**
- `SparkBars.vue` already exists; feed it from a new per-upstream 24 h series (one value per hour with a status class), so colour never carries the meaning alone (keep the text label).
- Layout: a nested route or layout slot for `/upstreams/[id]` with a 280 px side list at desktop widths; below the mobile breakpoint the side list collapses into the existing back link to `/upstreams`.
- Keep the list virtualised or capped: with the current limit of 50 a plain list is fine.
- Navigation between entries keeps the active tab (`?tab=`).

## S6: statistics filter "Alle Upstreams"

**What the mockup shows.** A select "Alle Upstreams" in the header of the statistics page next to the time window; choosing an upstream narrows the key figures, the chart and the result bars to that upstream.
Screenshots: [`stats-mockup.png`](../ui-review/stats-mockup.png); current state [`stats-impl-after.png`](../ui-review/stats-impl-after.png).

**Why it is out of scope now.** Deferred by the owner with the statistics work of phase 2. The API is ready: `stats/summary` already accepts `upstream`, so this is a UI-only task, but the page is being reworked in phase 2 and the filter should land with that rework (including the per-upstream latency table, whose rows would double as the filter).

**Trigger to revisit.** The next change to the statistics page, or earlier if users ask to inspect a single upstream.

**Implementation notes.**
- Add `upstream?: string` to the `statsApi.summary` call in `app/api/index.ts` and pass it from a select that lists the user's upstreams (`upstreamApi.list`), default "Alle Upstreams".
- Keep the choice in the route query (`?upstream=<slug>`) next to the existing window; validate the slug against the list and fall back to "Alle Upstreams" for unknown values.
- The mock handler in `mocks/handlers/` must filter by `upstream`, and the contract test should cover both calls; a mockup-parity check asserts the select, its 44 px height and that the totals change.
- Select, not a radio list: the number of upstreams is bounded by the limit but can reach 50.

## D6 phase 2: attention card beside the KPI row

**What the mockup shows.** "Braucht Aufmerksamkeit" as a side column to the right of the key figures and the chart "Aufrufe pro Minute".
Screenshots: [`dashboard-mockup.png`](../ui-review/dashboard-mockup.png), [`dashboard-m-mockup.png`](../ui-review/dashboard-m-mockup.png).

**What is implemented now.** Decision of 2026-11-05: the card sits above the clients table while there is at least one item and is hidden when empty; the page empty state (no clients) is unchanged.

**Why the side column waits.** A right-hand column only makes sense next to the KPI row and the chart (phase 2, decision 4). Before that, the area beside the single table would stay empty.

**Trigger to revisit.** The dashboard gets the KPI row and the chart in phase 2.

**Implementation notes.**
- Two-column grid at the `lg` breakpoint (content 2fr, attention 1fr); below it the card keeps its position above the table, so the mobile order does not change.
- Keep hide-when-empty behaviour; do not reserve space for an empty column.
- The e2e check "above the clients table" in `tests/ui/e2e/mockup-parity.spec.ts` has to change to "beside the KPI row at desktop width, above the table on mobile".
