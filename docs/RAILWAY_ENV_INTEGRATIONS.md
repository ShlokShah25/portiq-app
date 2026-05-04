# Railway environment variables — Zoom, Microsoft Teams / Graph

Set these on your **Railway service** that runs `node server/index.js` (Variables tab). Redeploy after saving.

## URLs you must register in vendor consoles

| Vendor | Redirect URI (exact match) | Where to add |
|--------|----------------------------|--------------|
| Zoom | `https://<YOUR_PUBLIC_API_HOST>/api/integrations/oauth/zoom/callback` | Zoom Marketplace → your OAuth app → Redirect URL |
| Microsoft | `https://<YOUR_PUBLIC_API_HOST>/api/integrations/oauth/teams/callback` | Azure Portal → App registration → Authentication → Web redirect URIs |

Use your real public host (Railway default `*.up.railway.app` or a custom domain). **No trailing slash** on the callback paths unless you configure the same in Zoom/Azure.

## Where users return after OAuth

After Zoom/Microsoft redirect back, the server sends users to:

`APP_PUBLIC_URL/dashboard?zoom=connected` or `...?teams=connected`

Set **`APP_PUBLIC_URL`** or **`APP_BASE_URL`** to the origin where your **React app** is served (same host as the dashboard), for example:

- `https://your-app.up.railway.app`
- `https://meetingassistant.portiqtechnologies.com`

No trailing slash.

---

## Required variables (summary)

### Core (already in use)

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Signs OAuth `state` and admin sessions — **must match** across deploys |
| `MONGODB_URI` | Database |

### ffmpeg (long lectures & large recordings)

Long class recordings (**roughly over ~10 minutes**) and automatic compression for Whisper use **system `ffmpeg` and `ffprobe`** on the API server. This repo’s **`nixpacks.toml`** adds `ffmpeg` for Railway/Nixpacks builds.

- After deploy, **`GET /api/health/ready`** includes `"ffmpeg": "available"` or `"missing"`.
- If **`ffmpeg` is missing**, install ffmpeg on the host or set **`FFMPEG_PATH`** / **`FFPROBE_PATH`** to the full paths of those binaries (override when they are not on `PATH`).

### Persisting lecture/meeting audio across redeploys

Default uploads live under **`uploads/meetings/`** on the container filesystem — **that disk is wiped when the platform redeploys or restarts** unless you use durable storage.

**Do this:** attach a **persistent volume** on Railway (or equivalent), mount it at e.g. **`/data/portiq-audio`**, then set **either**:

| Variable | Purpose |
|----------|---------|
| `MEETING_AUDIO_MIRROR_DIR` | Absolute path to the volume (recommended). Each recording file is **copied here** (same filename as in `uploads/meetings/`). |
| `PORTIQ_PERSISTENT_AUDIO_DIR` | **Alias** for the same path if you prefer this name. |

When the primary upload path is gone after a redeploy, **`resolveUploadPath`** finds the file again **by basename** under this directory so **Regenerate summary** still works.

Check **`GET /api/health/ready`** → **`meetingAudioMirrorDir`: `"configured"`** once set.

### Zoom — webhooks + OAuth

| Variable | Example / notes |
|----------|-----------------|
| `ZOOM_CLIENT_ID` | From Zoom Marketplace OAuth app |
| `ZOOM_CLIENT_SECRET` | From Zoom Marketplace (keep secret) |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | Zoom app “Secret Token” for `POST /api/integrations/webhooks/zoom` |
| `ZOOM_OAUTH_REDIRECT_URI` | Full callback URL (must match Zoom app exactly) |
| `ZOOM_OAUTH_SCOPES` | Optional. **Must match** scopes toggled under Zoom app → **Scopes**. Default (if unset): `user:read:user` only — avoids “Invalid scope” when `user:read:email` is not enabled. Use spaces or commas between scopes. |
| `ALLOW_MANUAL_MEETING_PLATFORMS` | Set to `true` to show “Mark connected” demo buttons in the Connect modal (hidden by default). |

