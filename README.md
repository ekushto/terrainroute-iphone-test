# TerrainRoute iPhone feasibility test

A temporary test page: can an offline home-screen web app hold a map area, route on the phone, read GPS without signal and hand a GPX to onX? It will be deleted after testing.

- **Area:** the public Marvine Creek test area (Flat Tops, Colorado). No personal locations.
- **Elevation:** USGS 3DEP 10 m (public domain).
- **Map tiles:** USGS The National Map, USGSTopo (public domain).
- **Map library:** MapLibre GL JS 4.7.1 (BSD-3-Clause; see `maplibre/LICENSE.txt`).
- **Routing:** an off-trail least-cost solver ported from TerrainRoute (`solver.js`). Routes are computed, not verified passable.
