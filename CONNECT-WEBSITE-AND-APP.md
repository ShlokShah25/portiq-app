# Connecting the marketing website and Portiq app

## Current setup

- **App (this repo deployed on Railway):**  
  `https://portiq-app-production.up.railway.app`  
  Flow: Boot screen → Login → Dashboard (requires admin account).

- **Marketing site:**  
  `https://portiqtechnologies.com` (or your deployed URL).  
  Has pricing, “Start Free Trial”, “Login”, etc.

## How they connect

### 1. App → Website

- On the **login page** of the app, “Start free trial” links to the marketing site CTA:  
  `https://portiqtechnologies.com/#cta`  
  (configurable via `client/src/config/urls.js` or `REACT_APP_MARKETING_URL`.)

### 2. Website → App

- **Login** and **Start Free Trial** (or “Go to app”) on the marketing site should send users to the **app URL**, e.g.:  
  `https://portiq-app-production.up.railway.app`  
  so they land on: Boot screen → Login (or signup flow if you add it).

- If your marketing site is static (e.g. `marketing-site/`), update every “Login” and “Start Free Trial” link to this app URL.  
  Example:  
  `href="https://portiq-app-production.up.railway.app"`

- After payment (e.g. Razorpay), your existing flow can redirect to:  
  `https://portiq-app-production.up.railway.app/dashboard`  
  (user must be logged in; otherwise they’ll see the login page.)

### 3. Custom domain (later)

- When you add a custom domain for the app (e.g. `app.portiqtechnologies.com`):
  1. In Railway, add the custom domain to the `portiq-app` service.
  2. In the **marketing site**, replace the app URL with `https://app.portiqtechnologies.com`.
  3. In the **client** (optional), set `REACT_APP_MARKETING_URL` if your marketing URL changes.

## Quick test checklist (before your meeting)

1. **App only**
   - Open `https://portiq-app-production.up.railway.app` (or your Railway URL).
   - See boot screen (logo + “Portiq” + “AI Meeting Assistant” + loading bar) → then login screen.
   - Log in with your admin email/password → dashboard loads, no CORS errors in console.

2. **App → Website**
   - On the app login page, click “Start free trial” → opens marketing site (e.g. `portiqtechnologies.com/#cta`).

3. **Website → App**
   - On the marketing site, click “Login” or “Start Free Trial” → should open the app URL above and show boot then login.

4. **After payment (if you have signup + Razorpay)**
   - Complete signup/payment on the website → redirect should go to the app (e.g. `/dashboard`); user may need to log in if session isn’t created automatically.

If any step fails, check: correct URLs in marketing HTML/JS, CORS and env on the backend, and that the app is deployed and healthy on Railway.
