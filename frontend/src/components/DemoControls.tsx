import { useSyncExternalStore } from 'react'
import { demoScenarios, getDemoScenario, setDemoScenario, subscribeDemoScenario, type DemoScenario } from '../demo'
import './demo.css'

export default function DemoControls({ busy }: { busy: boolean }) {
  const scenario = useSyncExternalStore(subscribeDemoScenario, getDemoScenario)
  return <aside className="local-demo" aria-label="Local demo">
    <div><strong>Local demo · simulated</strong><p>Saved examples · US$0 per run</p></div>
    <label>Next demo run
      <select id="demo-scenario" value={scenario} disabled={busy} onChange={event => setDemoScenario(event.target.value as DemoScenario)}>
        {Object.entries(demoScenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  </aside>
}
