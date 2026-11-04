import { expect, it, vi } from 'vitest';
import fixtures from './fixtures/contracts.json';
import { mergeSampleData, type CaptureSample } from '../src/capture-evidence';
import { normalize, type Source } from '../src/domain/normalize';
import { renderDocuments, renderExports } from '../src/domain/renderers';
import { assertMeasurementCoverage } from '../src/domain/measurements';
import { analyze } from '../src/providers';
import { config } from '../src/config';

const sample = (id: string, size: string): CaptureSample => ({
  id, image: 'YWJj', anchor: 'html > body > h1', sequence: 1, bytes: 3,
  viewport: { width: 1440, height: 900 }, region: { x: 0, y: 0, width: 1440, height: 900 },
  scroll_y_after: 0,
  data: { colors: [{ color: '#112233', count: 1 }], fonts: [{ font: 'Arial', count: 1 }],
    componentsSample: [], extraction: { inspectedElements: 5, truncated: false },
    measurements: { version: 1, samples: [{ id: 'heading-1', kind: 'heading', tag: 'h1', selector: 'html > body > h1',
      styles: { fontSize: size, fontFamily: 'Arial', fontWeight: '400', color: '#112233' } }] } },
});
const images = () => [sample('sample-1', '32px'), sample('sample-2', '24px'), sample('sample-3', '20px')]
  .map(({ id, image }) => ({ id, image }));

it('preserves distinct sampled styles with unique legacy-compatible measurement IDs and frame provenance', () => {
  const samples = [sample('sample-1', '32px'), sample('sample-2', '24px'), sample('sample-3', '32px')];
  const merged = mergeSampleData(samples, 3000);
  expect((merged.measurements as { samples: unknown[] }).samples).toMatchObject([
    { id: 'heading-1', capture_sample: 'sample-1', styles: { fontSize: '32px' } },
    { id: 'heading-2', capture_sample: 'sample-2', styles: { fontSize: '24px' } },
  ]);
  const fixture = structuredClone(fixtures[0]);
  (fixture.sources as Source[])[0].data = { ...fixture.sources[0].data, ...merged, capture: { method: 'independent-samples', quality: 'partial', later_unobserved_resource_failures: 1, embedded_resource_failures: 1, samples: samples.map(({ id }) => ({ id })), rejected_samples: [{ anchor: 'html > body > footer', code: 'CAPTURE_SAMPLE_UNSTABLE' }] } };
  const system = normalize(JSON.stringify(fixture.raw), fixture.sources as Source[]);
  assertMeasurementCoverage(system, fixture.sources as Source[]);
  expect(system.known_gaps.map(g => g.code)).toEqual(expect.arrayContaining(['capture-independent-samples', 'capture-partial-coverage']));
  expect(system.known_gaps.map(g => g.code)).toEqual(expect.arrayContaining(['capture-later-resources-unavailable', 'capture-embedded-content-unavailable']));
  expect(system.metadata.measurement_locators).toMatchObject({ 'measured-web-1-heading-2': { capture_sample: 'sample-2' } });
  const corrupted = structuredClone(system);
  (corrupted.metadata.measurement_locators as Record<string, { capture_sample: string }>)['measured-web-1-heading-2'].capture_sample = 'sample-3';
  expect(() => assertMeasurementCoverage(corrupted, fixture.sources as Source[])).toThrow();
  const documents = renderDocuments(system);
  for (const document of Object.values(documents)) {
    expect(document).toContain('sample-1'); expect(document).toContain('sample-2');
    expect(document).toContain('32px'); expect(document).toContain('24px');
    expect(document).toContain('CAPTURE_SAMPLE_UNSTABLE');
  }
  for (const output of Object.values(renderExports(system))) {
    expect(output).toContain('24px');
    expect(output).toMatch(/measured-web-1-heading-2[^\n]*sample-2/);
  }
});

it('caps the merged measurement set without reusing an ID or multiplying per-source limits', () => {
  const frames = [sample('sample-1', '32px'), sample('sample-2', '24px'), sample('sample-3', '20px')];
  for (const [index, frame] of frames.entries()) {
    const data = frame.data.measurements as { samples: unknown[] };
    data.samples = Array.from({ length: 24 }, (_, n) => ({ id: 'heading-1', kind: n % 2 ? 'heading' : 'body', tag: 'p',
      selector: `body > p:nth-child(${index * 24 + n + 1})`, styles: { fontSize: '16px' } }));
  }
  const rows = (mergeSampleData(frames, 3000).measurements as { samples: { id: string }[] }).samples;
  expect(rows.length).toBeLessThanOrEqual(24);
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
  expect(rows.every(row => /^(heading|body)-[1-6]$/.test(row.id))).toBe(true);
});

