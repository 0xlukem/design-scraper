import { useSyncExternalStore } from 'react'
import { demoScenarios, getDemoScenario, setDemoScenario, subscribeDemoScenario, type DemoScenario } from '../demo'
import './demo.css'

export default function DemoControls({ busy }: { busy: boolean }) {
  const scenario = useSyncExternalStore(subscribeDemoScenario, getDemoScenario)
  return <aside className="local-demo" aria-label="Local demo">
    <div><strong>Local demo · simulated</strong><p>No accounts, API keys or charges. Entered URLs are never visited. Results and capacity are samples; costs stay at US$0.</p></div>
    <label>Next demo run
      <select id="demo-scenario" value={scenario} disabled={busy} onChange={event => setDemoScenario(event.target.value as DemoScenario)}>
        {Object.entries(demoScenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <span>Each scenario runs once. Retry returns a successful sample.</span>
    </label>
  </aside>
}
