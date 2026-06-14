# Rubric: High-Trust Mobile UI Additions

All features use only existing TfL API data already in the app.

---

## Feature A: Platform Badge on Departures (2/9)

**What**: Show `platformName` from `a.platformName` as a compact badge next to each departure row

**Data source**: Already in `normalizeArrival()` return — `platformName` field exists at `stops.js:158`. Already rendered in `ui-departures.js` line ~90 (the departure HTML builder).

**Where to modify**:
- `ui-departures.js` — the `loadArrivals` function where departure HTML rows are built (around line 79-96)

**UI design** (mobile-first):

```
┌─────────────────────────────────────┐
│  🚇  Circle  │  Westbound           │
│────────────────────────────────────│
│  [3]  Embankment    │  2 min  Due    │
│  [1]  Embankment    │  4 min         │
│  [2]  Embankment    │  7 min         │
└─────────────────────────────────────┘
```

- Platform badge = `[3]` rendered as a dark pill (`padding: 1px 6px; font-size: 10px; font-weight: 700; font-family: monospace; background: rgba(255,255,255,.1); border-radius: 4px;`)
- Only shown when `a.platformName` is non-empty AND `a.platformName` is numeric or short (e.g. "3", "A", "14") — filter out long values like "Westbound" which is platform metadata, not an actual platform number
- Placement: left edge of the destination row, before the destination name
- If platform is a compass direction (Eastbound/Westbound/etc) → skip, these are not platform numbers

**Edge cases**:
- `platformName` is `""` → no badge (handled: `a.platformName || ''`)
- `platformName` is `"Bus Stop S"` → show as text badge `[S]`
- `platformName` is `"Westbound"` → skip (compass/platform metadata, not platform number)
- Multiple arrivals at same platform → correct plural display

**Integration**: Zero changes to API calls. Pure UI rendering addition.

---

## Feature B: Accessibility Badge on Stop Markers (3)

**What**: Show ♿ step-free badge on stops that have step-free access, plus filter in journey planner

**Data source**: `Stops.getArrivals()` already calls `Api.getStopProperties(stopId)` — returns `accessibilitySummary`, stepFree info in child stops. Also available from `Stops.getNearby()` stop data if we extend the API call.

**Actually simpler path**: TfL StopPoint API returns `accessibilitySummary` and `stepFree` fields. We can:
1. Add a lightweight fetch in `stops.js`: a new `getStopAccessibility(stopId)` function that calls the same `/StopPoint/{id}` endpoint we already use in `getStopProperties`, but only extracts a simple `{ stepFree: bool, hearingLoop: bool, text: string }`
2. Cache the result per stopId in a module-level `Map` so repeated lookups (same stop in departures, map popups, etc.) don't re-fetch
3. Render a ♿ badge on:
   - Stop markers on the map (`map.js` stop popup header)
   - Departure panel header (`ui-departures.js`)
   - Stop search results (`ui-journey.js` or `ui-nearby.js`)

**Where to modify**:
- `stops.js` — new function `getStopAccessibility(stopId)` with a simple `Map` cache
- `map.js` — in popup header HTML, add ♿ when stepFree
- `ui-departures.js` — in the panel header HTML, add ♿ badge next to stop name
- `ui-nearby.js` — in nearby stop cards

**UI design** (mobile-first):

Stop header:
```
🚏 Bromley-by-Bow  ♿  [H]
```

Map popup:
```
🚏  Bromley-by-Bow  ♿  [H]
```

- ♿ badge: `font-size: 14px; opacity: .8; vertical-align: middle;`
- Only shown when `stepFree === true`
- Also show `[H]` (hearing loop) if available — smaller, lighter opacity

**Edge cases**:
- API may not return accessibility data for all stops → `catch { return null }`
- Cache expiry: set a 10-minute TTL on the cached accessibility data (app uses a 60s cache for status; 10min is fine for static accessibility)
- Bus stops almost never have accessibility data at the API level → function returns null quickly

---

## Feature C: Planned Works / Engineering Works (4)

**What**: When viewing a **future-date timetable**, check TfL disruption API for planned closures on that line/date and show a warning banner. Also show a small indicator on the date bar if the selected date has disruptions.

**Data source**: `Status.fetchDisruptions()` already fetches at `status.js:21` from `/Line/Mode/{modes}/Disruption`. Returns disruption objects with:
- `closureText` — human-readable closure description
- `fromDate` / `toDate` — ISO date strings for when the disruption applies
- `affectedRoutes` — array of route objects with line names