it.each(['gemini', 'anthropic', 'openai', 'xai'])('sends six correctly associated Mix images through %s without serializing base64 into prompt evidence', async provider => {
  const sources = structuredClone(fixtures.find(f => f.bias === 0)!.sources) as Source[];
  sources.forEach(source => { source.screenshots = images(); });
  const env = { AI_PROVIDER: provider, [`${provider.toUpperCase()}_API_KEY`]: 'fixture-key' };
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json({ error: {} }, { status: 401 }));
  await expect(analyze(sources, env, { ...config({}), attempts: 1, budgetEnabled: false }, new AbortController().signal, fetcher))
    .rejects.toMatchObject({ code: 'PROVIDER_AUTH_ERROR' });
  expect(fetcher).toHaveBeenCalledOnce();
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  const text = body.contents?.[0].parts[0].text || body.messages?.find((message: { role: string }) => message.role === 'user')?.content[0].text || body.input?.[0].content[0].text;
  expect(text).toContain('"image":6,"source":"web_2","sample":"sample-3"');
  expect(text).not.toContain('YWJj');
  const serialized = JSON.stringify(body);
  expect(serialized.match(/YWJj/g)).toHaveLength(6);
});

it('checks the complete six-image Gemini input before any generation dispatch', async () => {
  const sources = structuredClone(fixtures.find(f => f.bias === 0)!.sources) as Source[];
  sources.forEach(source => { source.screenshots = images(); });
  const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
    expect(String(_url)).toMatch(/:countTokens$/);
    const body = JSON.parse(String(options?.body));
    expect(body.generateContentRequest.contents[0].parts.filter((part: { inlineData?: unknown }) => part.inlineData)).toHaveLength(6);
    return Response.json({ totalTokens: 1000000 });
  });
  await expect(analyze(sources, { GEMINI_API_KEY: 'fixture-key', AI_FUNDING: 'byok' }, config({}), new AbortController().signal, fetcher))
    .rejects.toMatchObject({ code: 'AI_INPUT_LIMIT', budgetTokens: 0 });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('excludes a zero-weight source entirely, including its unusable sample images', async () => {
  const sources = structuredClone(fixtures.find(f => f.bias === -50)!.sources) as Source[];
  sources[0].screenshots = images(); sources[1].screenshots = [];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json({ error: {} }, { status: 401 }));
  await expect(analyze(sources, { GEMINI_API_KEY: 'fixture-key' }, { ...config({}), budgetEnabled: false }, new AbortController().signal, fetcher))
    .rejects.toMatchObject({ code: 'PROVIDER_AUTH_ERROR' });
  const prompt = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).contents[0].parts[0].text;
  expect(prompt).toContain('"image":3,"source":"web_1"');
  expect(prompt).not.toContain('"image":4');
  expect(String(fetcher.mock.calls[0][1]?.body).match(/YWJj/g)).toHaveLength(3);
});

it.each(['empty', 'too-many', 'duplicate', 'bytes'])('rejects %s image evidence before calling a provider', async kind => {
  const sources = structuredClone(fixtures[0].sources) as Source[];
  sources[0].screenshots = kind === 'empty' ? [] : images();
  if (kind === 'too-many') sources[0].screenshots.push({ id: 'sample-4', image: 'YWJj' });
  if (kind === 'duplicate') sources[0].screenshots[1].id = 'sample-1';
  if (kind === 'bytes') sources[0].screenshots = [{ id: 'sample-1', image: Buffer.alloc(6000).toString('base64') }, { id: 'sample-2', image: Buffer.alloc(6000).toString('base64') }];
  const fetcher = vi.fn();
  await expect(analyze(sources, { GEMINI_API_KEY: 'fixture-key' }, { ...config({}), screenshotBytes: 10000 }, new AbortController().signal, fetcher)).rejects.toBeInstanceOf(Error);
  expect(fetcher).not.toHaveBeenCalled();
});

it('validates the experimental strategy without changing its default or public input', () => {
  expect(config({}).captureStrategy).toBe('sections');
  expect(config({ CAPTURE_STRATEGY: 'samples' }).captureStrategy).toBe('samples');
  expect(() => config({ CAPTURE_STRATEGY: 'arbitrary' })).toThrow();
});
