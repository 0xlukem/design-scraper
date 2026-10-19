import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import {
  RELAY,
  RELAY_META,
  RelayJob,
  type RelayMeta,
} from "../src/resource-relay";
import { RelayBudget, RelayResources } from "../src/relay-resources";
import type { ResourceInput } from "../src/public-resources";

const PUBLIC_ADDRESS = "93.184.216.34";
const RESOURCE_URL = "https://assets.example/resource.bin";

type ResourceFetch = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response>;

function resourceInput(
  url = RESOURCE_URL,
  overrides: Partial<ResourceInput> = {},
): ResourceInput {
  return {
    url,
    method: "GET",
    headers: {},
    body: null,
    ...overrides,
  };
}

function loadRequest(
  url = RESOURCE_URL,
  overrides: Partial<{
    method: string;
    headers: Record<string, string>;
    body: string | null;
    deadline: number;
  }> = {},
) {
  const wire = {
    url,
    method: "GET",
    headers: {},
    body: null,
    deadline: Date.now() + 5_000,
    ...overrides,
  };
  return new Request("https://resource-relay/load", {
    method: "POST",
    body: JSON.stringify(wire),
  });
}

function relayMeta(response: Response): RelayMeta {
  const encoded = response.headers.get(RELAY_META);
  expect(encoded).toBeTruthy();
  return JSON.parse(encoded!) as RelayMeta;
}

function relayFetcher(
  resource: ResourceFetch,
  options: { failCloudflare?: boolean; dnsInits?: RequestInit[] } = {},
): typeof fetch {
  return (async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "cloudflare-dns.com" || url.hostname === "dns.google") {
      options.dnsInits?.push(init ?? {});
      if (options.failCloudflare && url.hostname === "cloudflare-dns.com")
        return new Response(null, { status: 503 });
      const type = url.searchParams.get("type");
      return Response.json({
        Status: 0,
        Answer: type === "A" ? [{ type: 1, data: PUBLIC_ADDRESS }] : [],
      });
    }
    return resource(url, init);
  }) as typeof fetch;
}

function relayStub(job: RelayJob, onRequest?: (request: Request) => void) {
  return {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      onRequest?.(request);
      return job.fetch(request);
    }) as typeof fetch,
  };
}