**Where to modify**:
- `ui-timetable.js` — in `renderTimetableContent`, after the disruption check (line 296), add a check against the selected `date`:
  1. If viewing today, existing behavior unchanged
  2. If viewing a future/past date, check `Status.fetchDisruptions()` data for entries matching the lineId AND whose date range covers the selected date
  3. Show warning banner above the schedule grid

**UI design** (mobile-first):

```
┌─────────────────────────────────────┐
│  Mon, 15 Jun 2026               ◀▶ │
│  Today  Tomorrow                     │
│ ╔═══════════════════════════════════╗│
│ ║  ⚠️ Planned works Jun 14-16       ║│
│ ║  No service between Barking       ║│
│ ║  and Upminster. Use rail          ║│
│ ║  replacement buses.               ║│
│ ╚═══════════════════════════════════╝│
│  ▶ Eastbound · Monday                │
│  ┌──────────────────────────────┐   │
│  │ 05:28  05:58  06:28  06:58   │   │
│  │ 07:28  07:58  08:28  08:58   │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

- Warning banner: `background: rgba(234,179,8,.15); border: 1px solid rgba(234,179,8,.4); border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.5; margin: 8px 0;`
- Icon: yellow ⚠️ emoji
- Title in bold: "Planned works on this date"
- Description: first sentence of `closureText` (truncate at 120 chars with "..." + "Read more" link — but for simplicity, show full text since TfL descriptions are brief)
- Date range shown: "Jun 14-16" → extract from `fromDate`/`toDate`

**Date bar disruption indicator**:
- Add a small dot/badge on the date bar button for dates with planned works
- Red dot: `width: 6px; height: 6px; border-radius: 50%; background: #ef4444; position: absolute; top: 2px; right: 2px;`

**Edge cases**:
- `disruptionsCached` might be stale (2 min cache in `Status.fetchDisruptions`) → on fetch error, show nothing, not stale
- A disruption might span multiple lines → filter by `d.affectedRoutes.some(r => r.name === lineId)`
- `fromDate`/`toDate` might be `null` → treat as open-ended disruption, always show
- Multiple disruptions on same date → stack banners with `margin-bottom: 6px`

---

## Feature D: Line Route Map (5)

**What**: When viewing a timetable, show the full line route on the map with all station markers. User can tap a station to jump to that station's departures.

**Data source**: `Api.getLineStopPoints(lineId)` already exists at `api.js:165`. Returns array of stop objects with `id`, `commonName`, `lat`, `lon`, `modes`, `lines`, `stopLetter`, `accessibilitySummary`.

**Where to modify**:
- `ui-timetable.js` — in `showRouteTimetable`, after fetching timetable data, also fetch line stop points (if not cached)
- A new `_ttCache.lineStops` field stores the result
- `renderTimetableContent` adds a "Show on map" button below the date bar
- `map.js` — add `showLineStops(stops, lineId, color)` to draw route line + station markers

**UI design** (mobile-first):

Below the date bar, before the schedule grid:

```
┌─────────────────────────────────────┐
│  ═══ District Line (37 stops)   [🗺]│
└─────────────────────────────────────┘
```

- `[🗺]` button toggles map focus: calls `MapView.fitBounds` to show all line stops, draws the route as a semi-transparent line with stop markers
- Clicking a stop marker → show a small popup with stop name + "View departures" button
- "View departures" → calls `UI.showDepartures(stopId, stopName)`

On the map:

```
         [Upminster]
            ●
            │
[Ealing]──●─┴─●──[Barking]
            │
         [Wimbledon]
```

- Route line: `MapView.addRoute(path, lineColor, lineId)` — we already have this function
- Stop markers: small dots with stop names in popup on click
- Color: use `Stops.getModeColor('tube')` or the line's actual color (from status data)
- If the map is in 3D mode, draw on both 2D and 3D maps

**Edge cases**:
- Line has 100+ stops (buses) → show only first 50, with "(and N more)" label
- `getLineStopPoints` fails → hide the "Show on map" button entirely
- 3D map: need to sync line stops to MapLibre GL (use existing `addRoute3d` pattern)
- On mobile, map toggle should switch to full-screen map (using existing `openMapOverlay` flow)

**Integration note**: This touches map.js, ui-timetable.js, and app.js (for the click handler on line stop markers). The map rendering should use existing `addRoute` and `showRouteStopMarkers` patterns.

---

## Feature E: Connection Alerts During Trip (6)

**What**: While user is following turn-by-turn navigation in `start-trip` mode, check if the next transit leg's departure is still on time. Alert if delayed or cancelled.

**Data source**: `Stops.getArrivals(stopId)` — we already poll departures. During trip navigation, we already run `updateTripProgress(lat, lon)` on each `watchPosition` callback at `app.js:295`. We can extend this to also check next-leg arrivals.

