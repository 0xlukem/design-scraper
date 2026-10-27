import { ArrowUpRight, CaretDown } from '@phosphor-icons/react'
import { createContext, useContext, useId, useLayoutEffect, useRef, useState } from 'react'
import type { DesignSystem, EvidenceToken } from '../types'
import EvidenceBadge from './EvidenceBadge'
import TokenCopyButton from './TokenCopyButton'
import ComponentPreview from './ComponentPreview'
import TypographySample from './TypographySample'

export interface InspectorSource { label: string; url: string; title?: string }
interface VisualInspectorProps { system: DesignSystem; sources?: InspectorSource[]; onBackToControls: () => void }
const EvidenceContext = createContext<{ sources: InspectorSource[]; inspect: (sources: string[]) => void }>({ sources: [], inspect: () => {} })
const sections = [['overview', 'Overview'], ['colors', 'Colors'], ['type', 'Typography'], ['spacing', 'Spacing'], ['elevation', 'Elevation'], ['components', 'Components'], ['responsive', 'Responsive'], ['evidence', 'Evidence & gaps']] as const
const COLOR_GROUPS = [['brand', 'Brand'], ['accent', 'Accent'], ['surfaces', 'Surfaces'], ['text', 'Text'], ['borders', 'Borders'], ['gradients', 'Gradients']] as const
export const readableName = (name: string) => name.replace(/^measured-web-\d+-/, '').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase())
function tokenValue(value: unknown): string { if (value == null) return '—'; return typeof value === 'object' ? JSON.stringify(value) : String(value) }
function pixels(value: unknown): number | null {
  const match = tokenValue(value).match(/^(\d*\.?\d+)(px|rem|em)?$/i)
  return match ? Number(match[1]) * (/rem|em/i.test(match[2]) ? 16 : 1) : null
}
function EvidenceLine({ token }: { token: EvidenceToken }) {
  const evidence = useContext(EvidenceContext)
  return <div className="token-evidence-line">
    <div className="token-identity"><p className="token-name">{readableName(token.name || token.role)}</p><code className="token-value">{tokenValue(token.value)}</code></div>
    <TokenCopyButton value={tokenValue(token.value)} label={`${token.name || token.role} token`} />
    <details className="token-provenance"><summary>Evidence · {token.status === 'detected' ? 'Detected' : token.status === 'inferred' ? 'Inferred' : 'AI interpretation'}</summary>
      <EvidenceBadge status={token.status} confidence={token.confidence} /><p>{token.role}</p><code>{token.name}</code>
      <p>Source: {token.source.map(label => evidence.sources.find(source => source.label === label)?.url || label.replace('_', ' ')).join(', ') || 'Not recorded'}</p>
      <button type="button" className="text-button" onClick={() => evidence.inspect(token.source)}>View source &amp; gaps</button>
    </details>
  </div>
}
function Heading({ id, title, description }: { id: string; title: string; description?: string }) {
  return <div className="inspector-section-heading"><h3 id={id}>{title}</h3>{description && <p>{description}</p>}</div>
}
function EvidenceGuide() { return <details className="evidence-guide inspector-details"><summary>How to read the evidence labels</summary><dl>
  <div><dt>Detected</dt><dd>A value found in the captured source or measured CSS.</dd></div><div><dt>Inferred</dt><dd>Deduced from evidence; not directly measured.</dd></div><div><dt>AI interpretation</dt><dd>A visual judgment or suggestion made by the AI.</dd></div>
  </dl><p>Recorded confidence is not a verified accuracy score. Measurements describe sampled elements; roles and suggested recipes can be interpretations.</p></details> }
const gapGroup = (code: string) => /model|inferred|unsupported/i.test(code) ? 'Interpretation limits' : /css|measurement|shadow|font|dimension/i.test(code) ? 'Measurement limits' : 'Capture limits'

