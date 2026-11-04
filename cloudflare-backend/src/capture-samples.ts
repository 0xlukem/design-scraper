import type { Page } from '@cloudflare/playwright';
import { Buffer } from 'node:buffer';
import type { Config } from './config';
import { ApiError } from './errors';
import { measurementProperties } from './domain/measurement-script';
import { extractionScript } from './domain/extraction-script';
import { mergeSampleData, type CaptureSample, type RejectedSample, type SampleProgress } from './capture-evidence';

const recoverable = new Set(['CAPTURE_INCOMPLETE', 'CAPTURE_SAMPLE_UNSTABLE', 'CAPTURE_SAMPLE_UNAVAILABLE']);

/** Independent photographs: only the photographed viewport must stay coherent.
 * No normalization/hiding of page content, global height lock or site selectors. */
export async function captureSamples(page: Page, c: Config, deadline: number, started: number,
  ready: (remainingMs: number) => Promise<void>, assertHealthy: () => void,
  checkpoints: { validate?: () => Promise<void>; accepted?: () => void; progress?: (value: SampleProgress) => void } = {}) {
  const samples: CaptureSample[] = [];
  const rejected: RejectedSample[] = [];
  let bytes = 0;
  let inspected = 0;
  let documentHeight = 0;
  let sampleAttempts = 0;
  let dialogBlockedAttempts = 0;
  let firstUsefulMs: number | null = null;
  const report = () => checkpoints.progress?.({ accepted: samples.length, rejected: [...rejected], first_useful_ms: firstUsefulMs });
  const reject = (anchor: string, code: string, reason?: string) => { rejected.push({ anchor, code, ...(reason ? { reason } : {}) }); report(); };
  report();
  const remaining = (until = deadline) => {
    assertHealthy();
    const ms = until - Date.now();
    if (ms <= 0) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'The sample time budget was exhausted.', 422, true);
    return ms;
  };
  // Wait for observable content, including delayed hydration, before fixing the
  // bounded element set. Neither network silence nor a loading heading suffices.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  let contextReady = true;
  try {
    await page.waitForFunction(limit => {
      const visible = (element: Element) => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight &&
          element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      };
      if (document.querySelector('dialog:modal') || [...document.querySelectorAll('[aria-modal="true"]')].some(visible)) return true;
      return [...document.querySelectorAll('h1,h2,h3,p,li,a,button,[role="heading"]')].slice(0, limit).some(element =>
        visible(element) && !element.closest('[aria-busy="true"],[role="progressbar"]') &&
        (element.textContent || '').trim().length >= 12 && !/^(?:loading|please wait|cargando)[.\s…]*$/i.test((element.textContent || '').trim()));
    }, c.elements, { timeout: Math.min(3000, remaining()) });
  } catch (error) {
    assertHealthy();
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    contextReady = false;
  }
  // Anchor selection is bounded. Each attempt binds its own current node set
  // after resources settle, before extracting any measurements or photograph.
  const state = await page.evaluateHandle(({ limit, maxHeight, properties }) => {
    const selector = (element: Element) => {
      const path: string[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const peers = node.parentElement ? [...node.parentElement.children].filter(e => e.tagName === node!.tagName) : [node];
        path.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(node) + 1})`);
        if (path.length > 64 || path.join(' > ').length > 1600) return null;
      }
      return path.join(' > ');
    };
    const collect = () => {
      const nodes: Element[] = [];
      // Metadata and SVG path trees must not exhaust the content allowance
      // before any visible heading is reached. Their pixels remain in the image.
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          return (node as Element).matches('head,script,style,link,meta,template,noscript,svg,canvas,iframe')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      while (nodes.length < limit && walker.nextNode()) nodes.push(walker.currentNode as Element);
      return nodes;
    };
    // Only search below the fold after the initial viewport has failed.
    const positionFallback = () => {
      const nodes = collect();
      const candidates = new Map<number, { element: Element; y: number }>();
      const unloaded: { top: number; bottom: number }[] = [];
      const maxScroll = Math.max(0, Math.min(maxHeight, document.documentElement.scrollHeight) - innerHeight);
      for (const element of nodes) {
        const image = element instanceof HTMLImageElement;
        if (image ? element.complete && element.naturalWidth > 0 :
          !element.matches('h1,h2,h3,[role="heading"],button,input:not([type="hidden"]),a[href],article,[class~="card"],p,li,section,main')) continue;
        const box = element.getBoundingClientRect();
        const y = box.top + scrollY;
        if (box.width <= 0 || box.height <= 0 || box.right <= 0 || box.left >= innerWidth || y >= maxHeight ||
          !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        if (image) {
          unloaded.push({ top: y, bottom: box.bottom + scrollY });
        } else if (y >= 800) {
          // Consider a bounded set of distinct screens, keeping the deepest anchor in each band.
          const band = Math.floor(y / (innerHeight / 2));
          if (y > (candidates.get(band)?.y ?? 0)) candidates.set(band, { element, y });
        }
      }
      let best: Element | undefined;
      let top = 0, bestY = 0, leastPending = Infinity;
      for (const { element, y } of candidates.values()) {
        const target = Math.max(0, Math.min(maxScroll, y - innerHeight / 3));
        const pending = unloaded.filter(box => box.bottom > target && box.top < target + innerHeight).length;
        if (pending < leastPending || (pending === leastPending && y > bestY)) {
          best = element; bestY = y; top = target; leastPending = pending;
        }
      }
      // Readiness is checked again at the real scroll position, including newly lazy-loaded images.
      window.scrollTo({ top, left: 0, behavior: 'instant' });
      return best ? selector(best) ?? 'optional-region-1' : 'context';
    };
    // Compare observations inside Chromium. Only the revision number crosses the
    // protocol, even when thousands of elements inherit a very long CSS value.
    let previousRows: (Element | string | number)[][] = [];
    let revision = 0;
    let observedModal: Element | null = null;
    type DialogDiagnostic = { viewportPercent: number; nativeModal: boolean; dialogHits: number; outsideMainHits: number };
    type Snapshot = { revision: number; useful: boolean; blocked: string | null;
      visibleCount: number; textLength: number; documentHeight: number; region: { x: number; y: number; width: number; height: number };
      viewport: { width: number; height: number } };
    const visible = (element: Element) => {
      if (!element.isConnected) return false;
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.left >= innerWidth ||
        r.bottom <= 0 || r.top >= innerHeight || r.top + scrollY >= maxHeight) return false;
      const css = getComputedStyle(element);
      if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0' ||
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const x = Math.max(0, Math.min(innerWidth - 1, (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2));
      const top = document.elementFromPoint(x, y);
      return top !== null && (element === top || element.contains(top));
    };
    // A native modal makes the document behind it inert even when a pointer hit misses the dialog.
    const findModal = () => document.querySelector('dialog:modal') ??
      [...document.querySelectorAll('[aria-modal="true"]')].slice(0, 16).find(visible);
    const nextObservation = (until: number) => new Promise<void>(resolve =>
      setTimeout(resolve, Math.min(100, Math.max(0, until - Date.now()))));
    const snapshot = (): Snapshot => {
    const shown = binding.elements.filter(visible);
    binding.visibleElements = shown;
    const challenge = /^(?:just a moment|access denied|verify (?:that )?you are human|checking your browser)(?:[.\s…]|$)/i.test(document.title.trim());
    const modal = findModal();
    observedModal = modal ?? null;
    const busy = shown.some(element => {
        const r = element.getBoundingClientRect();
        return element.matches('[aria-busy="true"],[role="progressbar"]') && r.width * r.height >= innerWidth * innerHeight / 2;
      });
    const textNodes = shown.filter(element => element.matches('h1,h2,h3,h4,h5,h6,p,li,a,button,[role="heading"]') && !element.closest('[aria-busy="true"],[role="progressbar"]'));
    const text = textNodes.map(element => (element.textContent || '').trim())
      .filter(value => !/^(?:loading|please wait|cargando)[.\s…]*$/i.test(value)).join(' ');
    const rows = shown.map(element => {
      const r = element.getBoundingClientRect(), css = getComputedStyle(element);
      // Clip geometry to the photograph, but compare every measured CSS property.
      return [element, Math.max(0, r.left), Math.max(0, r.top), Math.min(innerWidth, r.right), Math.min(innerHeight, r.bottom),
        ...properties.map(property => css[property]), css.borderColor, css.borderStyle, element.matches('h1,h2,h3,h4,h5,h6,p,li,a,button') ? (element.textContent || '').slice(0, 120) : ''];
    });
    const body = getComputedStyle(document.body);
    rows.push([innerWidth, innerHeight, Number(challenge), Number(Boolean(modal)), Number(busy),
      body.color, body.backgroundColor, body.fontFamily, body.fontSize, body.lineHeight, body.margin, body.padding]);
    if (rows.length !== previousRows.length || rows.some((row, index) =>
      row.some((value, column) => value !== previousRows[index][column]))) revision++;
    previousRows = rows;
    return { revision, useful: !challenge && !modal && !busy && text.replace(/\s+/g, ' ').trim().length >= 20,
      blocked: challenge ? 'challenge' : modal ? 'modal' : busy ? 'loading' : null, visibleCount: shown.length, textLength: text.length,
      documentHeight: document.documentElement.scrollHeight,
      region: { x: 0, y: scrollY, width: innerWidth, height: Math.min(innerHeight, maxHeight - scrollY) },
      viewport: { width: innerWidth, height: innerHeight } };
    };
    const binding = { elements: [] as Element[], visibleElements: [] as Element[], positionFallback, paused: [] as Animation[],
      snapshot,
      // Run the short stability loop inside Chromium. Remote protocol latency
      // must not multiply every 100 ms observation into another network trip.
      prepare: async (settleMs: number): Promise<Snapshot & { stable: boolean; waitedForDialog: boolean; dialog: DialogDiagnostic | null }> => {
        const until = Date.now() + settleMs;
        let modal = findModal();
        const waitedForDialog = Boolean(modal);
        // Leave the page untouched while a dialog may be running its own exit animation.
        while (modal && Date.now() < until) {
          await nextObservation(until);
          modal = findModal();
        }
        binding.elements = collect();
        if (!modal) {
          for (const animation of document.getAnimations()) {
            const element = (animation.effect as KeyframeEffect | null)?.target;
            if (!(element instanceof Element) || animation.playState !== 'running') continue;
            const r = element.getBoundingClientRect();
            if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
            binding.paused.push(animation); animation.pause();
          }
        }
        let previous = snapshot(), stableAt = Date.now();
        while (Date.now() - stableAt < 300 && Date.now() < until) {
          await nextObservation(until);
          const next = snapshot();
          if (next.revision !== previous.revision) stableAt = Date.now();
          previous = next;
        }
        let dialog: DialogDiagnostic | null = null;
        if (previous.blocked === 'modal' && observedModal) {
          const box = observedModal.getBoundingClientRect();
          const width = Math.max(0, Math.min(innerWidth, box.right) - Math.max(0, box.left));
          const height = Math.max(0, Math.min(innerHeight, box.bottom) - Math.max(0, box.top));
          const viewportPercent = Math.round(1000 * width * height / (innerWidth * innerHeight)) / 10;
          let dialogHits = 0, outsideMainHits = 0;
          // Diagnostic only: hit tests do not establish which pixels a backdrop paints.
          for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
            const hit = document.elementFromPoint((column + 0.5) * innerWidth / 3, (row + 0.5) * innerHeight / 3);
            if (hit && observedModal.contains(hit)) dialogHits++;
            else if (hit?.closest('main,article,[role="main"]') && !hit.closest('dialog,[aria-modal="true"],iframe')) outsideMainHits++;
          }
          dialog = { viewportPercent, nativeModal: observedModal.matches(':modal'), dialogHits, outsideMainHits };
        }
        return { ...previous, stable: Date.now() - stableAt >= 300, waitedForDialog, dialog };
      },
    };
    return binding;
  }, { limit: c.elements, maxHeight: c.height, properties: measurementProperties });
  type ExtractSample = (options: { maxElements: number; maxHeight: number; skipStylesheets: boolean; sampleElements: Element[] }) => Record<string, unknown>;
  const extract = await page.evaluateHandle<ExtractSample>(`(${extractionScript})`);
  try {
    for (let index = 0; index < 2; index++) {
      if (index > 0 && (Date.now() - started >= 45000 || deadline - Date.now() < 2000 || inspected >= c.elements)) break;
      sampleAttempts++;
      if (index === 0 && !contextReady) {
        reject('context', 'CAPTURE_SAMPLE_UNAVAILABLE', 'The initial viewport did not render usable content within the readiness budget.');
        continue;
      }
      const until = Math.min(deadline, Date.now() + (index === 0 ? 20000 : 8000));
      const anchor = index === 0 ? 'context' : await page.evaluate(state => state.positionFallback(), state);
      try {
        await ready(Math.max(1, remaining(until) - 2000));
        const read = () => page.evaluate(state => state.snapshot(), state);
        const previous = await page.evaluate(({ state, settleMs }) => state.prepare(settleMs),
          { state, settleMs: Math.min(1500, remaining(until)) });
        if (previous.region.y < 0 || previous.region.y + previous.viewport.height > c.height) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'The viewport moved beyond the capture region.', 422, true);
        if (previous.blocked === 'modal' && previous.dialog) {
          assertHealthy();
          dialogBlockedAttempts++;
          const { viewportPercent, nativeModal, dialogHits, outsideMainHits } = previous.dialog;
          reject(index === 0 ? 'context' : `optional-region-${index}`, 'CAPTURE_SAMPLE_UNAVAILABLE',
            `Dialog box intersects ${viewportPercent}% of viewport; native modal: ${nativeModal}; 3x3 hit test: ${dialogHits}/9 dialog, ${outsideMainHits}/9 main/article outside dialog.`);
          continue;
        }
        if (!previous.useful) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', previous.blocked
          ? `The sample is obscured by ${previous.blocked} content.`
          : `The sample has insufficient unobstructed content (${previous.visibleCount} visible nodes, ${previous.textLength} text characters).`, 422, true);
        if (!previous.stable && previous.waitedForDialog)
          throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'The page did not stabilize after the dialog cleared within the sample time budget.', 422, true);
        if (!previous.stable) throw new ApiError('CAPTURE_SAMPLE_UNSTABLE', 'The photographed content did not stabilize.', 422, true);
        if (previous.viewport.width !== 1440 || previous.viewport.height !== 900)
          throw new ApiError('CAPTURE_COMPOSITION_FAILED', 'The capture viewport changed.', 502, true);
        const data = await page.evaluate(({ state, extract, revision, maxElements, maxHeight }) => {
          if (state.snapshot().revision !== revision) return 'changed';
          const evidence = extract({ maxElements, maxHeight, skipStylesheets: true, sampleElements: state.visibleElements });
          return JSON.stringify(evidence).length > 200000 ? null : evidence;
        }, { state, extract, revision: previous.revision, maxElements: c.elements - inspected, maxHeight: c.height });
        if (data === 'changed') throw new ApiError('CAPTURE_SAMPLE_UNSTABLE', 'The photographed content changed before measurement.', 422, true);
        if (!data) throw new ApiError('SCRAPE_EVIDENCE_LIMIT', 'The page evidence exceeded the capture limit.', 422);
        inspected += Number((data.extraction as { inspectedElements: number }).inspectedElements);
        const photograph = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false,
          animations: 'allow', timeout: Math.min(5000, remaining(until)) });
        bytes += photograph.byteLength;
        if (bytes > c.screenshotBytes) throw new ApiError('SCREENSHOT_TOO_LARGE', 'The aggregate sample image budget was exceeded.', 413);
        remaining(until);
        const after = await read();
        if (after.revision !== previous.revision) throw new ApiError('CAPTURE_SAMPLE_UNSTABLE', 'The photographed content changed during capture.', 422, true);
        if (after.region.y < 0 || after.region.y + after.viewport.height > c.height)
          throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'The viewport moved beyond the capture region.', 422, true);
        const measurementCount = (data.measurements as { samples: unknown[] }).samples.length;
        if (!measurementCount) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'No corresponding element measurements were captured.', 422, true);
        // Seal this image/measurement pair only after auditing events that
        // arrived during the photograph.
        await checkpoints.validate?.();
        remaining(until);
        const validated = await read();
        if (validated.revision !== after.revision)
          throw new ApiError('CAPTURE_SAMPLE_UNSTABLE', 'The photographed content changed during resource validation.', 422, true);
        documentHeight = validated.documentHeight;
        samples.push({ id: 'sample-1', anchor, sequence: index + 1, image: Buffer.from(photograph).toString('base64'),
          viewport: previous.viewport, region: previous.region, scroll_y_after: after.region.y, bytes: photograph.byteLength, data });
        firstUsefulMs ??= Date.now() - started;
        checkpoints.accepted?.(); report();
        break;
      } catch (error) {
        assertHealthy(); // Never downgrade a safety, resource, or outer deadline failure.
        if (error instanceof Error && error.name === 'TimeoutError') {
          reject(anchor, 'CAPTURE_SAMPLE_UNAVAILABLE', 'The sample operation timed out.'); continue;
        }
        if (!(error instanceof ApiError) || !recoverable.has(error.code)) throw error;
        reject(anchor, error.code, error.message.slice(0, 200));
      } finally {
        await page.evaluate(state => {
          for (const animation of state.paused) if (animation.playState === 'paused') animation.play();
          state.paused = [];
        }, state).catch(() => {}); // Context teardown may already be in progress.
      }
    }
    if (!samples.length) {
      if (sampleAttempts > 0 && dialogBlockedAttempts === sampleAttempts)
        throw new ApiError('CAPTURE_EVIDENCE_INSUFFICIENT', 'A dialog blocked every attempted sample. Try another publicly accessible page.', 422);
      throw new ApiError('CAPTURE_EVIDENCE_INSUFFICIENT', 'No coherent visual sample and corresponding design measurements were captured.', 422, true);
    }
    const quality = rejected.length || documentHeight > samples[0].region.height ? 'partial' : 'sufficient';
    const data = mergeSampleData(samples, c.elements);
    // Include work spent on rejected attempts in the shared inspection allowance.
    data.extraction = { ...(data.extraction as object), inspectedElements: inspected,
      truncated: inspected >= c.elements || Boolean((data.extraction as { truncated?: boolean }).truncated) };
    return { samples, rejected, quality, firstUsefulMs, documentHeight, data };
  } finally {
    await Promise.all([state.dispose(), extract.dispose()]);
  }
}