### Zoom — conference bot worker (optional until worker is deployed)

See **`docs/ZOOM_PLATFORM.md`** for payloads and Zoom event names.

| Variable | Example / notes |
|----------|-----------------|
| `CONFERENCE_BOT_WEBHOOK_URL` or `ZOOM_BOT_WORKER_URL` | Worker `POST` target; receives `conference.join` JSON jobs |
| `CONFERENCE_BOT_WEBHOOK_SECRET` | Optional HMAC key; API sends `X-PortIQ-Signature` (SHA-256 hex of body) |
| `CONFERENCE_BOT_QUEUE_ON_CREATE` | Set to `0` to stop enqueue on meeting create (webhook-only) |
| `PORTIQ_WORKER_SECRET` | Worker calls `POST /api/integrations/bot/report` and `POST .../worker/zoom/join-context` with header `X-PortIQ-Worker-Secret` |
| `PORTIQ_API_BASE_URL` | Public API origin (no trailing slash); embeds `reportUrl` + `joinContextUrl` in each bot job. Aliases: `API_PUBLIC_URL`, `PUBLIC_URL`, `BASE_URL` |

### Microsoft — Graph delegated OAuth (Teams path)

| Variable | Example / notes |
|----------|-----------------|
| `TEAMS_GRAPH_CLIENT_ID` | Azure app (Application / client ID) |
| `TEAMS_GRAPH_CLIENT_SECRET` | Client secret from Azure Certificates & secrets |
| `TEAMS_OAUTH_REDIRECT_URI` | Full callback URL (must match Azure Web redirect URI) |
| `TEAMS_APP_TENANT_ID` | Single-tenant: your directory ID. Multi-tenant: use `common` (or omit; server defaults to `common`) |
| `TEAMS_GRAPH_SCOPES` | Optional. Default: `offline_access openid profile https://graph.microsoft.com/User.Read` |

Aliases accepted: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (same values as above).

### App URL for redirects

| Variable | Purpose |
|----------|---------|
| `APP_PUBLIC_URL` | Origin of the SPA for post-OAuth redirect (`/dashboard?...`) |

Aliases: `APP_BASE_URL`, `CLIENT_URL`, `PUBLIC_APP_URL`.

---

## Railway checklist

1. **Service → Variables** — add all keys above (Railway encrypts values).
2. **Networking** — ensure the service has a **public domain** so Zoom/Microsoft can call **HTTPS** callbacks.
3. **Same JWT_SECRET** — if you run multiple services, they must share `JWT_SECRET` if tokens are validated everywhere.
4. **CORS** — if the SPA is on another origin, add it to `CORS_EXTRA_ORIGINS` in Railway (comma-separated), e.g. `https://your-frontend.com`.

## API routes (reference)

- `GET /api/integrations/oauth/zoom/start` — Bearer auth; returns `{ url }` for browser redirect.
- `GET /api/integrations/oauth/zoom/callback` — Zoom redirects here (no Bearer).
- `GET /api/integrations/oauth/teams/start` — Bearer auth; returns `{ url }`.
- `GET /api/integrations/oauth/teams/callback` — Microsoft redirects here.
- `GET /api/integrations/status` — which server env flags are set (no secrets). Includes `allowManualMeetingPlatforms` when `ALLOW_MANUAL_MEETING_PLATFORMS=true`.
- `POST /api/integrations/webhooks/zoom` — Zoom event subscriptions (raw JSON + signature).
- `POST /api/integrations/bot/report` — worker status updates (`X-PortIQ-Worker-Secret`).
- `POST /api/integrations/worker/zoom/join-context` — worker fetches ZAK + join URLs for a meeting (`X-PortIQ-Worker-Secret`). See `docs/ZOOM_PLATFORM.md`.

Tokens are stored on the **Admin** document (`zoomOAuth`, `teamsOAuth`); they are **never** returned from `GET /admin/profile`.
