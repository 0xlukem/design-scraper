import type { Page } from '@cloudflare/playwright';
import { Buffer } from 'node:buffer';
import type { Config } from './config';
import { ApiError } from './errors';
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
  try {
    await page.waitForFunction(limit => {
      const visible = (element: Element) => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight &&
          element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      };
      if ([...document.querySelectorAll('[aria-modal="true"]')].some(visible)) return true;
      return [...document.querySelectorAll('h1,h2,h3,p,li,a,button,[role="heading"]')].slice(0, limit).some(element =>
        visible(element) && !element.closest('[aria-busy="true"],[role="progressbar"]') &&
        (element.textContent || '').trim().length >= 12 && !/^(?:loading|please wait|cargando)[.\s…]*$/i.test((element.textContent || '').trim()));
    }, c.elements, { timeout: Math.min(3000, remaining()) });
  } catch (error) {
    assertHealthy();
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    throw new ApiError('CAPTURE_EVIDENCE_INSUFFICIENT', 'The page did not render usable content within the readiness budget.', 422, true);
  }
  // Anchor selection is bounded. Each attempt binds its own current node set
  // after resources settle, before extracting any measurements or photograph.
  const state = await page.evaluateHandle(({ limit, maxHeight }) => {
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
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      while (nodes.length < limit && walker.nextNode()) nodes.push(walker.currentNode as Element);
      return nodes;
    };
    const elements = collect();
    const kinds: [string, string][] = [['heading', 'h1,h2,h3,[role="heading"]'], ['control', 'button,input:not([type="hidden"]),a[href]'],
      ['card', 'article,[class~="card"]'], ['content', 'p,li,section,main']];
    const candidates = elements.flatMap(element => {
      const box = element.getBoundingClientRect();
      const y = box.top + scrollY;
      const kind = kinds.find(([, query]) => element.matches(query))?.[0];
      const css = getComputedStyle(element);
      if (!kind || box.width <= 0 || box.height <= 0 || y < 800 || y >= maxHeight ||
        css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return [];
      const anchor = selector(element);
      return anchor && anchor.length <= 1600 ? [{ element, anchor, kind, y }] : [];
    });
    const anchors: typeof candidates = [];
    const covered: number[] = [0];
    const kindsUsed = new Set<string>();
    for (let index = 0; index < 2; index++) {
      const ranked = candidates.filter(candidate => !anchors.includes(candidate) && covered.every(y => Math.abs(candidate.y - y) >= 650))
        .sort((a, b) => {
          const score = (candidate: typeof a) => (kindsUsed.has(candidate.kind) ? 0 : 500) + Math.min(...covered.map(y => Math.abs(candidate.y - y)));
          return score(b) - score(a) || a.y - b.y;
        });
      if (!ranked.length) break;
      anchors.push(ranked[0]); covered.push(ranked[0].y); kindsUsed.add(ranked[0].kind);
    }
    const located: Element[] = [], selectors: string[] = [];
    for (const element of elements) {
      const path = selector(element);
      if (path) { located.push(element); selectors.push(path); }
    }
    const binding = { elements: located, selectors, anchors, documentHeight: document.documentElement.scrollHeight, paused: [] as Animation[],
      refresh: (): void => {
        const current = collect();
        binding.elements = []; binding.selectors = [];
        for (const element of current) {
          const path = selector(element);
          if (path) { binding.elements.push(element); binding.selectors.push(path); }
        }
      },
    };
    return binding;
  }, { limit: c.elements, maxHeight: c.height });
  try {
    const info = await page.evaluate(state => ({ anchors: state.anchors.map(a => a.anchor), documentHeight: state.documentHeight }), state);
    for (const [index, anchor] of ['context', ...info.anchors].entries()) {
      if (index > 0 && (Date.now() - started >= 45000 || deadline - Date.now() < 2000 || inspected >= c.elements)) {
        reject(anchor, 'CAPTURE_SAMPLE_UNAVAILABLE', 'The shared capture allowance cannot admit another sample.'); continue;
      }
      const until = Math.min(deadline, Date.now() + (index === 0 ? 20000 : 8000));
      let accepted = false;
      for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
        try {
          remaining(until);
          const positioned = await page.evaluate(({ state, index, maxHeight }) => {
            let element = index ? state.anchors[index - 1]?.element : null;
            if (index && !element?.isConnected) {
              element = document.querySelector(state.anchors[index - 1].anchor);
              if (!element) return false;
              state.anchors[index - 1].element = element;
            }
            const anchorY = element ? element.getBoundingClientRect().top + scrollY : 0;
            if (anchorY < 0 || anchorY >= maxHeight) return false;
            // Include the context around a selected control/card, not only the
            // blank space below it. Resolve its live location after every scroll.
            const target = element ? Math.max(0, anchorY - innerHeight / 3) : 0;
            window.scrollTo({ top: Math.min(target, Math.max(0, maxHeight - innerHeight)), left: 0, behavior: 'instant' });
            return true;
          }, { state, index, maxHeight: c.height });
          if (!positioned) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'The selected content is no longer in the capture region.', 422, true);
          await ready(Math.max(1, remaining(until) - 2000));
          await page.evaluate(state => state.refresh(), state);
          await page.evaluate(state => {
            for (const animation of document.getAnimations()) {
              const element = (animation.effect as KeyframeEffect | null)?.target;
              if (!(element instanceof Element) || animation.playState !== 'running') continue;
              const r = element.getBoundingClientRect();
              if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
              state.paused.push(animation); animation.pause();
            }
          }, state);
          const read = () => page.evaluate(({ state, maxHeight }) => {
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
            const shown = state.elements.map((element, i) => ({ element, selector: state.selectors[i] })).filter(({ element }) => visible(element));
            const challenge = /^(?:just a moment|access denied|verify (?:that )?you are human|checking your browser)(?:[.\s…]|$)/i.test(document.title.trim());
            const modal = [...document.querySelectorAll('[aria-modal="true"]')].slice(0, 16).some(visible);
            const busy = shown.some(({ element }) => {
                const r = element.getBoundingClientRect();
                return element.matches('[aria-busy="true"],[role="progressbar"]') && r.width * r.height >= innerWidth * innerHeight / 2;
              });
            const textNodes = shown.filter(({ element }) => element.matches('h1,h2,h3,h4,h5,h6,p,li,a,button,[role="heading"]') && !element.closest('[aria-busy="true"],[role="progressbar"]'));
            const text = textNodes.map(({ element }) => (element.textContent || '').trim()).join(' ');
            const fingerprint = shown.map(({ element, selector }) => {
              const r = element.getBoundingClientRect(), css = getComputedStyle(element);
              // Clip geometry to this photograph: movement outside it is irrelevant.
              return [selector, Math.max(0, r.left), Math.max(0, r.top), Math.min(innerWidth, r.right), Math.min(innerHeight, r.bottom),
                css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight, css.color, css.backgroundColor,
                css.border, css.borderRadius, css.padding, css.boxShadow, element.matches('h1,h2,h3,h4,h5,h6,p,li,a,button') ? (element.textContent || '').slice(0, 120) : ''];
            });
            return { signature: JSON.stringify([innerWidth, innerHeight, fingerprint]),
              selectors: shown.map(value => value.selector), useful: !challenge && !modal && !busy && text.replace(/\s+/g, ' ').trim().length >= 20,
              blocked: challenge ? 'challenge' : modal ? 'modal' : busy ? 'loading' : null, visibleCount: shown.length, textLength: text.length,
              region: { x: 0, y: scrollY, width: innerWidth, height: Math.min(innerHeight, maxHeight - scrollY) },
              viewport: { width: innerWidth, height: innerHeight } };
          }, { state, maxHeight: c.height });
          let previous = await read();
          const settleUntil = Math.min(until, Date.now() + 1500);
          let stableAt = Date.now();
          while (Date.now() - stableAt < 300 && Date.now() < settleUntil) {
            await page.waitForTimeout(Math.min(100, remaining(until)));
            const next = await read();
            if (next.signature !== previous.signature) stableAt = Date.now();
            previous = next;
          }
          if (previous.region.y < 0 || previous.region.y + previous.viewport.height > c.height) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'The viewport moved beyond the capture region.', 422, true);
          if (!previous.useful) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', previous.blocked
            ? `The sample is obscured by ${previous.blocked} content.`
            : `The sample has insufficient unobstructed content (${previous.visibleCount} visible nodes, ${previous.textLength} text characters).`, 422, true);
          if (Date.now() - stableAt < 300) throw new ApiError('CAPTURE_SAMPLE_UNSTABLE', 'The photographed content did not stabilize.', 422, true);
          if (previous.viewport.width !== 1440 || previous.viewport.height !== 900)
            throw new ApiError('CAPTURE_COMPOSITION_FAILED', 'The capture viewport changed.', 502, true);
          const data = await page.evaluate(`(${extractionScript})(${JSON.stringify({ maxElements: c.elements - inspected,
            maxHeight: c.height, skipStylesheets: true, sampleSelectors: previous.selectors })})`) as Record<string, unknown>;
          inspected += Number((data.extraction as { inspectedElements: number }).inspectedElements);
          const photograph = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false,
            animations: 'allow', timeout: Math.min(5000, remaining(until)) });
          bytes += photograph.byteLength;
          if (bytes > c.screenshotBytes) throw new ApiError('SCREENSHOT_TOO_LARGE', 'The aggregate sample image budget was exceeded.', 413);
          remaining(until);
          const after = await read();
          if (after.signature !== previous.signature) throw new ApiError('CAPTURE_SAMPLE_UNSTABLE', 'The photographed content changed during capture.', 422, true);
          if (after.region.y < 0 || after.region.y + after.viewport.height > c.height)
            throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'The viewport moved beyond the capture region.', 422, true);
          const measurementCount = (data.measurements as { samples: unknown[] }).samples.length;
          if (!measurementCount) throw new ApiError('CAPTURE_SAMPLE_UNAVAILABLE', 'No corresponding element measurements were captured.', 422, true);
          // Seal this image/measurement pair only after auditing events that
          // arrived during the photograph. Later regions get their own checks.
          await checkpoints.validate?.();
          remaining(until);
          if ((await read()).signature !== after.signature)
            throw new ApiError('CAPTURE_SAMPLE_UNSTABLE', 'The photographed content changed during resource validation.', 422, true);
          samples.push({ id: `sample-${samples.length + 1}`, anchor, sequence: index + 1, image: Buffer.from(photograph).toString('base64'),
            viewport: previous.viewport, region: previous.region, scroll_y_after: after.region.y, bytes: photograph.byteLength, data });
          firstUsefulMs ??= Date.now() - started;
          checkpoints.accepted?.(); report();
          accepted = true;
        } catch (error) {
          assertHealthy(); // Never downgrade a safety, resource, or outer deadline failure.
          if (error instanceof Error && error.name === 'TimeoutError') {
            reject(anchor, 'CAPTURE_SAMPLE_UNAVAILABLE', 'The sample operation timed out.'); break;
          }
          if (!(error instanceof ApiError) || !recoverable.has(error.code)) throw error;
          if (attempt === 0 && error.code === 'CAPTURE_SAMPLE_UNSTABLE' && until - Date.now() >= 500) continue;
          reject(anchor, error.code, error.message.slice(0, 200)); break;
        } finally {
          await page.evaluate(state => {
            for (const animation of state.paused) if (animation.playState === 'paused') animation.play();
            state.paused = [];
          }, state).catch(() => {}); // Context teardown may already be in progress.
        }
      }
    }
    if (!samples.length) throw new ApiError('CAPTURE_EVIDENCE_INSUFFICIENT', 'No coherent visual sample and corresponding design measurements were captured.', 422, true);
    const quality = rejected.length || (info.documentHeight > 900 && samples.length < 2) ? 'partial' : 'sufficient';
    const data = mergeSampleData(samples, c.elements);
    // Include work spent on rejected attempts in the shared inspection allowance.
    data.extraction = { ...(data.extraction as object), inspectedElements: inspected,
      truncated: inspected >= c.elements || Boolean((data.extraction as { truncated?: boolean }).truncated) };
    return { samples, rejected, quality, firstUsefulMs, documentHeight: info.documentHeight, data };
  } finally {
    await state.dispose();
  }
}
