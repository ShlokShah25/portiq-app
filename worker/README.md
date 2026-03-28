# Conference bot worker (Zoom / Teams)

The Node API **does not** embed the Zoom Meeting SDK. This folder holds a **reference HTTP worker** plus room for a Linux Meeting SDK build.

## `zoom-bot/` (Node reference)

Run locally or as its own Railway/Render service:

```bash
cd worker/zoom-bot && npm install && npm start
```

### Railway: two services

| | **API service** (this repo’s `server`) | **Bot worker service** (`worker/zoom-bot`) |
|---|----------------------------------------|--------------------------------------------|
| **What it does** | Creates meetings, sends jobs to the bot, receives status | Listens for jobs, talks back to the API |
| `PORTIQ_WORKER_SECRET` | Same random string you invent | **Same value** |
| `CONFERENCE_BOT_WEBHOOK_SECRET` | Optional; if set, signs jobs | **Same value** if the API sets it |
| `CONFERENCE_BOT_WEBHOOK_URL` | Set to the worker’s public URL, e.g. `https://your-worker.up.railway.app/` | — |
| `PORTIQ_API_BASE_URL` or `APP_BASE_URL` | Your API’s public `https://…` (no trailing slash) so jobs include `reportUrl` | — |
| `PORTIQ_API_URL` | — | Backup: same API `https://…` if URLs are missing on jobs |
| `ZOOM_BOT_MOCK` | — | `1` or unset = fake join for testing; **`0`** = real path (needs capture command below) |
| `ZOOM_BOT_CAPTURE_COMMAND` | — | Path to **your** Linux Zoom capture binary/script (see below) |

On Railway for the worker: set **Root Directory** to `worker/zoom-bot`, **Start Command** `npm start` (or `node server.js`). Give the worker a **public domain** and paste that URL into `CONFERENCE_BOT_WEBHOOK_URL` on the API (usually ending with `/` is fine).

Set on the **worker**:

- `CONFERENCE_BOT_WEBHOOK_SECRET` — must match the API if the API signs jobs.
- `PORTIQ_WORKER_SECRET` — must match the API’s `PORTIQ_WORKER_SECRET` (for `bot/report` and `join-context`).
- `PORTIQ_API_URL` — API origin if the job payload omits `reportUrl` / `joinContextUrl` (set **`PORTIQ_API_BASE_URL`** on the API so URLs are embedded in every job).

Behavior:

- **Mock** — `ZOOM_BOT_MOCK` unset or not `0`: fake `joining` → `in_meeting` → `ended`.
- **Real** — `ZOOM_BOT_MOCK=0` and **`ZOOM_BOT_CAPTURE_COMMAND`** set to an executable on the worker machine. That program gets env vars `PORTIQ_MEETING_ID`, `PORTIQ_JOIN_URL`, `PORTIQ_ZAK`, `PORTIQ_EXTERNAL_MEETING_ID`, `PORTIQ_REPORT_URL`, `PORTIQ_WORKER_SECRET`. It should join via Zoom Meeting SDK for Linux, save audio, then either call `PORTIQ_REPORT_URL` itself or exit `0` and print a final JSON line like `{"audioFile":"/uploads/meetings/…","conferenceBotStatus":"ended"}`. Optional `ZOOM_BOT_CAPTURE_ARGS`: JSON array of extra argv strings.

Without `ZOOM_BOT_CAPTURE_COMMAND`, real mode reports **failed** (Node cannot join Zoom alone).

`GET /health` returns `{ ok, mock }`.

## Production Zoom audio capture

Use [Zoom Meeting SDK for Linux](https://developers.zoom.us/docs/meeting-sdk/linux/) (or a thin wrapper) to join using `joinUrl` and optional ZAK from `POST /api/integrations/worker/zoom/join-context`, write audio, then call `bot/report` with `audioFile` / transcription fields. See **`docs/ZOOM_PLATFORM.md`** for payloads.

**Suggested layout (C++ SDK):**

- `zoom-meeting-sdk/` — Linux sample + HTTP shim.
- `Dockerfile` — base image per Zoom’s documented dependencies.
