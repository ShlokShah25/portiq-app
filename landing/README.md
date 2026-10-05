# PortIQ landing page

Static site, no build step: `index.html`, `styles.css`, `main.js` and `assets/`.

## Preview locally

```
node landing/server.js
```

Then open http://localhost:4100.

## Deploy on Railway

There are two ways. The first costs nothing extra.

### A. Serve it from the main app service

`server/index.js` serves this folder whenever the request's hostname is in `LANDING_HOSTS`
(default: `portiqtechnologies.com,www.portiqtechnologies.com`). Every other hostname gets the app
as before.

1. Deploy the app as usual.
2. In Railway, open the app service and add `portiqtechnologies.com` and `www.portiqtechnologies.com`
   as custom domains. Railway shows a DNS target for each.
3. At your DNS provider, replace the old Vercel records with those targets.
4. To use different hostnames, set the `LANDING_HOSTS` variable (comma-separated).

### B. Run it as its own small service

Use this if the app service has no custom-domain slots left.

1. New Railway service from this repo, Root Directory `landing`.
2. Start command `npm start` (runs `server.js`, zero dependencies).
3. Add the custom domains to that service and point DNS at it.

## Editing

- Copy and sections: `index.html`.
- Prices: the `#pricing` section in `index.html`. The plan limits listed there mirror
  `server/utils/planConstraints.js`; keep the two in step.
- Sign-in and "Start free" links point at `https://meetingassistant.portiqtechnologies.com/admin-login`.
- The two videos in `assets/` are 720p copies of the ads.