function relayResources(
  fetcher: typeof fetch,
  budget = new RelayBudget(),
  signal = new AbortController().signal,
  deadline = Date.now() + 5_000,
  totalBytes = RELAY.totalBytes,
) {
  return new RelayResources(
    () => relayStub(new RelayJob(fetcher)),
    signal,
    deadline,
    budget,
    totalBytes,
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function eventually(check: () => boolean) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 1_000) throw new Error("condition did not settle");
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

it("relays a binary resource larger than 1 MB through a real RelayJob", async () => {
  const bytes = new Uint8Array(1_100_001);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const fetcher = relayFetcher(async () => new Response(bytes, {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  }));
  const resources = relayResources(fetcher);

  const output = await resources.load(resourceInput());

  expect(output.status).toBe(200);
  expect(output.headers["content-type"]).toBe("application/octet-stream");
  expect(output.body.byteLength).toBe(bytes.byteLength);
  expect(output.body[0]).toBe(bytes[0]);
  expect(output.body[bytes.length - 1]).toBe(bytes[bytes.length - 1]);
  expect(resources.metrics).toMatchObject({
    downloads: 1,
    bytes_received: bytes.byteLength,
    bytes_completed: bytes.byteLength,
    failed: 0,
  });
  await resources.close();
  expect(resources.transport.cleanup_confirmed).toBe(true);
});

it("counts DNS fallback calls toward the real external-call ceiling", async () => {
  const originalLimit = RELAY.externalCalls;
  (RELAY as { externalCalls: number }).externalCalls = 4;
  try {
    const resource = async () => new Response(new Uint8Array([1]));
    const dnsInits: RequestInit[] = [];
    const fetcher = relayFetcher(resource, { failCloudflare: true, dnsInits });
    const response = await new RelayJob(fetcher).fetch(loadRequest());
    const meta = relayMeta(response);

    expect(meta.error).toMatchObject({ code: "SCRAPE_REQUEST_LIMIT", status: 422 });
    expect(meta.metrics).toMatchObject({
      external_calls: 4,
      dns_requests: 4,
      downloads: 1,
      bytes_received: 0,
      bytes_completed: 0,
      closed: true,
    });
    expect(dnsInits).toHaveLength(4);
    expect(dnsInits.every(init => init.redirect === "manual")).toBe(true);
  } finally {
    (RELAY as { externalCalls: number }).externalCalls = originalLimit;
  }
  const fallback = relayFetcher(async () => new Response(new Uint8Array([1])), { failCloudflare: true });
  const success = relayMeta(await new RelayJob(fallback).fetch(loadRequest()));
  expect(success.error).toBeUndefined();
  expect(success.metrics).toMatchObject({ external_calls: 5, dns_requests: 4, downloads: 1, closed: true });
});

it("blocks a malicious target before the injected transport is called", async () => {
  const fetcher = relayFetcher(async () => {
    throw new Error("resource fetch should not run");
  });
  const response = await new RelayJob(fetcher).fetch(loadRequest("http://127.0.0.1/private"));
  const meta = relayMeta(response);

  expect(meta.error).toMatchObject({ code: "UNSAFE_URL", status: 422 });
  expect(meta.metrics).toMatchObject({ external_calls: 0, dns_requests: 0, downloads: 0, closed: true });
});

it("blocks a private redirect when the browser submits the next hop", async () => {
  let resourceCalls = 0;
  const fetcher = relayFetcher(async () => {
    resourceCalls++;
    return new Response(null, {
      status: 302,
      headers: { location: "http://10.0.0.8/private" },
    });
  });
  const resources = relayResources(fetcher);
  const first = await resources.load(resourceInput());

  expect(first.status).toBe(302);
  expect(first.headers.location).toBe("http://10.0.0.8/private");
  await expect(resources.load(resourceInput(first.headers.location))).rejects.toMatchObject({
    code: "UNSAFE_URL",
    status: 422,
  });
  expect(resourceCalls).toBe(1);
  await resources.close();
});

it("enforces the per-resource byte ceiling and preserves partial-byte accounting", async () => {
  const fetcher = relayFetcher(async () => new Response(new Uint8Array(RELAY.resourceBytes + 1)));
  const resources = relayResources(fetcher);

  await expect(resources.load(resourceInput())).rejects.toMatchObject({
    code: "SCRAPE_RESOURCE_LIMIT",
    status: 422,
  });
  expect(resources.metrics).toMatchObject({
    downloads: 1,
    bytes_received: RELAY.resourceBytes + 1,
    bytes_completed: 0,
    failed: 1,
  });
  expect(resources.transport.invocations[0]).toMatchObject({
    bytes_received: RELAY.resourceBytes + 1,
    bytes_completed: 0,
    closed: true,
  });
  await resources.close();
});

it("rejects successful metadata whose counters exceed the smaller maxBytes grant", async () => {
  const grant = 32;
  let cancelCalls = 0;
  const stub = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/cancel")) {
        cancelCalls++;
        return new Response(null, { status: 204 });
      }
      const wire = await request.json() as { maxBytes?: number };
      expect(wire.maxBytes).toBe(grant);
      return new Response(new Uint8Array(grant + 1), {
        headers: {
          [RELAY_META]: JSON.stringify({
            metrics: {
              external_calls: 1,
              dns_requests: 0,
              downloads: 1,
              redirects: 0,
              bytes_received: grant + 1,
              bytes_completed: grant + 1,
              wall_ms: 1,
              closed: true,
            },
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          } satisfies RelayMeta),
        },
      });
    }) as typeof fetch,
  };
  const resources = new RelayResources(
    () => stub,
    new AbortController().signal,
    Date.now() + 5_000,
    new RelayBudget(),
    grant,
  );

  await expect(resources.load(resourceInput())).rejects.toMatchObject({
    code: "SCRAPE_RESOURCE_LIMIT",
    status: 422,
  });
  expect(cancelCalls).toBe(1);
  expect(resources.metrics).toMatchObject({
    downloads: 1,
    bytes_received: grant + 1,
    bytes_completed: grant + 1,
    failed: 0,
  });
  await resources.close();
  expect(resources.transport.cleanup_confirmed).toBe(true);
});

