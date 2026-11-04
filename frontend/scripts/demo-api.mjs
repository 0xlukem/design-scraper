import { readFileSync } from 'node:fs';

// Development-only Vite middleware. It reads committed samples and has no fetch,
// provider SDK, Wrangler configuration, credentials or remote transport.
export function localDemoApi() {
  const single = JSON.parse(readFileSync(new URL('../src/examples/example-domain.json', import.meta.url), 'utf8'));
  const fixtures = JSON.parse(readFileSync(new URL('../../cloudflare-backend/tests/fixtures/contracts.json', import.meta.url), 'utf8'));
  let active = 0;
  const telemetry = (final = false) => ({
    funding: 'demo', provider: 'local-demo', model: 'fixture-replay',
    provider_calls: 0, generation_attempts: 0, auxiliary_calls: 0,
    final, usage_status: final ? 'not_called' : 'pending', usage: null,
    demo_budget: null, browser_ms: 0, browser_reserved_ms: 0,
  });
  const usage = sources => ({
    funding: 'demo', provider: 'local-demo', model: 'fixture-replay',
    input_tokens: 0, output_tokens: 0, total_tokens: 0, reasoning_tokens: null,
    status: 'estimated', estimated_cost_usd: 0, cost_status: 'estimated', pricing_source: 'local simulation',
    sources_count: sources, screenshots_sent: 0,
    notes: ['Local simulation using committed samples. Entered URLs were not visited. No browser or AI quota was consumed.'],
  });
  const result = bias => {
    if (bias === null) return {
      ...structuredClone(single), telemetry: telemetry(true),
      metadata: { ...structuredClone(single.metadata), usage: usage(1) },
    };
    const fixture = fixtures.find(item => item.bias === bias);
    return {
      success: true, design_md: fixture.documents.extended,
      design_system: structuredClone(fixture.normalized),
      documents: structuredClone(fixture.documents), exports: structuredClone(fixture.exports),
      telemetry: telemetry(true),
      metadata: {
        mode: 'mix', bias, weights: Object.fromEntries(fixture.sources.map(source => [source.label, source.weight])),
        sources: fixture.sources.map(source => ({
          slot: source.label, url: source.url, influence: source.weight,
          status: source.weight ? 'analyzed' : 'excluded', title: 'Demo editorial reference', description: 'Fixed contract sample',
          colors_extracted: source.weight ? 1 : 0, fonts_extracted: source.weight ? 1 : 0,
        })),
        usage: usage(fixture.sources.filter(source => source.weight > 0).length),
      },
    };
  };
  const quota = limited => {
    const now = new Date(), tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0);
    const used = limited ? 20 : 3;
    return {
      day: now.toISOString().slice(0, 10), resets_at: tomorrow.toISOString(),
      analyses: { used, limit: 20, remaining: 20 - used },
      capture: { used_or_reserved_ms: limited ? 480000 : 0, limit_ms: 480000, remaining_ms: limited ? 0 : 480000 },
      concurrency: { active, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: !limited,
    };
  };

  return {
    name: 'local-demo-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = new URL(req.url || '/', 'http://localhost').pathname;
        if (!path.startsWith('/api/')) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Local-Demo', 'true');
        const json = (status, payload, headers = {}) => {
          res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
          res.end(JSON.stringify(payload));
        };
        const fail = (status, code, message, retryable = false, headers = {}) =>
          json(status, { detail: { code, message, retryable }, telemetry: telemetry(true) }, headers);
        // Never accept or echo real credentials, even from a manually crafted request.
        if (req.headers.authorization || req.headers['x-ai-key'] || req.headers['x-ai-provider'])
          return fail(400, 'INVALID_REQUEST', 'The local demo does not accept credentials.');
        const scenario = req.headers['x-demo-scenario'] || 'success';
        if (!['success', 'capture-error', 'provider-error', 'rate-limit', 'slow'].includes(scenario))
          return fail(400, 'INVALID_REQUEST', 'Unknown demo scenario.');
        if (req.method === 'GET' && path === '/api/quotas') return json(200, quota(scenario === 'rate-limit'));
        if (req.method === 'GET' && path === '/api/providers') return json(200, {
          providers: ['gemini', 'anthropic', 'openai', 'xai'].map(provider => ({ provider, model: 'local-demo', inputPrice: 0, outputPrice: 0 })),
        });
        if (path === '/api/diagnostics/budget') return fail(403, 'UNAUTHORIZED', 'Administrative diagnostics are unavailable in the local demo.');
        if (!['/api/analyze', '/api/mix'].includes(path)) return fail(404, 'NOT_FOUND', 'Unknown local demo endpoint.');
        if (req.method !== 'POST') return fail(405, 'INVALID_REQUEST', 'Use POST for a simulated analysis.');
        let body;
        try {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 4096) throw new Error('Too large');
          }
          body = JSON.parse(raw);
        } catch { return fail(400, 'INVALID_REQUEST', 'Enter valid demo analysis input.'); }
        const mix = path === '/api/mix';
        const keys = mix ? ['url_1', 'url_2', 'bias'] : ['url'];
        const validUrl = value => {
          try { const url = new URL(value); return typeof value === 'string' && value.length <= 2048 && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
          catch { return false; }
        };
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key)) ||
          !(mix ? validUrl(body.url_1) && validUrl(body.url_2) && [-50, -25, 0, 25, 50].includes(body.bias) : validUrl(body.url)))
          return fail(400, 'INVALID_REQUEST', 'Enter HTTP(S) URLs and a supported mix balance.');
        if (scenario === 'rate-limit') return fail(429, 'RATE_LIMITED', 'Simulated quota reached. Retry in three seconds; no real quota was used.', true, { 'Retry-After': '3' });

        const payload = result(mix ? body.bias : null);
        const sources = mix ? payload.metadata.sources.filter(source => source.influence > 0).map(source => source.slot) : ['web_1'];
        const total = 3 + sources.length;
        const progress = (stage, completed, source = null) => ({ type: 'progress', progress: {
          stage, source, completed_steps: completed, total_steps: total,
          percent: Math.floor(completed * 100 / total), telemetry: telemetry(),
        } });
        const events = [progress('admitted', 0), ...sources.map((source, index) => progress('capture', index + 1, source))];
        if (scenario !== 'capture-error') events.push(progress('analyzing', sources.length + 1));
        if (scenario === 'capture-error' || scenario === 'provider-error') events.push({
          type: 'error', retry_after: '3', payload: {
            detail: {
              code: scenario === 'capture-error' ? 'SCRAPE_TIMEOUT' : 'PROVIDER_UNAVAILABLE', retryable: true,
              message: scenario === 'capture-error' ? 'Simulated capture timeout. No website was visited.' : 'Simulated provider failure. No AI provider was called.',
            }, telemetry: telemetry(true),
          },
        });
        else events.push(progress('exporting', total - 1), { type: 'result', payload, retry_after: null });

        active++;
        let timer;
        const release = () => { clearTimeout(timer); active--; };
        res.once('close', release);
        const stream = req.headers.accept?.includes('application/x-ndjson');
        const failed = scenario === 'capture-error' || scenario === 'provider-error';
        res.writeHead(stream || !failed ? 200 : scenario === 'capture-error' ? 504 : 503, {
          'Content-Type': stream ? 'application/x-ndjson' : 'application/json', 'X-Content-Type-Options': 'nosniff',
          ...(!stream && failed ? { 'Retry-After': '3' } : {}),
        });
        if (stream) res.flushHeaders();
        let index = 0;
        const tick = () => {
          if (res.destroyed) return;
          const event = events[index++];
          if (index === events.length) { res.end(JSON.stringify(stream ? event : event.payload) + '\n'); return; }
          if (stream) res.write(JSON.stringify(event) + '\n');
          timer = setTimeout(tick, scenario === 'slow' ? 1800 : 400);
        };
        tick();
      });
    },
  };
}
