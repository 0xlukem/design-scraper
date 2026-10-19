import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// The API URL is supplied by the deployment environment, never a secret.
const api = process.env.VITE_API_URL
if (!api || new URL(api).protocol !== 'https:' || new URL(api).origin !== api || new URL(api).username)
  throw new Error('Set VITE_API_URL to the HTTPS backend origin before building Pages.')
if (!readFileSync('public/_headers', 'utf8').includes(`connect-src 'self' ${api};`))
  throw new Error('The backend URL must match the Pages Content-Security-Policy.')
for (const [command, args] of [['tsc', []], ['vite', ['build']]]) {
  const run = spawnSync(`node_modules/.bin/${command}`, args, {
    stdio: 'inherit', env: process.env,
  })
  if (run.error || run.status !== 0) process.exit(run.status || 1)
}
