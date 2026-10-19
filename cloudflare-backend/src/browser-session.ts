import type {
  Browser,
  BrowserWorker,
  WorkersLaunchOptions,
} from "@cloudflare/playwright";
import { ApiError } from "./errors";
export type Launcher = (
  binding: BrowserWorker,
  options: WorkersLaunchOptions,
) => Promise<Browser>;
/** Bounds acquisition and teardown as well as page navigation. Never holds a browser across AI retries. */
export async function withBrowser<T>(
  binding: BrowserWorker,
  signal: AbortSignal,
  work: (browser: Browser) => Promise<T>,
  launcher?: Launcher,
): Promise<T> {
  const started = Date.now();
  let failure: ApiError | undefined;
  signal.throwIfAborted();
  const launch = launcher || (await import("@cloudflare/playwright")).launch;
  // Bound acquisition without letting a later capture timeout sever the
  // upgraded WebSocket before Browser.close can reach the remote browser.
  const acquisition = new AbortController();
  const abortAcquisition = () => acquisition.abort(signal.reason);
  signal.addEventListener("abort", abortAcquisition, { once: true });
  if (signal.aborted) abortAcquisition();
  const boundedBinding: BrowserWorker = {
    fetch: (input, init) =>
      binding.fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([acquisition.signal, init.signal]) : acquisition.signal,
      }),
  };
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (browser) closing ||= browser.close();
    closing?.catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    browser = await launch(boundedBinding, { keep_alive: 10000 });
    signal.removeEventListener("abort", abortAcquisition);
    signal.throwIfAborted();
    return await work(browser);
  } catch (e) {
    if (e instanceof ApiError) failure = e;
    else if (signal.aborted)
      failure = new ApiError(
        "SCRAPE_TIMEOUT",
        "A source website took too long to load.",
        504,
        true,
      );
    else if (e instanceof Error && /code: 429\b/.test(e.message))
      failure = new ApiError(
        "BROWSER_QUOTA_EXHAUSTED",
        "Cloudflare Browser Run is temporarily rate limited or its quota is exhausted.",
        429,
        true,
        60,
      );
    else failure = new ApiError(
      "SCRAPE_FAILED",
      "A source website could not be captured.",
      502,
      true,
    );
    throw failure;
  } finally {
    signal.removeEventListener("abort", abortAcquisition);
    signal.removeEventListener("abort", close);
    close();
    if (closing) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closing,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new ApiError(
                    "BROWSER_CLOSE_FAILED",
                    "Browser cleanup could not be confirmed.",
                    503,
                    true,
                  ),
                ),
              5000,
            );
          }),
        ]);
        // Failed work with confirmed teardown has measurable usage. If launch
        // or cleanup is uncertain, omit it and retain the quota reservation.
        if (failure && failure.code !== "BROWSER_CLOSE_FAILED") failure.browserMs = Date.now() - started;
      } catch {
        throw new ApiError(
          "BROWSER_CLOSE_FAILED",
          "Browser cleanup could not be confirmed.",
          503,
          true,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
