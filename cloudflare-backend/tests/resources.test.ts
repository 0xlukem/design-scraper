import { it, expect, vi } from "vitest";
import { PublicResources } from "../src/public-resources";
const input = {
  url: "https://example.com/a.css",
  method: "GET",
  headers: {},
  body: null,
};
it.each(["video/mp4", "audio/ogg", "application/vnd.apple.mpegurl", "application/dash+xml; charset=utf-8"])(
  "closes %s responses before reading media bytes", async contentType => {
    let cancelled = false;
    const loader = new PublicResources((async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { headers: { "content-type": contentType } })) as typeof fetch, AbortSignal.timeout(1000));
    const result = await loader.load({ ...input, url: "https://example.com/opaque-player-source" });
    expect(cancelled).toBe(true);
    expect(result.body.byteLength).toBe(0);
    expect(loader.metrics).toMatchObject({ downloads: 1, bytes_received: 0, bytes_completed: 0, failed: 0 });
  });
it("keeps redirects manual for browser interception and excludes privileged headers", async () => {
  const f = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/" },
      }),
  );
  const loader = new PublicResources(
    f as typeof fetch,
    AbortSignal.timeout(1000),
  );
  const r = await loader.load({
    ...input,
    headers: {
      authorization: "secret",
      "cf-connecting-ip": "private",
      accept: "text/css",
    },
  });
  expect(r.status).toBe(302);
  const init = (f.mock.calls as unknown as [string, RequestInit][])[0][1];
  expect(init.redirect).toBe("manual");
  const h = new Headers(init.headers);
  expect(h.has("authorization")).toBe(false);
  expect(h.has("cf-connecting-ip")).toBe(false);
  expect(h.get("accept")).toBe("text/css");
});
it("rejects oversized resources before buffering them", async () => {
  const f = vi.fn(async () => new Response(new Uint8Array(8000001)));
  await expect(
    new PublicResources(f as typeof fetch, AbortSignal.timeout(1000)).load(
      input,
    ),
  ).rejects.toMatchObject({ code: "SCRAPE_RESOURCE_LIMIT" });
});
it("cancels a resource stream on deadline", async () => {
  let cancelled = false;
  const f = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await expect(
    new PublicResources(f as typeof fetch, AbortSignal.timeout(20)).load(input),
  ).rejects.toThrow();
  expect(cancelled).toBe(true);
});

it("counts partially read rejected bytes independently of completed resources", async () => {
  const loader = new PublicResources((async () => new Response(new Uint8Array(30))) as typeof fetch,
    AbortSignal.timeout(1000), { resourceBytes: 20, totalBytes: 100 });
  await expect(loader.load(input)).rejects.toMatchObject({ code: 'SCRAPE_RESOURCE_LIMIT' });
  expect(loader.metrics).toMatchObject({ downloads: 1, bytes_received: 30, bytes_completed: 0, failed: 1 });
});
it("explicit cancellation tears down an unfinished body without waiting for the outer deadline", async () => {
  let cancelled = false;
  const loader = new PublicResources((async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }))) as typeof fetch, AbortSignal.timeout(10000));
  const promise = loader.load(input);
  await new Promise(resolve => setTimeout(resolve, 10));
  loader.cancel();
  await expect(promise).rejects.toThrow();
  expect(cancelled).toBe(true);
});