**Where to modify**:
- `app.js` — in `updateTripProgress` function (around line 669), after progress calculation, add a lightweight check:
  1. If `tripLegIndex < legs.length - 1` (there's a next leg)
  2. Get the next leg's `departurePoint` (from the leg's `from` field)
  3. Debounce: only check every 30 seconds (use `_lastConnectionCheck` timestamp)
  4. Fetch arrivals at that stop via `Stops.getArrivals(nextLeg.from.stopId)` — cheap, cached
  5. Find arrivals matching the next leg's line + direction
  6. Compare next leg's scheduled departure time to actual next arrival
  7. If delay > 2 minutes OR no matching arrival (cancelled), show a reroute notification

**UI design** (mobile-first):

Inline notification in the trip nav bar:

```
┌─────────────────────────────────────┐
│  ⏹ End Trip  📍 37%  00:12 ETA     │
│─────────────────────────────────────│
│ ⚠️ Next connection (District) at      │
│    West Ham is delayed by 5 min      │
│    [Reroute? →]                      │
└─────────────────────────────────────┘
```

- Not a jarring popup or modal — just an inline warning strip inside the trip nav
- `background: rgba(234,179,8,.15); border-radius: 6px; padding: 6px 10px; font-size: 11px; margin-top: 4px;`
- If cancelled (no matching arrival found): red background, "Connection may be missed"
- [Reroute? →] link calls `triggerReroute` — already exists at `app.js:853`

**Existing code integration**:
- `triggerReroute` at `app.js:853` already handles re-planning
- `_lastConnectionCheck` timestamp avoids hammering the API
- The arrivals data is cached by `Stops.getArrivals` via `Api.getStopArrivals` which uses the `rateLimited` wrapper — safe

**Edge cases**:
- Next leg is walking → skip check
- `nextLeg.from` has no `stopId` → skip
- Arrivals API fails → skip silently (no alert)
- User is near the end of the leg already (within 30s of arrival) → no point alerting

---

## Feature F: "My Lines" Dashboard (7)

**What**: Home screen panel showing saved lines' current status, with color-coded badges. Users add lines from the timetable view or status page. Persisted in localStorage.

**Data source**: `Status.fetchAll()` at `status.js:29` returns per-line status with `id`, `statusCls` (`good/minor/severe/closed`), `statusText`, `color`. This is already fetched every 120 seconds via `setInterval` at `app.js:1688`.

**Where to modify**:
- `storage.js` — add `getSavedLines()` / `toggleSavedLine(lineId)` similar to existing `getFavorites()`/`toggleFavorite()`
- `ui-sidebar.js` — add "My Lines" section above the main tab bar
- `status.js` — the status data already flows through `UI.loadStatus()`. We just need to filter for saved lines.
- `ui-timetable.js` — add a "☆ Save line" button in the timetable header

**UI design** (mobile-first):

```
┌─────────────────────────────────────┐
│  My Lines                            │
│                                      │
│  [●] District    │ Good Service │ 🗑  │
│  [●] Central     │ Minor Delays │ 🗑  │
│  [●] c2c         │ Good Service │ 🗑  │
│       (arrivals only — no timetable) │
│                                      │
│  ─────────────────────────────────── │
│  [⭐ Add current line]               │
└─────────────────────────────────────┘
```

- Color dot: `width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; background: ${line.color};`
- Status text colored by severity: green=good, yellow=minor, red=severe/closed
- Tap a line → navigates to status page, expanded to that line's mode accordion
- Swipe-to-delete or tap 🗑 → removes line from saved list
- "[⭐ Add current line]" appears inside timetable view header when viewing a line that isn't saved
- Lines that are National Rail operators (not TfL-managed) show a subtle "(arrivals only)" note

**Storage format** (`localStorage` key: `lt_savedLines`):
```json
[
  { "id": "district", "name": "District", "mode": "tube", "savedAt": 1718000000000 },
  { "id": "c2c", "name": "c2c", "mode": "national-rail", "savedAt": 1718000000000 }
]
```

**Rendering frequency**: On `UI.loadStatus()` call (every 120s). Also re-render when a line is added/removed.

**Edge cases**:
- `Status.fetchAll()` returns empty array (network error) → show "Checking..." or last-known status
- 120s refresh is sufficient but user might want manual refresh → pull-to-refresh gesture (low priority for MVP)
- Line is removed from TfL data (renamed) → stale entry shows "Unknown" → user can remove manually

---

## Feature G: Best Exit / Carriage Position (10)

**What**: Show `vehicleId` or platform-end information next to departures to indicate which carriage is at which position.