it("sanitizes request and response hop headers at the relay boundary", async () => {
  let received: RequestInit | undefined;
  const fetcher = relayFetcher(async (_url, init) => {
    received = init;
    return new Response(new Uint8Array([7]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "1",
        connection: "keep-alive",
        "transfer-encoding": "chunked",
        "x-fixture": "kept",
      },
    });
  });
  const job = new RelayJob(fetcher);
  const response = await job.fetch(loadRequest(RESOURCE_URL, {
    headers: {
      authorization: "secret",
      host: "private.example",
      connection: "keep-alive",
      "content-length": "999",
      "accept-encoding": "gzip",
      "cf-connecting-ip": "10.0.0.1",
      "x-forwarded-for": "10.0.0.1",
      accept: "application/octet-stream",
      "x-fixture": "forwarded",
    },
  }));
  const meta = relayMeta(response);
  const headers = new Headers(received?.headers);

  expect(headers.get("accept")).toBe("application/octet-stream");
  expect(headers.get("x-fixture")).toBe("forwarded");
  expect(headers.get("accept-encoding")).toBe("identity");
  for (const name of ["authorization", "host", "connection", "content-length", "cf-connecting-ip", "x-forwarded-for"])
    expect(headers.has(name), name).toBe(false);
  expect(meta.headers).toMatchObject({ "content-type": "application/octet-stream", "x-fixture": "kept" });
  for (const name of ["content-length", "connection", "transfer-encoding"])
    expect(meta.headers, name).not.toHaveProperty(name);
});

it("allows one load and rejects every later load on the same RelayJob", async () => {
  const fetcher = relayFetcher(async () => new Response(new Uint8Array([1, 2, 3])));
  const job = new RelayJob(fetcher);

  const first = await job.fetch(loadRequest());
  const second = await job.fetch(loadRequest());

  expect(first.status).toBe(200);
  expect(second.status).toBe(409);
});

it("reports an expired deadline without starting DNS or resource work", async () => {
  let calls = 0;
  const fetcher = relayFetcher(async () => {
    calls++;
    return new Response(new Uint8Array([1]));
  });
  const response = await new RelayJob(fetcher).fetch(loadRequest(RESOURCE_URL, {
    deadline: Date.now() - 1,
  }));
  const meta = relayMeta(response);

  expect(meta.error).toMatchObject({ code: "SCRAPE_TIMEOUT", status: 504 });
  expect(meta.metrics).toMatchObject({ external_calls: 0, dns_requests: 0, downloads: 0, closed: true });
  expect(calls).toBe(0);
});

it("closes an unfinished stream when the RelayResources client is cancelled", async () => {
  const started = deferred<void>();
  let streamCancelled = false;
  const fetcher = relayFetcher(async () => {
    started.resolve();
    return new Response(new ReadableStream<Uint8Array>({
      cancel() {
        streamCancelled = true;
      },
    }));
  });
  const controller = new AbortController();
  const resources = relayResources(fetcher, new RelayBudget(), controller.signal);
  const loading = resources.load(resourceInput());
  await started.promise;

  controller.abort();

  await expect(loading).rejects.toThrow();
  await resources.close();
  await eventually(() => streamCancelled);
  expect(resources.transport.cancel_calls).toBe(1);
  expect(resources.transport.cleanup_confirmed).toBe(true);
});

