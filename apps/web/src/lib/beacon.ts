// Cloudflare Web Analytics beacon, documented form (checked 2026-10-20, WP7-1):
// <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "..."}'></script>
// External script, so no CSP hash is needed. The token is validated in env.ts before it gets here.
// Analytics.astro renders it; its render test pins the emitted tag.

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** Value of the data-cf-beacon attribute. */
export function beaconConfig(token: string): string {
  return JSON.stringify({ token });
}
