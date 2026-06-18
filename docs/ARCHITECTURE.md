# London Transport App — Architecture

## Project Structure

```
london-transport-app/
├── index.html          ← The app page (loads everything)
├── sw.js               ← Service worker (offline support)
├── manifest.json       ← PWA install manifest
├── css/
│   └── style.css       ← All styles
├── js/
│   ├── config.js       ← Settings (API keys, map config)
│   ├── api.js          ← Talks to TfL API (journeys, arrivals, etc.)
│   ├── router.js       ← Parses journey data, plans routes
│   ├── stops.js        ← Stop/arrival data processing
│   ├── map.js          ← MapView — handles Leaflet + MapLibre (3D)
│   ├── geocoder.js     ← Search: postcodes, stations, places
│   ├── storage.js      ← localStorage: favorites, recents, settings
│   ├── status.js       ← Line status/disruptions
│   ├── icons.js        ← SVG icon system
│   ├── app.js          ← The brain — wires everything together
│   ├── ui-sidebar.js   ← Sidebar UI (tabs, buttons, search box)
│   ├── ui-journey.js   ← Journey results display
│   ├── ui-departures.js← Live departures panel
│   ├── ui-timetable.js ← Full day timetable view
│   ├── ui-nearby.js    ← Nearby stops view + live tracking
│   ├── ui-bikes.js     ← Bike point panel
│   ├── ui-route.js     ← Route explorer
│   ├── ui-favorites.js ← Saved locations
│   └── ui-helpers.js   ← Toast/error messages
├── img/                ← Icons for PWA
├── data/               ← Static data files
└── docs/               ← You are here
```

## How Data Flows (Simple Version)

```
You type From/To → app.js asks Router → Router asks Api → TfL API
                                                      ↓
You see results ← app.js sends to UI ← Router parses response
                                                      ↓
You tap "Start" → app.js starts GPS → shows dot on map via MapView
                                                      ↓
Every GPS tick → update progress (legs, ETA, arrival)
                                                      ↓
You drag map → follow stops → RECENTER button appears
                                                      ↓
You tap RECENTER → follow resumes, map rotates to heading
```

## What Each File Does (One Line)

| File | Job |
|---|---|
| `config.js` | Holds API URLs, map center, tile sources |
| `api.js` | Fetches data from TfL API (journeys, arrivals, lines, bikes) |
| `router.js` | Plans journeys, parses routes, extracts stops/paths |
| `stops.js` | Gets nearby stops, arrivals, accessibility info |
| `map.js` | Runs the map (2D Leaflet + 3D MapLibre), markers, routes |
| `geocoder.js` | Searches stations, postcodes, places by name |
| `storage.js` | Saves favorites, recents, settings, trip state |
| `status.js` | Checks line status and disruptions |
| `icons.js` | Draws the SVG icons used everywhere |
| `app.js` | **The brain** — listens to all events, coordinates everything |
| `ui-sidebar.js` | The sidebar (tabs, search box, buttons) |
| `ui-journey.js` | Journey results cards |
| `ui-departures.js` | Live departure boards |
| `ui-timetable.js` | Full day timetable |
| `ui-nearby.js` | Nearby stops + LIVE tracking button |
| `ui-bikes.js` | Bike sharing panel |
| `ui-route.js` | Route explorer (by line number) |
| `ui-favorites.js` | Saved locations |
| `ui-helpers.js` | Toast notifications, error messages |

## App Flow Diagram

```
                    ┌──────────────┐
                    │  index.html  │
                    │  (loads all) │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ config   │ │ api      │ │ icons    │
        │ map      │ │ router   │ │ storage  │
        │ geocoder │ │ stops    │ │ status   │
        │ map.js   │ │          │ │          │
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
              └────────────┼────────────┘
                           ▼
                    ┌──────────────┐
                    │   app.js     │
                    │ (orchestrator│
                    │  brain)      │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ UI files │ │ MapView  │ │ Service  │
        │ (10 .js) │ │ (map.js) │ │ Worker   │
        └──────────┘ └──────────┘ └──────────┘
```

## Key Concepts

**Two maps in one:** Leaflet (2D, default) + MapLibre (3D, toggle). `map.js` keeps both in sync — when you add a marker, it appears on both.

**GPS tracking:** During navigation, `app.js` watches your location. Each GPS update:
1. Moves the blue dot (with heading arrow if available)
2. Shows accuracy circle
3. Pans the map to follow you
4. Rotates the map so you face "up"
5. Checks if you reached a stop (advance leg)
6. Checks if you arrived at destination
7. Checks if you went off-route (deviation)

**Events:** Files don't call each other directly. Instead, they dispatch events (`'plan-journey'`, `'start-trip'`, etc.) that `app.js` listens for. This keeps everything decoupled.

**Offline:** `sw.js` caches all app files at install. Map tiles are cached on first load. TfL API calls fall back to cache when offline.