it("reserves maxBytes across concurrent jobs and releases the grant after each result", async () => {
  const firstRelease = deferred<void>();
  const secondRelease = deferred<void>();
  const grants: number[] = [];
  let resourceCalls = 0;
  let completedResourceCalls = 0;
  const fetcher = relayFetcher(async () => {
    const call = ++resourceCalls;
    if (call === 1) await firstRelease.promise;
    if (call === 2) await secondRelease.promise;
    completedResourceCalls++;
    return new Response(new Uint8Array([call]));
  });
  const controller = new AbortController();
  const resources = new RelayResources(
    () => relayStub(new RelayJob(fetcher), request => {
      if (request.url.endsWith("/load")) {
        void request.clone().json().then(wire => grants.push(Number((wire as { maxBytes?: number }).maxBytes)));
      }
    }),
    controller.signal,
    Date.now() + 5_000,
    new RelayBudget(),
    RELAY.resourceBytes * 2,
  );
  const loading = [1, 2, 3].map(name => resources.load(resourceInput(`https://${name}.example/resource`)));
  await eventually(() => resourceCalls === 2 && grants.length === 2);
  expect(grants).toEqual([RELAY.resourceBytes, RELAY.resourceBytes]);

  firstRelease.resolve();
  await eventually(() => completedResourceCalls === 1);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(resourceCalls).toBe(2);

  secondRelease.resolve();
  await Promise.all(loading);
  expect(resourceCalls).toBe(3);
  expect(grants).toEqual([RELAY.resourceBytes, RELAY.resourceBytes, RELAY.resourceBytes]);
  expect(resources.metrics.bytes_received).toBe(3);
  await resources.close();
});

it("cancels a stalled sibling immediately when another body exceeds its grant", async () => {
  const siblingStarted = deferred<void>();
  let siblingCancelled = false;
  const siblingFetcher = relayFetcher(async () => {
    siblingStarted.resolve();
    return new Response(new ReadableStream<Uint8Array>({
      cancel() {
        siblingCancelled = true;
      },
    }));
  });
  const siblingJob = new RelayJob(siblingFetcher);
  const oversizedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(RELAY.resourceBytes));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const oversizedStub = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/cancel")) return new Response(null, { status: 204 });
      await siblingStarted.promise;
      return new Response(oversizedBody, {
        headers: {
          [RELAY_META]: JSON.stringify({
            metrics: {
              external_calls: 1,
              dns_requests: 0,
              downloads: 1,
              redirects: 0,
              bytes_received: RELAY.resourceBytes,
              bytes_completed: RELAY.resourceBytes,
              wall_ms: 1,
              closed: true,
            },
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          } satisfies RelayMeta),
        },
      });
    }) as typeof fetch,
  };
  const stubs = [oversizedStub, relayStub(siblingJob)];
  const resources = new RelayResources(
    () => stubs.shift()!,
    new AbortController().signal,
    Date.now() + 5_000,
    new RelayBudget(),
    RELAY.resourceBytes * 2,
  );
  const oversized = resources.load(resourceInput("https://oversized.example/resource"));
  const sibling = resources.load(resourceInput("https://sibling.example/resource"));

  await expect(oversized).rejects.toMatchObject({
    code: "SCRAPE_RESOURCE_LIMIT",
    status: 422,
  });
  await expect(sibling).rejects.toMatchObject({ code: "SCRAPE_RESOURCE_LIMIT", status: 422 });
  expect(siblingCancelled).toBe(true);
  expect(resources.transport.cancel_calls).toBe(2);
  await resources.close();
  expect(resources.transport.cleanup_confirmed).toBe(true);
});

it("does not start queued jobs after the outer signal aborts", async () => {
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  let resourceCalls = 0;
  const fetcher = relayFetcher(async () => {
    resourceCalls++;
    if (resourceCalls === 1) firstStarted.resolve();
    if (resourceCalls === 2) secondStarted.resolve();
    return new Response(new ReadableStream<Uint8Array>({
      cancel() {},
    }));
  });
  const controller = new AbortController();
  let stubsCreated = 0;
  const resources = new RelayResources(
    () => {
      stubsCreated++;
      return relayStub(new RelayJob(fetcher));
    },
    controller.signal,
    Date.now() + 5_000,
    new RelayBudget(),
    RELAY.resourceBytes * 2,
  );
  const inputs = ["one", "two", "three"].map(name => resourceInput(`https://${name}.example/resource`));
  const loading = inputs.map(input => resources.load(input));
  await Promise.all([firstStarted.promise, secondStarted.promise]);
  expect(stubsCreated).toBe(2);
  expect(resourceCalls).toBe(2);

  controller.abort();
  const settled = await Promise.allSettled(loading);
  await resources.close();

  expect(stubsCreated).toBe(2);
  expect(resourceCalls).toBe(2);
  expect(settled.filter(result => result.status === "rejected")).toHaveLength(3);
});

