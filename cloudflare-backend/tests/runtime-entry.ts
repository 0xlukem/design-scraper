import { Buffer } from 'node:buffer';
import { extractDeclared } from '../src/declared-styles';
import { streamAnalysis } from '../src/telemetry';
import app from "../src/index";
export { AnalysisSession } from "../src/index";
export { QuotaCoordinator } from "../src/quota";

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === '/test/declared-styles') {
      const pages: Record<string, string> = {
        '/': '<style>:root{--brand-primary:#7845ba;--radius-card:23px}</style><link rel="stylesheet" href="/sheet.css"><script type="text/plain">.bogus{border-radius:43px}</script>',
        '/sheet.css': '.card{color:#284795;padding:17px} @media(min-width:500px){h1{font-size:36px}}',
      };
      return Response.json(await extractDeclared('https://example.com/', { async load(input) {
        const path = new URL(input.url).pathname;
        return { status: 200, headers: { 'content-type': path === '/' ? 'text/html' : 'text/css' }, body: Buffer.from(pages[path]) };
      } }));
    }
    if (path === '/test/stream') return streamAnalysis(async emit => {
      emit({ stage: 'admitted', source: null, completed_steps: 1, total_steps: 4, percent: 25,
        telemetry: { funding: 'demo', provider: 'fixture', model: 'fixture', provider_calls: 0, generation_attempts: 0, auxiliary_calls: 0, final: false, usage_status: 'pending', usage: null, demo_budget: null, browser_ms: null, browser_reserved_ms: 0 } });
      await new Promise(resolve => setTimeout(resolve, 50));
      return Response.json({ success: true, design_md: '# Simulated transport' });
    });
    if (path.startsWith("/test/")) {
      const p = (await request.json()) as {
        name: string;
        method: "admit" | "finish" | "browserStart" | "status" | "providerCall" | "publicStatus";
        args: unknown[];
      };
      const stub = env.QUOTA.getByName(p.name);
      const result = await (
        stub[p.method] as (...args: unknown[]) => Promise<unknown>
      )(...p.args);
      return Response.json(result ?? null);
    }
    return app.fetch(request, env);
  },
};
