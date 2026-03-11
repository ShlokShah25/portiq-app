/**
 * Central URLs for app ↔ website.
 * - MARKETING_URL: where "Start free trial" on the login page sends users.
 * - In production, marketing site should link "Login" / "Start Free Trial" to this app's origin (same as window.location.origin when deployed).
 */
export const MARKETING_URL = process.env.REACT_APP_MARKETING_URL || 'https://portiqtechnologies.com';
export const MARKETING_CTA_HASH = '#cta';
