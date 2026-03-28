# Zoom & Microsoft Teams meeting bots (architecture + what we need from you)

PortIQ today captures audio **in the browser** or via **upload**. Joining a **Zoom or Teams call as a participant bot** is a **separate media pipeline**: it needs OAuth, vendor approvals, and usually a **headless worker** (container) running the vendor SDK—not only this Node API.

**Google Meet** (your plan): handle via a **Chrome extension** that captures tab/audio and posts to PortIQ—document that separately when you build the extension.

---

## What is already in this repo

- **Meeting fields**: `conferenceProvider`, `conferenceJoinUrl`, `externalMeetingId`, `conferenceBotStatus` (set later by a worker).
- **Plans**: `allowsConferenceBots: true` on **starter, professional, and business** (surfaced on `GET /admin/profile` as `allowsConferenceBots`).
- **Webhooks** (API only):
  - `POST /api/integrations/webhooks/zoom` — Zoom URL validation + signed events (set `ZOOM_WEBHOOK_SECRET_TOKEN`).
  - `GET|POST /api/integrations/webhooks/teams-graph` — Graph `validationToken` echo + notification stub.
- **Status**: `GET /api/integrations/status` — which env vars are present (no secrets returned).
- **Stub**: `server/utils/conferenceBotQueue.js` — replace with Redis/SQS + worker when ready.

---

## Recommended architecture (smart path)

1. **This API** — OAuth callbacks (next), store refresh tokens per tenant; webhooks receive “meeting started / ended / recording completed”; enqueue jobs.
2. **Bot worker service** (new repo or `worker/` in monorepo) — long-running Linux container:
   - **Zoom**: [Meeting SDK for Linux](https://developers.zoom.us/docs/meeting-sdk/linux/) or vendor partner pattern; join with server-managed “bot” user; capture audio → file → same transcription pipeline you already have.
   - **Teams**: [Azure Bot + Graph communications](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/calls-meetings-bots) (application-hosted media) — significantly more Azure plumbing than Zoom for many teams.
3. **Queue** — Redis, SQS, or Railway/Render background worker trigger.

Trying to run Zoom/Teams native media **inside** the same short-lived web dyno is not reliable; split the worker.

---

## What we need from you (checklist)

### Zoom

1. **Zoom Marketplace** — Create an app (OAuth or Server-to-Server, depending on whether the bot acts as a user or account-level).
2. **Redirect URI(s)** — e.g. `https://<your-api>/api/integrations/oauth/zoom/callback` (we can add this route next).
3. **Webhook** — Event subscription endpoint: `https://<your-api>/api/integrations/webhooks/zoom`
4. **Secrets for Railway/hosting**:
   - `ZOOM_CLIENT_ID`
   - `ZOOM_CLIENT_SECRET`
   - `ZOOM_WEBHOOK_SECRET_TOKEN` (Zoom “Secret Token” for signatures)
5. **Decision**: Will the bot join **every** scheduled meeting, or only when the user toggles “Record with PortIQ bot” on a meeting?
6. **Compliance** — Notify participants / terms of service for recording (your legal review).

### Microsoft Teams

1. **Azure AD app registration** — Multi-tenant or single-tenant; **admin consent** often required in enterprises.
2. **Bot Framework** registration linked to the Azure app.
3. **Graph API permissions** (examples; exact set depends on design): `OnlineMeetings.ReadWrite`, call/media permissions for application-hosted bots—**requires Microsoft review** for production.
4. **Public HTTPS URL** for `POST /api/integrations/webhooks/teams-graph` (and later OAuth callback).
5. **Secrets**:
   - `TEAMS_GRAPH_CLIENT_ID`
   - `TEAMS_GRAPH_CLIENT_SECRET`
   - `TEAMS_APP_TENANT_ID` (if single-tenant)
   - Bot Microsoft App ID / password as needed for Bot Framework
6. Same **product/legal** decisions as Zoom.

### Infrastructure

- **Stable public URL** for production webhooks (Railway custom domain is fine).
- **Dev**: ngrok (or similar) tunnel to local `:5001` for Zoom/Teams to reach webhooks during development.

---

## Suggested order of execution

1. You complete **Zoom Marketplace app + webhook secret** → we wire OAuth callback + persist tokens + map `externalMeetingId` from webhooks to `Meeting`.
2. Stand up **one bot worker** proof-of-concept for Zoom join + single audio file into existing transcription.
3. Then **Teams** (longer Azure path) or **Chrome extension for Meet** in parallel if Meet is higher priority for your ICP.

---

## Environment variables (reference)

```bash
# Zoom
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=

# Teams / Graph (bot + subscriptions)
TEAMS_GRAPH_CLIENT_ID=
TEAMS_GRAPH_CLIENT_SECRET=
TEAMS_APP_TENANT_ID=
```

When you have Zoom app credentials and a production webhook URL, share them securely (password manager / Railway secrets)—not in chat.
