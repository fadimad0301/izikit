// Monolith: the API lives in the same Next.js app under /api/*, so the
// default is an empty string (same-origin / relative fetch). Override only
// for rare cross-origin setups (e.g. a mobile client hitting a hosted
// instance). The legacy `http://localhost:4000` default was a leftover from
// the pre-monolith era when the backend ran as a separate Express server.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
export const COOKIE_PREFIX = process.env.NEXT_PUBLIC_COOKIE_PREFIX ?? 'app';

// Where auth screens (login, verify-email) send the user after success.
// `/dashboard` doesn't exist yet (lands in a later phase) — one constant so
// that phase only has to change this line, not every auth page.
export const POST_AUTH_REDIRECT = '/';
