// Both conditions are compile-time constants. Pages builds cannot enable this
// mode through a URL, browser storage or a VITE_* environment override.
export const isLocalDemo = import.meta.env.DEV && import.meta.env.MODE === 'demo'

export const cancelledDemoTelemetry = (): import('./types').AnalysisTelemetry => ({
  funding: 'demo', provider: 'local-demo', model: 'fixture-replay', provider_calls: 0,
  generation_attempts: 0, auxiliary_calls: 0, final: true, usage_status: 'not_called',
  usage: null, demo_budget: null, browser_ms: 0, browser_reserved_ms: 0,
})

export const demoScenarios = {
  success: 'Successful analysis',
  'capture-error': 'Capture error, then retry',
  'provider-error': 'Provider error, then retry',
  'rate-limit': 'Quota reached, then retry',
  slow: 'Slow analysis / cancellation',
} as const
export type DemoScenario = keyof typeof demoScenarios
let scenario: DemoScenario = 'success'
const listeners = new Set<() => void>()

export const getDemoScenario = () => scenario
export const subscribeDemoScenario = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setDemoScenario(value: DemoScenario) {
  scenario = value
  listeners.forEach(listener => listener())
}

export function demoHeaders(consume = false): Record<string, string> {
  if (!isLocalDemo) return {}
  const headers = { 'X-Demo-Scenario': scenario }
  if (consume) setDemoScenario('success')
  return headers
}
