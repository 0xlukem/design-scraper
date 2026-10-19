/** Gemini RPD resets at midnight America/Los_Angeles, including DST changes. */
export function geminiDailyRetrySeconds(now = Date.now()): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wall = (time: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(time).map((x) => [x.type, x.value]),
    );
    return {
      year: Number(p.year),
      month: Number(p.month),
      day: Number(p.day),
      hour: Number(p.hour),
      minute: Number(p.minute),
      second: Number(p.second),
    };
  };
  const today = wall(now);
  const midnight = Date.UTC(today.year, today.month - 1, today.day + 1);
  let target = midnight;
  for (let i = 0; i < 3; i++) {
    const local = wall(target);
    const localUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    target = midnight - (localUtc - target);
  }
  return Math.max(1, Math.ceil((target - now) / 1000));
}
export function isDailyGeminiQuota(payload: unknown): boolean {
  const details = (payload as { error?: { details?: unknown } })?.error
    ?.details;
  return (
    Array.isArray(details) &&
    details.some(
      (d) =>
        Array.isArray(d?.violations) &&
        d.violations.some(
          (v: { quotaId?: unknown }) =>
            typeof v?.quotaId === "string" && /PerDay/.test(v.quotaId),
        ),
    )
  );
}
