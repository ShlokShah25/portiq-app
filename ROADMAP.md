# Portiq – Remaining product roadmap

Notes for future implementation. Core SaaS flow (signup, pricing, Razorpay, app login) is in place.

---

## 1. Auto-login after subscription purchase

- **Scope:** After user completes Razorpay payment for a plan, redirect to app and log them in automatically (no separate login step).
- **Flow:** Backend issues short-lived one-time token post-payment → redirect to app with `?token=...` → app route (e.g. `/auth/continue`) exchanges token for session → store auth token → redirect to dashboard.
- **Constraint:** Auto-login only when subscription is successfully purchased (not after signup alone).

---

## 2. Forgot password

- **Scope:** All login entry points (marketing site login, app main login at `/admin-login`).
- **Flow:** “Forgot password” link → user enters email → backend sends reset link (or code) → user sets new password → can log in with new password.
- **Needs:** Email sending (e.g. existing MAIL_* env), reset token/code storage, and a reset-password page.

---

## 3. Sign in with Google

- **Scope:** Optional “Sign in with Google” on signup and/or login (website and/or app).
- **Needs:** Google OAuth client ID/secret, backend callback to create/link user, frontend OAuth button and redirect handling.

---

## 4. Sign in with Apple

- **Scope:** Optional “Sign in with Apple” on signup and/or login (website and/or app).
- **Needs:** Apple Developer account, Apple Sign In config, backend callback to create/link user, frontend button and redirect handling.

---

*Once these are done, core auth and onboarding is complete.*
