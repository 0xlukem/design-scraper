export class ApiError extends Error {
  captureMetrics?: import("./capture").CaptureMetrics;
  browserMs?: number;
  budgetTokens?: number;
  budgetMicroUsd?: number;
  diagnostic?: string;
  constructor(
    public code: string,
    message: string,
    public status = 502,
    public retryable = false,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown): Response {
  const e =
    error instanceof ApiError
      ? error
      : new ApiError(
          "INTERNAL_ERROR",
          "The analysis could not be completed.",
          500,
          true,
        );
  return Response.json(
    { detail: { code: e.code, message: e.message, retryable: e.retryable } },
    {
      status: e.status,
      headers: {
        "cache-control": "no-store",
        ...(e.retryAfter
          ? { "retry-after": String(Math.ceil(e.retryAfter)) }
          : {}),
      },
    },
  );
}
export async function boundedText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new ApiError(
      "RESPONSE_TOO_LARGE",
      "A response exceeded the size limit.",
      413,
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(
          "RESPONSE_TOO_LARGE",
          "A response exceeded the size limit.",
          413,
        );
      }
      chunks.push(value);
    }
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let i = 0;
  for (const chunk of chunks) {
    result.set(chunk, i);
    i += chunk.length;
  }
  return new TextDecoder().decode(result);
}
export async function sleep(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
