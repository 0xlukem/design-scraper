import { it, expect } from "vitest";
import { evaluateFreeGate } from "../src/free-gate";
const m = {
  entry_cpu_ms: 4,
  analysis_do_cpu_ms: 150,
  quota_do_cpu_ms: 3,
  analysis_subrequests: 20,
  browser_session_ms: 5000,
  durable_object_wall_ms: 50000,
  compressed_bundle_bytes: 750000,
};
it("applies the DO CPU allowance independently from the entry Worker", () =>
  expect(evaluateFreeGate(m).decision).toBe("pass"));
it("does not substitute local latency or browser timing for authoritative CPU", () =>
  expect(evaluateFreeGate({ ...m, entry_cpu_ms: null }).decision).toBe(
    "needs-remote-measurement",
  ));
it("fails Free if DNS/provider subrequests or entry CPU exceed its budget", () => {
  expect(evaluateFreeGate({ ...m, analysis_subrequests: 51 }).decision).toBe(
    "fail",
  );
  expect(evaluateFreeGate({ ...m, entry_cpu_ms: 11 }).decision).toBe("fail");
});
