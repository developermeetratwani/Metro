# Metro Ops — "No Day Is an Average Day"

Metro Hacks (DevFest Gandhinagar) · PS-04. Recommends how often trains should run tomorrow on the Ahmedabad and Gandhinagar metro, per time of day, with a plain-language reason for every change.

## Run
```bash
npm run install:all
cp server/.env.example server/.env   # fill in the keys below
npm run dev                          # API :3001, web :5174
```
Needs Node 20+. Every key is optional — without one the app falls back to sample data or template text.

| Key | Used for |
|---|---|
| `MONGODB_URI` | saved advisories, rules, decisions |
| `GROQ_API_KEY` | AI reasons, copilot, report, shift brief |
| `CALENDARIFIC_API_KEY` | live Gujarat holidays |
| `PREDICTHQ_TOKEN` | live events near the stations |
| `WEATHER_API_KEY` | live weather per station (weatherapi.com) |
| `SMTP_*`, `REPORT_RECIPIENTS` | emailing the AI report to authorised people |
| `AUTO_TIME` | daily autopilot time (IST), default 18:00 |

City-level forecast uses Open-Meteo (no key).

## Features
Advisory (rule engine + AI reasons, approve/override log, drift alert, cost & CO₂), multi-day planner, station crowd heatmap, station weather, journey & fare planner (54 stations, 4 lines), station-closure mode, what-if rules, AI email report, daily autopilot, English / ગુજરાતી / हिन्दी UI.

Baseline headways, fares, fleet and cost figures are stated assumptions, not official data. See `API.md` for endpoints.
