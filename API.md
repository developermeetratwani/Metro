# API contract (server :3001, Vite proxies /api)

All errors: HTTP 4xx/5xx with `{ "error": "message" }`. cities: `ahmedabad` | `gandhinagar`. Dates `YYYY-MM-DD`.

## Existing (already working)
- `GET /api/meta` -> `{ events:[{id,name,type,venue,date,startHour,endHour,attendance,stations[],city}], db:bool, llm:bool, keys:{holidays,events,weather,email}, recipients:[string] }`
- `GET /api/live-events?date&city` -> `[{...event, live:true}]`
- `POST /api/recommend` body `{date, city, eventIds[], weatherMode:"live"|"rain"|"clear", config?, fast?}` ->
  `{ date, city, weather:{precipSum,precipProb,tempMax,source}, holiday|null, events:[names], dayType, weatherSeverity, alert:"ok"|"watch"|"high",
     rows:[{band,time,base,headway,delta,action,stations[],justification,trains,reasons:[{signal,text,delta}]}],
     stations:[{station,surges:[{event,kind,window,level:"moderate|high|severe",crowd,note}]}],
     fleet:{ trainsPeak, trainsBase, extraTrains, crewPeak }, createdAt }`
- `POST /api/plan` body `{from, days(1-14), city}` -> `{ city, plan:[{date,holiday,weather,events:[{name,live}],dayType,alert,rows:[{band,base,headway,delta}],stations[]}] }`
- `GET /api/config` -> `{config, defaults}`; `PUT /api/config` body config -> `{ok:true}`
- `GET /api/history` -> `[{date,events[],createdAt,weather:{source}}]`

## New
- `GET /api/stations` -> `{ lines:[{id,name,color,stations:[stationId]}], stations:[{id,name,city,lines:[lineId],lat,lon,interchange:bool}] }`
- `GET /api/stations/weather?city` -> `{ updated:ISO, source:"weatherapi"|"open-meteo", stations:[{id,name,city,temp_c,feelslike_c,humidity,wind_kph,precip_mm,chance_of_rain,condition,uv}] }`
- `GET /api/journey?from=<stationId>&to=<stationId>&time=HH:MM` -> `{ from,to, stops, minutes, distanceKm, fare, peak:bool, legs:[{line,lineName,color,from,to,stops,stationIds[]}], interchanges:[stationName], note:"fare and times are assumed estimates" }`
- `POST /api/heatmap` body `{date, city, eventIds[], weatherMode}` -> `{ hours:[6..23], stations:[{id,name,values:[0-100 per hour]}], peak:{station,hour,value} }`
- `POST /api/ask` body `{question, advisory}` -> `{ answer }` (AI copilot grounded in the advisory)
- `POST /api/report/preview` body `{date, city, eventIds[], weatherMode}` -> `{ subject, html, text }` (AI-written full report)
- `POST /api/report/send` body `{date, city, eventIds[], weatherMode, to}` -> `{ ok:true, sentTo }` ; 403 if `to` is not an authorised recipient (see `meta.recipients`)

## Round 3 (new — backend agent implements, frontend agent consumes)
- `GET /api/auto?city` -> latest autopilot advisory (same shape as /api/recommend plus `auto:true`) or `null`. `POST /api/auto/run` -> `{date, cities}`. (already done)
- `POST /api/disruption` body `{date, city, closed:[stationId], fromHour, toHour}` -> `{ closed:[{id,name}], rows:[recommend rows], neighbours:[{id,name,extraLoad:0-100}], reroutes:[{from,to,minutes,legs, ok:true} | {from,to,ok:false,note:"no route — bus bridge needed"}], justification }` — reroute `from`/`to` are station names; optional `weatherMode` (default live). Note: the network has no loops, so any mid-line closure yields a bus bridge.
- `GET /api/drift?city` -> `{ planned:{date, weather, alert, createdAt} | null, now:{weather, alert}, changed:bool, bandsChanged:[{band, planned, now}] }`
- `POST /api/decisions` body `{date, city, band, recommended, final, operator, reason}` -> `{ok:true}` (400 if final outside min..max, or reason missing when final != recommended). `GET /api/decisions?date&city` -> `[{date,city,band,recommended,final,operator,reason,at}]` newest first
- `POST /api/brief` body `{date, city, eventIds?, weatherMode, lang:"en"|"gu"|"hi"}` -> `{ text (<=600 chars), lang, ai:bool }` — staff shift brief, copy/share only. When AI is unavailable the English template is returned with `lang:"en"`, `ai:false`.
- `/api/recommend`, `/api/plan` days and `/api/auto` additionally return `cost: { trainKm, energyKWh, costINR, co2Kg, vsBaseline:{ trainKm, costINR, co2Kg } }` (assumed constants, editable in config as `costs:{ kWhPerTrainKm, inrPerKWh, kgCO2PerKWh }`)