**Data**: TfL arrivals API may return `vehicleId` which encodes the train's formation. Some platforms have "Front" / "Rear" indicators in `platformName`. **However**, the TfL API doesn't reliably return carriage-level data for all modes. For tube lines, the data is sparse. For National Rail, it's not available through this API.

**Reality check**: This feature has unreliable data. Instead of pushing low-quality info, **skip this for now**. Note it as "future: TfL crowding data needed".

**Alternative**: Show `vehicleId` as a tiny reference number only when non-empty, without making claims about carriage position:

```
[3]  Embankment    2 min  #9208
```

- `#9208` = last 4 chars of `vehicleId`, shown in `color: rgba(255,255,255,.35); font-size: 9px; font-family: monospace;`
- Only shown when `a.vehicleId` is non-empty AND `a.vehicleId !== '0'`
- No interpretation — just a reference for enthusiasts / spot-check

**Where to modify**: `ui-departures.js` departure row builder, same location as Feature A.

---

## Feature H: Connection Window Warnings (11)

**What**: In journey planner results, highlight connections that are too tight (< 5 min) or very long (> 15 min wait).

**Data source**: Already in `ui-journey.js` journey card rendering — each leg has `departureTime` and `arrivalTime`. The gap between one leg's arrival and the next leg's departure is the connection time.

**Where to modify**: `ui-journey.js` — in the function that builds journey card HTML (around lines 170-200, where leg items are rendered inside a card)

**UI design** (mobile-first):

Current:
```
╔══════════════════════════════════╗
║ Fastest · 38 min · £3.20        ║
╠══════════════════════════════════╣
║ 🚶  3 min walk            07:45 ║
║ 🚇  District                    ║
║     → Upminster            07:48 ║
║ 🚶  6 min walk            08:18 ║
╚══════════════════════════════════╝
```

With connection warnings:
```
╔══════════════════════════════════╗
║ Fastest · 38 min · £3.20        ║
╠══════════════════════════════════╣
║ 🚶  3 min walk            07:45 ║
║ 🚇  District                    ║
║     → Upminster            07:48 ║
║ ⚡ Only 2 min to change!         ║
║ 🚶  6 min walk            08:18 ║
╚══════════════════════════════════╝
```

- Tight connection (< 5 min): yellow background strip between legs, ⚡ icon, "Only X min to change!" in `font-size: 10px; color: #eab308;`
- Very tight (< 2 min): red, "Very tight connection — you may miss this"
- Long wait (> 15 min): "20 min wait" in muted text (no warning color)
- Normal (5-15 min): no indicator

**How to calculate**: Walk leg arrival time → next transit leg departure time (both already computed in `router.js:parseJourneys`)

**Where to add**: In `ui-journey.js`, in the leg HTML builder:
1. After rendering each leg, check if next leg exists
2. Calculate `nextLeg.departureTime - currentLeg.arrivalTime` (in minutes)
3. If gap > 0 and next leg is transit (not walking), this is a connection
4. Render the inline warning strip

**Edge cases**:
- First leg or last leg → no connection warning
- Walking leg followed by another walking leg → skip
- `departureTime`/`arrivalTime` could be null/undefined → skip calculation
- Negative connection (overlap) → already handled by journey planner, shouldn't happen
- Connection at a different station than where current leg ends → this is unusual in TfL data but possible → add "Change at [station name]" to the warning

---

## Implementation Order

1. **Features A+B (Platform + Accessibility)** — pure rendering additions, no new API calls, immediate trust impact
2. **Feature F (My Lines)** — new storage + sidebar section, uses existing status data
3. **Feature H (Connection Warnings)** — rendering change in journey cards
4. **Feature C (Planned Works)** — uses existing disruption fetch, new timetable display logic
5. **Feature E (Connection Alerts)** — extends existing trip tracking, most complex
6. **Feature D (Line Route Map)** — most visually impressive, touches 3 files
7. **Feature G (Vehicle ID)** — trivial, lowest priority

## CSS Design Principles (Mobile-First)

All additions must follow these rules:
- No new modals, no new panels, no full-screen overlays (except Feature D's map focus)
- All new UI elements are inline strips, badges, or row-level annotations
- Use existing color system: `var(--accent)`, `var(--surface2)`, `rgba(...)` for overlays
- Font hierarchy: titles 13px, body 12px, badges 10px, micro 9px
- Touch targets: minimum 44px height for buttons, 32px for inline actions
- Safe-area: `padding-top: env(safe-area-inset-top)` on any fixed elements
- No `position: sticky` on new elements (existing sticky conflicts documented)
- Loading states: existing spinner pattern, 50ms scroll-reset pattern
