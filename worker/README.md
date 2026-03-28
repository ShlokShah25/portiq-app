# Conference bot worker (Zoom / Teams)

The Node API **does not** embed the Zoom Meeting SDK. This folder is the home for a **separate** Linux-based worker (Docker) that:

1. Exposes an HTTP `POST` endpoint (or polls a queue).
2. Receives PortIQ `conference.join` jobs — see **`docs/ZOOM_PLATFORM.md`**.
3. Uses [Zoom Meeting SDK for Linux](https://developers.zoom.us/docs/meeting-sdk/linux/) to join `joinUrl`, capture audio, then either upload audio to the API or set `audioFile` and call `POST /api/integrations/bot/report`.

**Suggested layout (future PR):**

- `zoom/` — C++ or wrapper around Zoom’s Linux sample, plus a tiny HTTP shim in Node/Go.
- `Dockerfile` — base image per Zoom’s documented dependencies.

Until this exists, leave `CONFERENCE_BOT_WEBHOOK_URL` unset; OAuth + webhooks still update meetings in the API.
