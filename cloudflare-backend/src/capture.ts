import {screenshotSections, SectionLayoutError} from "./capture-sections";
import type { Browser, Request as BrowserRequest, Response as BrowserResponse } from "@cloudflare/playwright";
import { Buffer } from "node:buffer";
import type { Config } from "./config";
import { ApiError } from "./errors";
import { PublicNetwork, targetUrl, type NetworkPolicy } from "./url-safety";
import { classifyVariables } from "./domain/classify";
import { isMediaContentType, type ResourceTransport } from "./public-resources";
import { extractionScript } from "./domain/extraction-script";
import { selectCssEvidence } from "./capture-css";
import { captureReadiness } from "./capture-readiness";
import { assessFailedScripts } from "./capture-script-quality";

export interface CaptureMetrics {
  requests: number;
  browser_wall_ms: number;
  external_hosts: number;
  stage: string;
  stage_ms: Record<string, number>;
  blocked: Record<string, number>;
  css_characters: number;
  css_sheets: number;
  css_omitted: number;
  css_rules: number;
  pending_images: number;
  fonts_loaded?: boolean;
  composition_failure?: SectionLayoutError["geometry"];
  missing_background_images?: number;
  failed_async_scripts?: number;
  required_image_failures?: { kind: string; origin: string; status: number | null; browser_error: string | null }[];
  outside_images: number;
  close_confirmed: boolean;
  dns_requests: number | null;
  resource_downloads: number | null;
  resource_bytes_received: number | null;
  resource_bytes_completed: number | null;
  transport?: ResourceTransport["transport"];
  navigation: { response_received: boolean; status: number | null; final_origin: string | null };
  routes: {
    started: number; completed: number; active_peak: number; pending_at_close: number;
    headers_ms: number; transport_ms: number; fulfill_ms: number;
    slowest: { origin: string; type: string; status: number | null; phase: string; wall_ms: number }[];
    failures: { origin: string; type: string; status: number | null }[];
  };
}
export interface CaptureResult {
  screenshot: string;
  data: Record<string, unknown>;
  metrics: CaptureMetrics;
}
export async function capture(
  browser: Browser, url: string, c: Config, signal: AbortSignal,
  network: NetworkPolicy = new PublicNetwork(fetch, signal),
  resources?: ResourceTransport,
): Promise<CaptureResult> {
  const started = Date.now();
  const metrics: CaptureMetrics = {
    requests: 0, browser_wall_ms: 0, external_hosts: 0, stage: "context",
    stage_ms: {}, blocked: {}, css_characters: 0, css_sheets: 0,
    css_omitted: 0, css_rules: 0, pending_images: 0, outside_images: 0,
    close_confirmed: false,
    dns_requests: null, resource_downloads: null,
    resource_bytes_received: null, resource_bytes_completed: null,
    navigation: { response_received: false, status: null, final_origin: null },
    routes: { started: 0, completed: 0, active_peak: 0, pending_at_close: 0,
      headers_ms: 0, transport_ms: 0, fulfill_ms: 0, slowest: [], failures: [] },
  };
  let stageStart = started;
  const stage = (name: string) => {
    metrics.stage_ms[metrics.stage] = (metrics.stage_ms[metrics.stage] || 0) + Date.now() - stageStart;
    metrics.stage = name; stageStart = Date.now();
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, serviceWorkers: "block", acceptDownloads: false,
  });
  let fatal: ApiError | undefined;
  let closing: Promise<void> | undefined;
  let abortClosing: Promise<void> | undefined;
  const close = () => { closing ||= context.close(); closing.catch(() => {}); };
  const abort = () => {
    resources?.cancel?.();
    abortClosing ||= browser.close(); abortClosing.catch(() => {});
  };
  const fail = (error: ApiError) => {
    fatal ||= error;
    resources?.cancel?.();
    close();
  };
  const blocked = (reason: string) => { metrics.blocked[reason] = (metrics.blocked[reason] || 0) + 1; };
  const hosts = new Set<string>();
  const audits: Promise<void>[] = [];
  const failedImages = new Set<string>();
  const imageErrors = new Map<string, string>();
  const imageStatuses = new Map<string, number>();
  const pendingImages = new Set<string>();
  const failedScripts = new Map<string, { origin: string; status: number | null; browser_error: string | null }>();
  const recordScriptFailure = (request: BrowserRequest, status: number | null = null, browserError: string | null = null) => {
    // Match the DOM's original src after redirects, without exposing URL paths,
    // query credentials or upstream exception messages in capture diagnostics.
    let initial = request;
    for (let prior = initial.redirectedFrom(); prior; prior = initial.redirectedFrom()) initial = prior;
    const key = initial.url();
    const previous = failedScripts.get(key);
    failedScripts.set(key, { origin: new URL(request.url()).origin,
      status: status ?? previous?.status ?? null,
      browser_error: browserError && /^net::[A-Z0-9_]+$/.test(browserError) ? browserError : previous?.browser_error ?? null });
  };
  const fulfilled = new WeakSet<object>();
  let activeRoutes = 0;
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    signal.throwIfAborted();
    await context.addInitScript(() => {
      // Keep DOM geometry/posters intact, including for inline/blob media.
      document.addEventListener("play", event => {
        if (event.target instanceof HTMLMediaElement) event.target.pause();
      }, true);
    });
    const page = await context.newPage();
    page.on("request", request => { if (request.resourceType() === "image") pendingImages.add(request.url()); });
    page.on("requestfinished", request => { pendingImages.delete(request.url()); });
    await context.routeWebSocket("**/*", route => { blocked("websocket"); route.close(); });
    await context.route("**/*", async route => {
      const request = route.request();
      const routeStart = Date.now();
      let phase = "validation", phaseStart = routeStart;
      let status: number | null = null;
      let origin = "invalid";
      try { origin = new URL(request.url()).origin; } catch {}
      const setPhase = (next: string) => {
        const elapsed = Date.now() - phaseStart;
        if (phase === "headers") metrics.routes.headers_ms += elapsed;
        if (phase === "transport") metrics.routes.transport_ms += elapsed;
        if (phase === "fulfill") metrics.routes.fulfill_ms += elapsed;
        phase = next; phaseStart = Date.now();
      };
      metrics.routes.started++;
      metrics.routes.active_peak = Math.max(metrics.routes.active_peak, ++activeRoutes);
      try {
        if (fatal) { await route.abort(); return; }
        signal.throwIfAborted();
        if (++metrics.requests > c.requests)
          throw new ApiError("SCRAPE_REQUEST_LIMIT", "The website exceeded the request limit.", 422);
        let redirects = 0;
        for (let prior = request.redirectedFrom(); prior; prior = prior.redirectedFrom()) redirects++;
        if (redirects > c.redirects)
          throw new ApiError("SCRAPE_REDIRECT_LIMIT", "The website exceeded the redirect limit.", 422);
        // Branding evidence needs the media box/poster, not decoded footage.
        // Also exclude explicit media URLs fetched by JS players (MSE).
        const mediaFetch = ["fetch", "xhr", "other"].includes(request.resourceType()) &&
          /\.(mp4|webm|ogv|m3u8|mpd|m4s)$/i.test(new URL(request.url()).pathname);
        if (request.resourceType() === "eventsource" || request.resourceType() === "media" || mediaFetch) {
          blocked(request.resourceType() === "eventsource" ? "eventsource" : "media");
          await route.abort(); return;
        }
        if (resources?.validatesNetwork) targetUrl(request.url(), 16384);
        else await network.validate(request.url());
        hosts.add(new URL(request.url()).hostname);
        setPhase("headers");
        const headers = await request.allHeaders();
        // Speculative route data belongs to a future navigation. Keep actual
        // scripts/styles/fonts and unmarked application fetches unchanged.
        if (request.method() === "GET" && !request.isNavigationRequest() &&
            ["fetch", "other"].includes(request.resourceType()) &&
            (/(?:^|[\s,;])prefetch(?:$|[\s,;])/i.test(`${headers["sec-purpose"] || ""} ${headers.purpose || ""}`) ||
             headers["next-router-prefetch"] === "1")) {
          blocked("prefetch");
          await route.abort();
          return;
        }
        if (resources) {
          setPhase("transport");
          const result = await resources.load({ url: request.url(), method: request.method(),
            headers, body: request.postDataBuffer() });
          status = result.status;
          if (result.status >= 200 && result.status < 300 && isMediaContentType(result.headers["content-type"])) {
            if (request.isNavigationRequest() || ["script", "stylesheet", "font", "image"].includes(request.resourceType()))
              throw new ApiError("CAPTURE_INCOMPLETE", "A required rendering resource returned excluded media content.", 422);
            blocked("media"); await route.abort(); return;
          }
          // Record before fulfill: Chromium can suppress a 404 image response
          // from its response event (for example an XML error blocked by ORB).
          if (request.resourceType() === "image") imageStatuses.set(request.url(), status);
          if (request.resourceType() === "script" && status >= 400) recordScriptFailure(request, status);
          setPhase("fulfill");
          fulfilled.add(request);
          await route.fulfill(result);
        } else await route.continue();
      } catch (error) {
        if (!fatal && !signal.aborted) {
          const e = error instanceof ApiError ? error : new ApiError("SCRAPE_FAILED", "A required resource could not be loaded.", 502, true);
          if (request.resourceType() === "script" && e.code === "SCRAPE_FAILED") recordScriptFailure(request);
          else blocked(e.code);
          // Safety and budget failures are fatal even on fetch/XHR resources.
          if (request.isNavigationRequest() || ["stylesheet", "font"].includes(request.resourceType()) ||
              (request.resourceType() === "script" && e.code !== "SCRAPE_FAILED") ||
              ["UNSAFE_URL", "DNS_VALIDATION_FAILED", "SCRAPE_REQUEST_LIMIT", "SCRAPE_RESOURCE_LIMIT", "SCRAPE_REDIRECT_LIMIT"].includes(e.code)) fail(e);
          else if (request.resourceType() === "image") failedImages.add(request.url());
        }
        await route.abort().catch(() => {});
      } finally {
        const lastPhase = phase;
        setPhase("finished");
        activeRoutes--;
        metrics.routes.completed++;
        metrics.routes.slowest.push({ origin, type: request.resourceType(), status,
          phase: lastPhase, wall_ms: Date.now() - routeStart });
        metrics.routes.slowest.sort((a, b) => b.wall_ms - a.wall_ms);
        metrics.routes.slowest.length = Math.min(metrics.routes.slowest.length, 8);
      }
    });
    page.on("requestfailed", request => {
      pendingImages.delete(request.url());
      if (fatal || signal.aborted) return;
      if (["stylesheet", "font"].includes(request.resourceType()))
        fail(new ApiError("CAPTURE_INCOMPLETE", "A required stylesheet or font failed to load.", 422, true));
      if (request.resourceType() === "script") recordScriptFailure(request, null, request.failure()?.errorText);
      if (request.resourceType() === "image") {
        failedImages.add(request.url());
        const error = request.failure()?.errorText || '';
        imageErrors.set(request.url(), /^net::[A-Z0-9_]+$/.test(error) ? error : 'request_failed');
      }
    });
    page.on("response", (response: BrowserResponse) => {
      audits.push((async () => {
        try {
          if (!/^https?:/.test(response.url())) return;
          if (response.request().resourceType() === "image") imageStatuses.set(response.url(), response.status());
          if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
            metrics.navigation = { response_received: true, status: response.status(),
              final_origin: new URL(response.url()).origin };
          }
          if (!fulfilled.has(response.request())) {
            const address = await response.serverAddr();
            if (!address) throw new ApiError("UNSAFE_URL", "A resource network address could not be audited.", 422);
            network.audit(response.url(), address.ipAddress);
          }
          if (response.status() >= 400) {
            const type = response.request().resourceType();
            if (metrics.routes.failures.length < 8) metrics.routes.failures.push({
              origin: new URL(response.url()).origin, type, status: response.status(),
            });
            if (["stylesheet", "font"].includes(type))
              fail(new ApiError("CAPTURE_INCOMPLETE", "A required stylesheet or font failed to load.", 422, true));
            if (type === "script") recordScriptFailure(response.request(), response.status());
            if (type === "image") failedImages.add(response.url());
          }
        } catch (error) {
          if (!fatal && !signal.aborted) fail(error instanceof ApiError ? error : new ApiError("UNSAFE_URL", "A resource network address could not be audited.", 422));
        }
      })());
    });
    const cdp = await context.newCDPSession(page);
    const sheets = new Map<string, string>();
    cdp.on("CSS.styleSheetAdded", event => {
      if (sheets.size < 160) sheets.set(event.header.styleSheetId, event.header.sourceURL);
      else metrics.css_omitted++;
    });
    cdp.on("CSS.styleSheetRemoved", event => { sheets.delete(event.styleSheetId); });
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    stage("navigation");
    const response = await page.goto(url, { waitUntil: "load", timeout: Math.max(1000, c.scrapeMs - 5000) });
    metrics.navigation = { response_received: !!response, status: response?.status() ?? null,
      final_origin: response ? new URL(response.url()).origin : null };
    if (!response || response.status() >= 400)
      throw new ApiError("SCRAPE_FAILED", response
        ? `The source website returned HTTP ${response.status()}.`
        : "The source website did not return a navigation response.", 502, true);
    stage("region");
    await page.evaluate(async height => {
      // Let hydration run, then trigger lazy assets only within the capture region.
      await new Promise(resolve => setTimeout(resolve, 250));
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, height); y += 700) {
        window.scrollTo({ left: 0, top: y, behavior: "instant" });
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      window.scrollTo({ left: 0, top: 0, behavior: "instant" });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, c.height);
    let readiness!: {fontsLoaded:boolean;pending:number;outside:number;required:string[];imageUrls:string[];backgroundUrls:string[]};
    const missingBackgroundsSet = new Set<string>();
    const checkFailedScripts = async () => {
      if (!failedScripts.size) return;
      const usable = await page.evaluate(`(${assessFailedScripts})(${JSON.stringify({ urls: [...failedScripts.keys()], height: c.height })})`);
      if (!usable) throw new ApiError("CAPTURE_INCOMPLETE", "A required script failed to load or left insufficient rendered design evidence.", 422, true);
      metrics.failed_async_scripts = failedScripts.size;
    };
    const waitForResources = async () => {
    stage("resources");
    const readReadiness = (waitMs: number) => page.evaluate(`(${captureReadiness})(${JSON.stringify({ height: c.height,
      viewportOnly: true, waitMs })})`) as Promise<{
        fontsLoaded: boolean; pending: number; outside: number; required: string[];
        imageUrls: string[]; backgroundUrls: string[];
      }>;
    const readinessDeadline = Math.min(started + c.scrapeMs - 3000, Date.now() + 8000);
    readiness = await readReadiness(Math.max(0, readinessDeadline - Date.now()));
    // Backgrounds have no HTMLImageElement.complete flag. Wait for their
    // observed network completion too, without waiting for off-region assets.
    const backgroundDeadline = Math.min(started + c.scrapeMs - 2000, Date.now() + 3000);
    while (readiness.required.some(url => pendingImages.has(url)) && Date.now() < backgroundDeadline)
      await page.waitForTimeout(50);
    // Resources can complete during the network wait. Inspect current DOM state,
    // rather than rejecting using the earlier pending-image snapshot.
    readiness = await readReadiness(0);
    // Completing a background or hydration step can introduce a new font or
    // image after the first stable snapshot. Spend the remaining bounded wait
    // on that current state instead of treating it as a failed resource.
    while ((!readiness.fontsLoaded || readiness.pending ||
            readiness.required.some(url => pendingImages.has(url))) &&
           Date.now() < readinessDeadline) {
      if (fatal) throw fatal;
      await page.waitForTimeout(50);
      readiness = await readReadiness(Math.max(0, readinessDeadline - Date.now()));
    }
    metrics.fonts_loaded = readiness.fontsLoaded;
    metrics.pending_images = readiness.pending + readiness.required.filter(url => pendingImages.has(url)).length;
    metrics.outside_images = readiness.outside;
    await Promise.all(audits);
    if (fatal) throw fatal;
    await checkFailedScripts();
    // A confirmed HTTP 404 used only as a CSS background may remain absent,
    // exactly as in the source browser. Never exempt the same URL when it is
    // also a visible content image, or a timeout, safety failure or other status.
    const newMissingBackgrounds = readiness.backgroundUrls.filter(url =>
      imageStatuses.get(url) === 404 && !readiness.imageUrls.includes(url));
    metrics.missing_background_images = newMissingBackgrounds.length;
    const requiredFailures = readiness.required.filter(url => failedImages.has(url) && !newMissingBackgrounds.includes(url));
    metrics.required_image_failures = requiredFailures.slice(0, 8).map(url => ({
      kind: readiness.imageUrls.includes(url) ? 'image' : 'background',
      origin: (() => { try { return new URL(url).origin; } catch { return 'invalid'; } })(),
      status: imageStatuses.get(url) ?? null, browser_error: imageErrors.get(url) ?? null,
    }));
    if (!readiness.fontsLoaded || metrics.pending_images || requiredFailures.length)
      throw new ApiError("CAPTURE_INCOMPLETE", "Required fonts, stylesheets or visible images did not load.", 422, true);
      for(const url of newMissingBackgrounds) missingBackgroundsSet.add(url);
      metrics.missing_background_images = missingBackgroundsSet.size;
      stage("screenshot");
    };
    // Each photographed viewport is checked after scrolling/overlay normalization.
    // Requiring lazy images in later tiles now would wait for untriggered loads.
    stage("screenshot");
    const sectionResult = await screenshotSections(page,c.height,Math.max(1,c.scrapeMs-(Date.now()-started)-2500),waitForResources);
    const screenshot = sectionResult.screenshot;
    const missingBackgrounds = [...missingBackgroundsSet];
    stage("css");
    const variables: Record<string, string> = {};
    const breakpoints = new Set<string>();
    const cssEvidence: Record<string, unknown> = {};
    const seen = new Set<string>();
    // Read and release one sheet at a time. A bounded sample is explicit; rendered
    // computed styles remain the primary evidence for the captured region.
    for (const [id, source] of [...sheets]) {
      if (!sheets.has(id)) continue;
      if (metrics.css_characters >= 8000000 || metrics.css_rules >= 50000) { metrics.css_omitted++; continue; }
      let text: string;
      try { ({ text } = await cdp.send("CSS.getStyleSheetText", { styleSheetId: id })); }
      catch (error) { if (!sheets.has(id)) continue; throw error; }
      metrics.css_characters += text.length;
      metrics.css_sheets++;
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const signature = Buffer.from(hash).toString("hex");
      if (seen.has(signature)) continue;
      seen.add(signature);
      const selected = await page.evaluate(`(${selectCssEvidence})(${JSON.stringify({ text, source: source.slice(0, 2048), height: c.height, maxRules: 50000 - metrics.css_rules })})`) as {
        variables: Record<string, string>; breakpoints: string[]; evidence: { name: string }[]; inspected: number; omitted: number;
      };
      metrics.css_rules += selected.inspected;
      metrics.css_omitted += selected.omitted;
      for (const [key, value] of Object.entries(selected.variables)) {
        if (Object.keys(variables).length < 120 || key in variables) {
          variables[key] = value;
          cssEvidence[key] = selected.evidence.find(item => item.name === key);
        }
        else metrics.css_omitted++;
      }
      for (const bp of selected.breakpoints) if (breakpoints.size < 40) breakpoints.add(bp);
    }
    stage("extraction");
    const data = await page.evaluate(`(() => { const result = (${extractionScript})(${JSON.stringify({ maxElements: c.elements, maxHeight: c.height, skipStylesheets: true })});
      if (JSON.stringify(result).length > 200000) throw new Error('evidence-limit'); return result; })()`) as Record<string, unknown>;
    data.cssVariables = variables;
    data.cssEvidence = Object.values(cssEvidence);
    data.breakpoints = [...breakpoints];
    data.token_candidates = classifyVariables(variables);
    if (screenshot.byteLength > c.screenshotBytes)
      throw new ApiError("SCREENSHOT_TOO_LARGE", "The screenshot exceeded the configured byte limit.", 413);
    await Promise.all(audits);
    if (fatal) throw fatal;
    await checkFailedScripts();
    data.capture = {
      height_truncated: sectionResult.documentHeight > c.height, region_height: sectionResult.height,
      composition_attempts: sectionResult.attempts,
      blocked_subresources: Object.entries(metrics.blocked).filter(([key]) => !["media", "eventsource", "websocket", "prefetch"].includes(key)).reduce((sum, [, n]) => sum + n, 0),
      media_policy: "static-branding",
      excluded_media_resources: metrics.blocked.media || 0,
      excluded_prefetch_resources: metrics.blocked.prefetch || 0,
      excluded_streaming_resources: (metrics.blocked.eventsource || 0) + (metrics.blocked.websocket || 0),
      request_limit_reached: false, fonts_loaded: readiness.fontsLoaded,
      external_stylesheets_inspected: metrics.css_sheets, css_evidence_omitted: metrics.css_omitted,
      outside_region_images: readiness.outside, animations_disabled: true, method: "viewport-sections", section_count: sectionResult.tiles.length,
      overlay_policy: "sticky-in-flow-fixed-once",
      missing_background_images_count: missingBackgrounds.length,
      missing_background_images: missingBackgrounds.slice(0, 16).map(raw => {
        const resource = new URL(raw);
        return { url: `${resource.origin}${resource.pathname}`.slice(0, 2048), status: 404 };
      }),
      missing_background_images_omitted: Math.max(0, missingBackgrounds.length - 16),
      failed_async_scripts_count: failedScripts.size,
      failed_async_scripts: [...failedScripts.values()].slice(0, 16),
      failed_async_scripts_omitted: Math.max(0, failedScripts.size - 16),
    };
    if (JSON.stringify(data).length > 200000)
      throw new ApiError("SCRAPE_EVIDENCE_LIMIT", "The page evidence exceeded the capture limit.", 422);
    return { screenshot: Buffer.from(screenshot).toString("base64"), data, metrics };
  } catch (error) {
    if (error instanceof SectionLayoutError) metrics.composition_failure = error.geometry;
    // Preserve the first fatal cause even if teardown or the outer deadline races.
    const failure = fatal || (signal.aborted || (error instanceof Error && error.name === "TimeoutError")
      ? new ApiError("SCRAPE_TIMEOUT", "A source website took too long to load.", 504, true)
      : error instanceof ApiError ? error : new ApiError("SCRAPE_FAILED", "A source website could not be captured.", 502, true));
    failure.captureMetrics = metrics;
    throw failure;
  } finally {
    signal.removeEventListener("abort", abort);
    resources?.cancel?.();
    metrics.external_hosts = hosts.size;
    metrics.stage_ms[metrics.stage] = (metrics.stage_ms[metrics.stage] || 0) + Date.now() - stageStart;
    metrics.routes.pending_at_close = activeRoutes;
    const cleanupStart = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!abortClosing) close();
      await Promise.race([Promise.all([abortClosing || closing, resources?.close?.()]), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ApiError("BROWSER_CLOSE_FAILED", "Browser context cleanup could not be confirmed.", 503, true)), 5000);
      })]);
      metrics.close_confirmed = true;
    } catch (error) {
      if (error instanceof ApiError) error.captureMetrics = metrics;
      throw error;
    } finally {
      clearTimeout(timer);
      metrics.stage_ms.close = Date.now() - cleanupStart;
      metrics.browser_wall_ms = Date.now() - started;
      metrics.transport = resources?.transport;
      metrics.dns_requests = resources?.transport
        ? resources.transport.invocations.reduce((sum, invocation) => sum + invocation.dns_requests, 0)
        : network.metrics?.dns_requests ?? null;
      metrics.resource_downloads = resources?.metrics?.downloads ?? null;
      metrics.resource_bytes_received = resources?.metrics?.bytes_received ?? null;
      metrics.resource_bytes_completed = resources?.metrics?.bytes_completed ?? null;
    }
  }
}
