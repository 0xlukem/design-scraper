/** Published limits checked 2026-09-09. Inputs must come from remote runs, never local wall time as CPU. */
export interface FreeMeasurements {
  entry_cpu_ms: number | null;
  analysis_do_cpu_ms: number | null;
  quota_do_cpu_ms: number | null;
  analysis_subrequests: number | null;
  browser_session_ms: number | null;
  durable_object_wall_ms: number | null;
  compressed_bundle_bytes: number;
}
export function evaluateFreeGate(m: FreeMeasurements) {
  const limits = {
    entry_cpu_ms: 10,
    analysis_do_cpu_ms: 30000,
    quota_do_cpu_ms: 30000,
    analysis_subrequests: 50,
    compressed_bundle_bytes: 3 * 1024 * 1024,
  };
  const failures: string[] = [];
  const missing: string[] = [];
  for (const [key, max] of Object.entries(limits)) {
    const value = m[key as keyof FreeMeasurements];
    if (value === null || !Number.isFinite(value) || value < 0)
      missing.push(key);
    else if (value > max) failures.push(key);
  }
  for (const key of ["browser_session_ms", "durable_object_wall_ms"] as const) {
    if (m[key] === null || !Number.isFinite(m[key]) || m[key]! <= 0)
      missing.push(key);
  }
  if (m.browser_session_ms !== null && m.browser_session_ms > 480000)
    failures.push("browser_daily_budget");
  return {
    decision: failures.length
      ? "fail"
      : missing.length
        ? "needs-remote-measurement"
        : "pass",
    failures,
    missing,
    browser_limited_runs_per_day:
      m.browser_session_ms && m.browser_session_ms > 0
        ? Math.floor(480000 / m.browser_session_ms)
        : null,
    do_duration_limited_runs_per_day:
      m.durable_object_wall_ms && m.durable_object_wall_ms > 0
        ? Math.floor(13000 / ((m.durable_object_wall_ms / 1000) * 0.128))
        : null,
    note: "Capacity projections require representative repeated runs (p95), account-wide usage and the configured daily/IP/token quotas. One successful run is not a public-capacity guarantee.",
  };
}