export default function VisualInspector({ system, sources = [], onBackToControls }: VisualInspectorProps) {
  const id = useId().replace(/:/g, '')
  const [active, setActive] = useState('overview')
  const [componentIndex, setComponentIndex] = useState(0)
  const [sourceFilter, setSourceFilter] = useState<string[]>([])
  const panel = useRef<HTMLElement>(null)
  const nav = useRef<HTMLElement>(null)
  const userNavigation = useRef(false)
  useLayoutEffect(() => {
    if (!userNavigation.current) return
    panel.current?.focus({ preventScroll: true })
    nav.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    userNavigation.current = false
  }, [active])
  const jump = (section: string) => { userNavigation.current = true; setActive(section) }
  const inspect = (labels: string[]) => { setSourceFilter(labels); jump('evidence') }
  const spacingTokens = [...(system.spacing.base_unit ? [system.spacing.base_unit] : []), ...system.spacing.tokens, ...system.spacing.section_padding, ...system.spacing.card_padding, ...system.spacing.button_padding]
  const spacingGroups = new Map<string, EvidenceToken[]>()
  for (const token of spacingTokens) { const value = tokenValue(token.value); spacingGroups.set(value, [...(spacingGroups.get(value) || []), token]) }
  const palette = [...system.colors.brand, ...system.colors.accent, ...system.colors.surfaces, ...system.colors.text].slice(0, 8)
  const fonts = [...new Set([...system.typography.families, ...system.typography.scale.flatMap(spec => spec.family ? [spec.family] : [])].map(token => tokenValue(token.value)).filter(value => value !== '—'))]
  const component = system.components[componentIndex]
  const selectedGaps = system.known_gaps.filter(gap => !sourceFilter.length || !gap.source.length || gap.source.some(source => sourceFilter.includes(source)))
  const title = sections.find(([key]) => key === active)![1]
  return <EvidenceContext.Provider value={{ sources, inspect }}><div className="visual-inspector inspector-workspace" aria-label="Visual design system inspector">
    <nav ref={nav} className="inspector-nav" aria-label="Design sections">
      <div className="inspector-section-links">{sections.map(([key, label]) => <button key={key} type="button" aria-current={active === key ? 'true' : undefined} aria-controls={`${id}-section`} onClick={() => jump(key)}>{label}</button>)}</div>
      <label className="inspector-section-select"><span className="sr-only">Design section</span><select value={active} onChange={event => jump(event.target.value)}>{sections.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><CaretDown size={16} aria-hidden="true" /></label>
      <button type="button" className="inspector-back" aria-label="Open export controls" onClick={onBackToControls}><span>Export</span><ArrowUpRight size={16} aria-hidden="true" /></button>
    </nav>
    <section ref={panel} id={`${id}-section`} className="inspector-section inspector-active-panel" tabIndex={-1} aria-labelledby={`${id}-title`}>
      <Heading id={`${id}-title`} title={title} />
      {active === 'overview' && <div className="design-overview">
        <p className="overview-summary">{system.overview.summary}</p>
        <div className="overview-essentials"><div><h4>Palette</h4><div className="overview-palette">{palette.map((token, index) => <button type="button" key={index} style={{ background: tokenValue(token.value) }} aria-label={`Inspect ${token.name}: ${tokenValue(token.value)}`} title={`${token.name}: ${tokenValue(token.value)}`} onClick={() => jump('colors')} />)}</div><button type="button" className="text-button" onClick={() => jump('colors')}>Explore colors</button></div>
        <div><h4>Type families</h4>{fonts.length ? fonts.slice(0, 3).map(font => <p className="overview-font" key={font}>{font}</p>) : <p>Font families were not recorded.</p>}<button type="button" className="text-button" onClick={() => jump('type')}>Inspect typography</button></div></div>
        <dl className="overview-facts"><div><dt>Character</dt><dd>{system.overview.identity}</dd></div><div><dt>Density</dt><dd>{system.overview.density}</dd></div><div><dt>Tone</dt><dd>{system.overview.tone.join(', ') || 'Not recorded'}</dd></div><div><dt>Layout</dt><dd>{system.overview.layout_philosophy}</dd></div></dl>
        <button type="button" className="text-button" onClick={() => inspect([])}>{system.known_gaps.length} recorded limitations · View evidence</button><EvidenceGuide />
      </div>}
      {active === 'colors' && <div className="color-groups">{COLOR_GROUPS.map(([key, label]) => system.colors[key].length > 0 && <div className="color-group" key={key}><h4>{label}</h4><div className="swatch-list">{system.colors[key].map((token, index) => <article className="swatch-row" key={index}><div className="color-swatch" style={{ background: tokenValue(token.value) }} aria-hidden="true" /><EvidenceLine token={token} /></article>)}</div></div>)}</div>}
      {active === 'type' && <><p className="section-caveat">Font files are not included. Your browser may substitute a font; recorded metrics remain unchanged.</p><div className="type-scale">{system.typography.scale.map((spec, index) => <TypographySample key={index} spec={spec} />)}{!system.typography.scale.length && <p className="inspector-empty">No type scale was recorded.</p>}</div></>}
      {active === 'spacing' && <div className="measure-grid"><div><h4>Spacing values</h4><p className="section-caveat">Repeated values share one row. Element measurements do not establish a global spacing scale.</p>{[...spacingGroups].sort(([a], [b]) => (pixels(a) ?? Infinity) - (pixels(b) ?? Infinity)).map(([value, tokens]) => <div className="spacing-value" key={value}><div className="spacing-value-heading"><code>{value}</code>{pixels(value) !== null && <span className="spacing-track" aria-hidden="true"><span className="spacing-bar" style={{ width: `${Math.min(180, pixels(value)!)}px` }} /></span>}<TokenCopyButton value={value} label={`${value} spacing value`} /></div><details className="spacing-aliases"><summary>{tokens.length} {tokens.length === 1 ? 'usage' : 'usages'}</summary>{tokens.map((token, index) => <EvidenceLine token={token} key={index} />)}</details></div>)}{!spacingTokens.length && <p>No spacing values recorded.</p>}</div><div><h4>Corner radii</h4>{system.shapes.radii.map((token, index) => <article className="radius-compact" key={index}><span style={{ borderRadius: tokenValue(token.value) }} aria-hidden="true" /><EvidenceLine token={token} /></article>)}{!system.shapes.radii.length && <p>No corner radii recorded.</p>}</div></div>}
      {active === 'elevation' && <><p className="section-caveat">{system.elevation.philosophy}</p><div className="shadow-list">{system.elevation.tokens.map((token, index) => <article className="shadow-sample" key={index}><div style={{ boxShadow: tokenValue(token.value) }} aria-hidden="true" /><EvidenceLine token={token} /></article>)}</div>{!system.elevation.tokens.length && <p className="inspector-empty">No shadow values were recorded.</p>}{system.elevation.borders.length > 0 && <details className="inspector-details"><summary>Border treatments</summary>{system.elevation.borders.map((token, index) => <EvidenceLine token={token} key={index} />)}</details>}</>}
      {active === 'components' && <><p className="section-caveat">Measured elements and AI recipes are labeled separately. A property preview does not reconstruct the original component.</p>{component ? <div className="component-browser"><div className="component-picker" aria-label="Component list">{system.components.map((item, index) => <button type="button" key={index} aria-pressed={index === componentIndex} onClick={() => setComponentIndex(index)}><strong>{readableName(item.name)}</strong><small>{item.name.startsWith('measured-') ? 'Measured element' : item.status === 'detected' ? 'Detected properties' : item.status === 'inferred' ? 'Inferred recipe' : 'AI interpretation'}</small></button>)}</div><article className="component-card"><div className="component-heading"><h4>{readableName(component.name)}</h4><EvidenceBadge status={component.status} confidence={component.confidence} /></div><p>{component.description}</p><ComponentPreview component={component} /><details className="inspector-details"><summary>Recorded properties ({component.values.length})</summary>{component.values.map((token, index) => <EvidenceLine token={token} key={index} />)}</details><h4 className="component-states-heading">Interaction states</h4>{component.states.length ? <ul className="state-list" aria-label={`${component.name} states`}>{component.states.map((state, index) => <li key={index}><span>{state.name}</span><small>{state.observed ? 'Observed' : 'Not observed'}</small></li>)}</ul> : <p>No interaction states recorded.</p>}</article></div> : <p>No component evidence recorded.</p>}</>}
      {active === 'responsive' && <><p className="section-caveat">CSS rules can be detected from one viewport. They do not prove how every screen behaves.</p><div className="responsive-grid"><div><h4>Breakpoints</h4>{system.responsive.breakpoints.map((token, index) => <EvidenceLine token={token} key={index} />)}{!system.responsive.breakpoints.length && <p>No explicit breakpoints detected.</p>}</div><div>{(['detected', 'inferred', 'interpreted'] as const).map(status => { const changes = system.responsive.changes.filter(token => token.status === status); return changes.length ? <div key={status}><h4>{status === 'detected' ? 'Detected rules' : status === 'inferred' ? 'Inferred changes' : 'AI interpretations'}</h4>{changes.map((token, index) => <EvidenceLine token={token} key={index} />)}</div> : null })}{!system.responsive.changes.length && <p>No responsive changes recorded.</p>}</div></div></>}
      {active === 'evidence' && <div className="evidence-content">
        {sourceFilter.length > 0 && <p className="section-caveat">Showing evidence for {sourceFilter.map(label => sources.find(source => source.label === label)?.url || label.replace('_', ' ')).join(', ')}. <button className="text-button" type="button" onClick={() => setSourceFilter([])}>Show all sources</button></p>}
        <h4>Captured sources</h4><ul className="source-records">{system.evidence.sources.map(source => { const detail = sources.find(item => item.label === source.label); return <li key={source.label}><strong>{detail?.url || source.label.replace('_', ' ')}</strong><span>{source.weight}% influence · {source.status}</span></li> })}{!system.evidence.sources.length && <li>Source coverage was not recorded.</li>}</ul>
        <h4>Coverage &amp; limitations</h4>{(['Capture limits', 'Measurement limits', 'Interpretation limits'] as const).map(group => { const gaps = selectedGaps.filter(gap => gapGroup(gap.code) === group); return gaps.length > 0 && <details key={group} className="gap-group" open><summary>{group} · {gaps.length}</summary>{gaps.map((gap, index) => <div className="gap-record" key={index}><p>{gap.message}</p><details><summary>Source &amp; technical code</summary><code>{gap.code}</code><p>Source: {gap.source.map(label => sources.find(source => source.label === label)?.url || label.replace('_', ' ')).join(', ') || 'Unspecified'}</p></details></div>)}</details> })}{!selectedGaps.length && <p>No limitations recorded for this source. This is not a guarantee of complete coverage.</p>}<EvidenceGuide />
      </div>}
    </section>
  </div></EvidenceContext.Provider>
}
