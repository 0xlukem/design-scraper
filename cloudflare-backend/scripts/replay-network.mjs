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
