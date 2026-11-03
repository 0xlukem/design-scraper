/** Internal capture evidence. Images are request-local, never public API fields. */
export interface CaptureImage { id: string; image: string }
export interface CaptureSample extends CaptureImage {
  anchor: string;
  sequence: number;
  viewport: { width: number; height: number };
  region: { x: number; y: number; width: number; height: number };
  scroll_y_after: number;
  bytes: number;
  data: Record<string, unknown>;
}
export interface RejectedSample { anchor: string; code: string }
export type CaptureQuality = 'sufficient' | 'partial';
type Measurement = { id: string; kind: string; selector: string; styles: Record<string, string>; capture_sample?: string };
type Measurements = { samples?: Measurement[]; candidateCounts?: Record<string, number>; [key: string]: unknown };

/** Keep a single bounded measurement set, with provenance back to each image. */
export function mergeSampleData(samples: CaptureSample[], maxElements: number): Record<string, unknown> {
  const data = { ...samples[0].data };
  for (const [key, valueKey] of Object.entries({ colors: 'color', fonts: 'font', fontSizes: 'size', fontWeights: 'weight',
    lineHeights: 'lineHeight', letterSpacings: 'letterSpacing', spacing: 'space', borderRadius: 'radius', shadows: 'shadow' })) {
    const values = new Map<string, Record<string, unknown>>();
    for (const sample of samples) for (const value of (sample.data[key] || []) as Record<string, unknown>[]) {
      const name = String(value[valueKey]);
      const previous = values.get(name);
      values.set(name, { ...value, count: Math.max(Number(previous?.count || 0), Number(value.count || 0)) });
    }
    data[key] = [...values.values()].sort((a, b) => Number(b.count) - Number(a.count)).slice(0, 20);
  }
  const measurements: Measurement[] = [];
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  const candidateCounts: Record<string, number> = {};
  for (const sample of samples) {
    const captured = sample.data.measurements as Measurements | undefined;
    for (const [kind, count] of Object.entries(captured?.candidateCounts || {})) candidateCounts[kind] = Math.max(candidateCounts[kind] || 0, count);
  }
  // Round-robin preserves complementary frames when the context has many nodes.
  for (let index = 0; index < 24 && measurements.length < 24; index++) for (const sample of samples) {
    const measurement = (sample.data.measurements as Measurements | undefined)?.samples?.[index];
    if (!measurement) continue;
    const signature = JSON.stringify([measurement.selector, measurement.styles]);
    if (seen.has(signature) || measurements.length >= 24 || (counts[measurement.kind] || 0) >= 6) continue;
    seen.add(signature);
    counts[measurement.kind] = (counts[measurement.kind] || 0) + 1;
    measurements.push({ ...measurement, id: `${measurement.kind}-${counts[measurement.kind]}`, capture_sample: sample.id });
  }
  data.measurements = { ...(samples[0].data.measurements as Measurements), samples: measurements, candidateCounts,
    scope: 'Measured elements from identified independent viewport samples; not a continuous page or a responsive system.' };
  const inspected = samples.reduce((n, sample) => n + Number((sample.data.extraction as { inspectedElements?: number })?.inspectedElements || 0), 0);
  data.extraction = { inspectedElements: Math.min(maxElements, inspected),
    truncated: inspected >= maxElements || samples.some(s => (s.data.extraction as { truncated?: boolean })?.truncated) };
  data.componentsSample = [...new Map(samples.flatMap(s => (s.data.componentsSample || []) as unknown[])
    .map(value => [JSON.stringify(value), value])).values()].slice(0, 20);
  return data;
}
