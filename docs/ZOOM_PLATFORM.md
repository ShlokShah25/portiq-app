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

Disable enqueue on create (webhook-only trigger):

- `CONFERENCE_BOT_QUEUE_ON_CREATE=0`

### Worker → API status updates

- `PORTIQ_WORKER_SECRET` — shared secret; worker sends header `X-PortIQ-Worker-Secret` on:

`POST https://<api>/api/integrations/bot/report`

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
  "enqueuedAt": "2026-03-28T…"
}
```

Your worker should:

1. Join using Meeting SDK + join URL (and org policy: ZAK / OBF / RTMS per Zoom’s current rules).
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

`GET /api/integrations/status` includes booleans such as `conferenceBotWorkerUrl`, `workerCallbackSecret`, `zoomWebhook`, etc.

---

## Next build step (you / infra)

Create a **small Linux Dockerfile** repo (or `worker/zoom-meeting-sdk/`) that:

- Links Zoom Meeting SDK for Linux samples.
- HTTP server receives the job above, joins, writes WAV, then either POSTs audio to your existing meeting end endpoint or drops a file and calls `bot/report` with `audioFile`.

Teams can follow the same job shape with `provider: "teams"` later.