## Round 4 — operator login (backend done)
Auth header: `Authorization: Bearer <token>` (token from login, valid 12 h). Roles: `control` (control room) and `station` (one station).
- `POST /api/auth/login` body `{username, password}` -> `{ token, user:{username,name,role,station} }` ; 401 wrong credentials, 429 after 5 failed tries
- `GET /api/auth/me` -> `{username, role, station, name}` ; 401 if not logged in
- `GET /api/auth/accounts` -> `[{username,name,role,station}]` (demo accounts list, no passwords — for a "who can log in" hint)
- `GET /api/station-feed[?station=<id>]` (station role is locked to its own station; control may pass any) ->
  `{ station:{id,name,city,lines,interchange}, date, city, alert, createdAt, rows:[{band,time,base,headway,delta,action,justification,affectsThisStation}], surges:[...], decisions:[{band,recommended,final,operator,reason,at}], notices:[{station,text,from,at}], acks:[{by,at}] }`
- `POST /api/station-feed/ack` (station role) body `{date}` -> `{ok}` — "I have read tomorrow's plan"
- `POST /api/notices` (control role) body `{station, text}` -> `{ok}` — message from control room to a station
- `POST /api/decisions` now REQUIRES a control-role token; `operator` is taken from the login (body field ignored). 401/403 otherwise.

## Round 5 — master admin (backend done)
Role `admin` (login `admin`) can do everything `control` can, plus manage operators:
- `GET /api/admin/operators` -> `[{username,name,email,role,station,createdAt,createdBy}]`
- `POST /api/admin/operators` body `{username, name, password(8+), role:"station"|"control"|"admin", station?, email?}` -> `{ user, notified:{text, emailed?} }` — creates the operator, posts an in-app notice to that station and emails them (if email given; password is NOT emailed)
- `PATCH /api/admin/operators/:username` body any of `{name, email, role, station, password}` -> `{ user, notified|null }` — reassigning a station notifies again
- `DELETE /api/admin/operators/:username` -> `{ok}`
- station-feed rows now include `trainsPerHour` (frequency).

## Round 6 — hardening (backend done)
- Auth now required: `PUT /api/config` (control/admin), `POST /api/report/send` (control/admin), `POST /api/auto/run` (admin). 401/403 otherwise. Read endpoints stay public.
- `POST /api/ask`, `/api/brief`, `/api/report/*` are rate limited to 20/min per IP -> 429 `{error}` with `Retry-After`.
- All responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`. JSON bodies over 100 kb are rejected (413).
- Live (PredictHQ) events are kept only if within 3 km of a station of the requested city, and now carry `stations` = nearest 1-2 station names.
- `GET /api/health` -> `{ ok, db, uptime (s), version, autopilot:{ lastRun:{at,date,cities}|null, nextRun } }`
- `POST /api/incidents` (any logged-in role; station role is locked to its own station) body `{station?, type:"crowding"|"delay"|"closure"|"medical"|"other", note? (<=300)}` -> `{ ok, incident:{station,stationName,city,date,type,note,by,at} }` — also posts a notice to the control room (`station:"control", kind:"incident"`).
- `GET /api/incidents?date&city` (logged in) -> `[incident]` newest first. `GET /api/station-feed` now also returns `incidents` for that station.
- Not built yet: public forecast, notifications, plan.csv export, serving client/dist.
