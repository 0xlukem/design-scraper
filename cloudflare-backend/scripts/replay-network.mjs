// Replay may load the selected UI origin. API responses are fulfilled by the
// page-specific mocks; any other network destination fails before sending.
export async function isolateReplayNetwork(context, site) {
  const unexpected = [];
  const origin = new URL(site).origin;
  await context.route("**/*", async route => {
    const destination = new URL(route.request().url()).origin;
    if (destination === origin) return route.continue();
    unexpected.push(destination); // Never record paths, queries or headers.
    await route.abort("blockedbyclient");
  });
  return unexpected;
}

// The local UI deliberately reads public quotas on its own origin; all other
// requests still use the configured API origin. Intercept both without proxying.
export function replayApiPattern(site, api) {
  const siteOrigin = new URL(site).origin, apiOrigin = new URL(api).origin;
  return url => url.origin === apiOrigin && url.pathname.startsWith('/api/') ||
    url.origin === siteOrigin && url.pathname === '/api/quotas';
}
