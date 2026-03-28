# Zoom platform (PortIQ) — API, webhooks, bot worker

This doc ties together everything Zoom-related in this repo: **OAuth**, **webhooks**, **meeting IDs**, **job dispatch** to a **Meeting SDK worker**, and **worker callbacks**.

## What runs where

| Piece | Where it runs | Role |
|--------|----------------|------|
| OAuth start/callback | This Node API | User connects Zoom; tokens on `Admin` |
| `POST /api/integrations/webhooks/zoom` | This Node API | Zoom validates URL + sends `meeting.*` events |
| `enqueueJoinMeeting` | This Node API | `POST` JSON job to your worker URL (optional) |
| Join meeting + capture audio | **Separate Linux service** | [Zoom Meeting SDK for Linux](https://developers.zoom.us/docs/meeting-sdk/linux/) (not in this repo) |

Native Zoom media **cannot** reliably run inside a short-lived Railway web process. The worker is a separate container/service.

---

## Environment variables (API / Railway)

### OAuth (already used)

- `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_OAUTH_REDIRECT_URI`
- `APP_BASE_URL` or `APP_PUBLIC_URL` — post-OAuth redirect to the SPA

### Webhooks

- `ZOOM_WEBHOOK_SECRET_TOKEN` — Zoom app “Secret Token”; must match Marketplace.

Subscribe in Zoom Marketplace (feature: **Event subscriptions**) to at least:

- `meeting.started`
- `meeting.ended`
- (optional) `recording.completed`

Event notification URL:

`https://<your-api-host>/api/integrations/webhooks/zoom`

### Bot job dispatch (optional)

When set, creating a **Zoom** online meeting enqueues a job (and `meeting.started` can enqueue again if the meeting was still `queued` / `failed`):

- `CONFERENCE_BOT_WEBHOOK_URL` or `ZOOM_BOT_WORKER_URL` — worker listens for `POST` with JSON body.
- `CONFERENCE_BOT_WEBHOOK_SECRET` — if set, body is signed: HMAC-SHA256 hex in header `X-PortIQ-Signature`.
- `PORTIQ_API_BASE_URL` (recommended) — public origin of **this API** (no trailing slash). When set, each job includes `reportUrl` and `joinContextUrl` so the worker can omit `PORTIQ_API_URL`. Fallbacks: `API_PUBLIC_URL`, `PUBLIC_URL`, `BASE_URL`.

Disable enqueue on create (webhook-only trigger):

- `CONFERENCE_BOT_QUEUE_ON_CREATE=0`

### Worker → API status updates

- `PORTIQ_WORKER_SECRET` — shared secret; worker sends header `X-PortIQ-Worker-Secret` on:

`POST https://<api>/api/integrations/bot/report`

### Worker → API Zoom join context (ZAK)

Authenticated the same way (`X-PortIQ-Worker-Secret`):

`POST https://<api>/api/integrations/worker/zoom/join-context`

Body: `{ "meetingId": "<Mongo _id>" }`  
Response: `{ meetingId, joinUrl, externalMeetingId, zak | null, zakError? }`

The API uses the meeting owner’s Zoom OAuth to call Zoom REST `GET /users/me/token?type=zak`. Your Zoom app must include a **ZAK** scope (Zoom Marketplace → Scopes), e.g. `user_zak:read`, and `ZOOM_OAUTH_SCOPES` on the server must list it so new OAuth grants include it. Re-connect Zoom after changing scopes.

### Token refresh (server-side Zoom REST)

`server/utils/zoomOAuthTokens.js` — `getZoomAccessTokenForAdmin(adminId)` refreshes with `zoomOAuth.refreshToken` when the access token is near expiry. Use this when you add Zoom REST calls (e.g. recordings).

---

## Job payload (`conference.join`)

Posted to `CONFERENCE_BOT_WEBHOOK_URL` when configured:

```json
{
  "v": 1,
  "type": "conference.join",
  "meetingId": "<Mongo _id>",
  "adminId": "<admin _id or null>",
  "provider": "zoom",
  "joinUrl": "https://zoom.us/j/…",
  "externalMeetingId": "91234567890",
  "scheduledTime": "2026-03-28T18:00:00.000Z",
  "trigger": "api.meeting.create | webhook.meeting.started",
  "reportUrl": "https://<api>/api/integrations/bot/report",
  "joinContextUrl": "https://<api>/api/integrations/worker/zoom/join-context",
  "enqueuedAt": "2026-03-28T…"
}
```

`reportUrl` and `joinContextUrl` are present when `PORTIQ_API_BASE_URL` (or a fallback public API origin) is configured.

Your worker should:

1. Join using Meeting SDK + join URL (and org policy: ZAK / OBF / RTMS per Zoom’s current rules). Call `joinContextUrl` with `meetingId` to obtain `zak` when your SDK path needs it.
2. Capture audio to a file → reuse existing transcription pipeline (upload or internal path).
3. Report status back via `POST /api/integrations/bot/report`.

---

## Worker callback body (`/api/integrations/bot/report`)

Header: `X-PortIQ-Worker-Secret: <PORTIQ_WORKER_SECRET>`

```json
{
  "meetingId": "<Mongo _id>",
  "conferenceBotStatus": "joining | in_meeting | ended | failed | queued",
  "status": "In Progress | Completed",
  "transcriptionStatus": "Recording | Processing | …",
  "audioFile": "/uploads/meetings/…",
  "error": "optional message for logs"
}
```

---

## Meeting record fields

- `conferenceJoinUrl` — pasted Zoom link  
- `conferenceProvider` — `zoom`  
- `externalMeetingId` — numeric id parsed from `/j/###########` when possible  
- `conferenceBotStatus` — `queued` → worker updates `joining` / `in_meeting` / `ended` / `failed`

---

## Public status (no secrets)

`GET /api/integrations/status` includes booleans such as `conferenceBotWorkerUrl`, `workerCallbackSecret`, `portiqApiPublicUrl`, `zoomWebhook`, etc.

---

## Reference worker in this repo

`worker/zoom-bot/` — Node HTTP service: `POST /` receives jobs, optional HMAC check, mock lifecycle or `ZOOM_BOT_MOCK=0` stub that hits `join-context`. See `worker/README.md`.

---

## Next build step (you / infra)

Create a **small Linux Dockerfile** repo (or `worker/zoom-meeting-sdk/`) that:

- Links Zoom Meeting SDK for Linux samples.
- HTTP server receives the job above, joins, writes WAV, then either POSTs audio to your existing meeting end endpoint or drops a file and calls `bot/report` with `audioFile`.

Teams can follow the same job shape with `provider: "teams"` later.
