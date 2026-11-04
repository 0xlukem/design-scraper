import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const backend = fileURLToPath(new URL('cloudflare-backend/', root));
const frontend = fileURLToPath(new URL('frontend/', root));
const worker = fileURLToPath(new URL('cloudflare-backend/node_modules/wrangler/bin/wrangler.js', root));
const vite = fileURLToPath(new URL('frontend/node_modules/vite/bin/vite.js', root));
const varsFile = new URL('cloudflare-backend/.dev.vars', root);

if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: npm run dev:live [-- --check]');
if (!existsSync(worker) || !existsSync(vite)) throw new Error('Install dependencies first: npm --prefix frontend ci && npm --prefix cloudflare-backend ci');
const vars = existsSync(varsFile) ? readFileSync(varsFile, 'utf8') : '';
const configured = new Map(vars.split(/\r?\n/).map(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  return match ? [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2').trim()] : ['', ''];
}));
const missing = ['GEMINI_API_KEY', 'IP_HASH_SECRET', 'PHASE8_AUTH_TOKEN'].filter(name =>
  !configured.get(name));
if (missing.length) throw new Error(`Set ${missing.join(', ')} in cloudflare-backend/.dev.vars using your own credentials. Use npm run demo for credential-free simulation.`);
if (process.argv.includes('--check')) {
  console.log('Live dependencies and required local variable names are configured. No services started; Cloudflare authentication was not checked.');
  process.exit(0);
}

console.log('LIVE ANALYSIS: Browser Run uses your logged-in Cloudflare account; Gemini uses your own key. Real requests consume quota.');
console.log('If needed, run npx wrangler login from cloudflare-backend/ using your own account. For simulation, use npm run demo.');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (!child.pid) continue;
    try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
}
function start(cwd, binary, args, env = process.env) {
  const child = spawn(process.execPath, [binary, ...args], { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.push(child);
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
start(backend, worker, ['dev', '--ip', '127.0.0.1', '--port', '8787', '--var', 'LOCAL_UNLIMITED_ANALYSES:true', '--var', 'ALLOWED_ORIGINS:http://localhost:5173,http://127.0.0.1:5173']);
start(frontend, vite, ['--mode', 'live', '--strictPort'], { ...process.env, VITE_API_URL: '' });