it("shares the internal RelayBudget across resource clients in a mix", async () => {
  const budget = new RelayBudget();
  budget.calls = RELAY.internalCalls - RELAY.cleanupReserve - 1;
  const fetcher = relayFetcher(async () => new Response(new Uint8Array([1])));
  const first = relayResources(fetcher, budget);
  let secondStubCreated = false;
  const second = new RelayResources(
    () => {
      secondStubCreated = true;
      return relayStub(new RelayJob(fetcher));
    },
    new AbortController().signal,
    Date.now() + 5_000,
    budget,
  );

  await first.load(resourceInput("https://first.example/resource"));
  await expect(second.load(resourceInput("https://second.example/resource"))).rejects.toMatchObject({
    code: "SCRAPE_REQUEST_LIMIT",
    status: 422,
  });
  expect(budget.calls).toBe(RELAY.internalCalls - RELAY.cleanupReserve);
  expect(secondStubCreated).toBe(false);
  await first.close();
  await second.close();
});

it("reports cleanup failures after a relay cancellation is not confirmed", async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const fetcher = relayFetcher(async () => {
    started.resolve();
    await release.promise;
    return new Response(new Uint8Array([1]));
  });
  const job = new RelayJob(fetcher);
  let cancelCalls = 0;
  const stub = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/cancel")) {
        cancelCalls++;
        return new Response(null, { status: 500 });
      }
      return job.fetch(request);
    }) as typeof fetch,
  };
  const resources = new RelayResources(
    () => stub,
    new AbortController().signal,
    Date.now() + 5_000,
  );
  const loading = resources.load(resourceInput());
  await started.promise;
  const closing = resources.close();
  await eventually(() => cancelCalls === 1);
  release.resolve();

  await expect(loading).rejects.toThrow();
  await expect(closing).rejects.toMatchObject({ code: "BROWSER_CLOSE_FAILED", status: 503 });
  expect(resources.transport.cleanup_confirmed).toBe(false);
});

it("captures a synchronous cancellation stub throw as a cleanup failure", async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const fetcher = relayFetcher(async () => {
    started.resolve();
    await release.promise;
    return new Response(new Uint8Array([1]));
  });
  const job = new RelayJob(fetcher);
  let cancelCalls = 0;
  const stub = {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/cancel")) {
        cancelCalls++;
        throw new Error("synchronous cancellation failure");
      }
      return job.fetch(request);
    }) as typeof fetch,
  };
  const resources = new RelayResources(
    () => stub,
    new AbortController().signal,
    Date.now() + 5_000,
  );
  const loading = resources.load(resourceInput());
  await started.promise;
  const closing = resources.close();
  await eventually(() => cancelCalls === 1);
  release.resolve();

  await expect(loading).rejects.toThrow();
  await expect(closing).rejects.toMatchObject({ code: "BROWSER_CLOSE_FAILED", status: 503 });
  expect(resources.transport.cleanup_confirmed).toBe(false);
});

it("keeps cancellation capacity for every active download at the invocation ceiling", async () => {
  const budget = new RelayBudget();
  budget.calls = RELAY.internalCalls - RELAY.cleanupReserve - RELAY.concurrency;
  let started = 0;
  const fetcher = relayFetcher(async () => {
    started++;
    return new Response(new ReadableStream<Uint8Array>({ cancel() {} }));
  });
  const controller = new AbortController();
  const resources = new RelayResources(() => relayStub(new RelayJob(fetcher)),
    controller.signal, Date.now() + 5000, budget);
  const pending = Array.from({length:RELAY.concurrency}, (_,i) => resources.load(resourceInput(`https://download-${i}.example/file`)));
  const settled = Promise.allSettled(pending);
  await eventually(() => started === RELAY.concurrency);
  expect(budget.calls).toBe(RELAY.internalCalls - RELAY.cleanupReserve);
  controller.abort();
  expect((await settled).every(result => result.status === "rejected")).toBe(true);
  await resources.close();
  expect(resources.transport.cancel_calls).toBe(RELAY.concurrency);
  expect(resources.transport.cleanup_confirmed).toBe(true);
  expect(budget.calls).toBe(RELAY.internalCalls - RELAY.cleanupReserve + RELAY.concurrency);
});
