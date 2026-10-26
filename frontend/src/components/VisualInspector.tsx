import { ArrowUp, CaretDown, CheckCircle, Info, WarningCircle } from '@phosphor-icons/react'
import { useId } from 'react'
import type {
  DesignSystem,
  EvidenceStatus,
  EvidenceToken,
} from '../types'
import EvidenceBadge from './EvidenceBadge'
import TokenCopyButton from './TokenCopyButton'
import ComponentPreview from './ComponentPreview'
import TypographySample from './TypographySample'

interface VisualInspectorProps {
  system: DesignSystem
  onBackToControls: () => void
}

function tokenValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function visualPixels(value: unknown, fallback: number): number {
  const match = tokenValue(value).match(/^(-?\d*\.?\d+)(px|rem|em)?$/i)
  if (!match) return fallback
  const numeric = Number(match[1])
  const pixels = match[2]?.toLowerCase() === 'rem' || match[2]?.toLowerCase() === 'em'
    ? numeric * 16
    : numeric
  return Number.isFinite(pixels) ? pixels : fallback
}

function tokenLabel(token: EvidenceToken): string {
  return token.name || token.role
}

function EvidenceLine({ token }: { token: EvidenceToken }) {
  const value = tokenValue(token.value)
  return (
    <div className="token-evidence-line">
      <div className="min-w-0">
        <p className="token-name">{tokenLabel(token)}</p>
        <p className="token-role">{token.role}</p>
      </div>
      <code className="token-value">{value}</code>
      <EvidenceBadge status={token.status} confidence={token.confidence} />
      <TokenCopyButton value={value} label={`${tokenLabel(token)} token`} />
    </div>
  )
}

function SectionHeading({
  id,
  index,
  title,
  description,
}: {
  id: string
  index: string
  title: string
  description: string
}) {
  return (
    <div className="inspector-section-heading">
      <span className="inspector-index">{index}</span>
      <div>
        <h3 id={id}>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  )
}

function statusForComponent(status: EvidenceStatus, confidence: number) {
  return <EvidenceBadge status={status} confidence={confidence} />
}

const COLOR_GROUPS = [
  ['brand', 'Brand'],
  ['accent', 'Accent'],
  ['surfaces', 'Surfaces'],
  ['text', 'Text'],
  ['borders', 'Borders'],
  ['gradients', 'Gradients'],
] as const

export default function VisualInspector({ system, onBackToControls }: VisualInspectorProps) {
  const id = useId()
  const spacingTokens = [
    ...(system.spacing.base_unit ? [system.spacing.base_unit] : []),
    ...system.spacing.tokens,
    ...system.spacing.section_padding,
    ...system.spacing.card_padding,
    ...system.spacing.button_padding,
  ]
  const observedComponents = system.components

  const measuredComponents = observedComponents.filter(component => component.name.startsWith('measured-'))
  const sections = [
    ['overview', 'Overview'], ['colors', 'Colors'], ['type', 'Typography'],
    ['spacing', 'Spacing'], ['elevation', 'Elevation'], ['components', 'Components'],
    ['responsive', 'Responsive'], ['evidence', 'Evidence & gaps'],
  ] as const
  function jump(section: string) {
    const target = document.getElementById(`${id}-${section}-section`)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const renderComponents = (components: typeof observedComponents) => components.map((component) => (
    <article className="component-card" key={component.name}>
      <div className="component-heading">
        <div>
          <h4>{component.name}</h4>
          <p>{component.description}</p>
        </div>
        {statusForComponent(component.status, component.confidence)}
      </div>
      <ComponentPreview component={component} />
      {component.values.length ? (
        <details className="inspector-details component-details"><summary>Style properties ({component.values.length})</summary><div className="component-values">
          {component.values.map((token, index) => (
            <EvidenceLine token={token} key={`${tokenLabel(token)}-${index}`} />
          ))}
        </div></details>
      ) : null}
      {component.states.length ? (
        <ul className="state-list" aria-label={`${component.name} states`}>
          {component.states.map((state) => (
            <li key={state.name} className={state.observed ? 'state-observed' : 'state-unobserved'}>
              {state.observed ? (
                <CheckCircle size={18} weight="fill" aria-hidden="true" />
              ) : (
                <Info size={18} weight="bold" aria-hidden="true" />
              )}
              <span>{state.name}</span>
              <small>{state.observed ? 'Observed' : 'Not observed'}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="inspector-empty">No interaction states were observed.</p>
      )}
    </article>
  ))
  const renderSpacing = (tokens: typeof spacingTokens) => tokens.map((token, index) => (
    <div className="spacing-row" key={`${tokenLabel(token)}-${index}`}>
      <div className="spacing-description"><strong>{tokenLabel(token)}</strong><code>{tokenValue(token.value)}</code><span className="spacing-track" aria-hidden="true"><span className="spacing-bar" style={{ width: `${Math.min(220, Math.max(0, visualPixels(token.value, 0)))}px` }} /></span></div>
      <TokenCopyButton value={tokenValue(token.value)} label={`${tokenLabel(token)} spacing token`} />
    </div>
  ))
  const measuredSpacing = spacingTokens.filter(token => token.name?.startsWith('measured-'))

  return (
    <div className="visual-inspector" aria-label="Visual design system inspector">
      <nav className="inspector-nav" aria-label="Design sections">
        <div className="inspector-section-links">{sections.map(([key, label]) => (
          <a key={key} href={`#${id}-${key}-section`} onClick={event => { event.preventDefault(); jump(key) }}>{label}</a>
        ))}</div>
        <label className="inspector-section-select">
          <span className="sr-only">Jump to design section</span>
          <select value="" onChange={event => jump(event.target.value)}>
            <option value="" disabled>Sections</option>
            {sections.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <CaretDown size={16} aria-hidden="true" />
        </label>
        <button type="button" className="inspector-back" aria-label="Export controls" title="Back to export controls" onClick={onBackToControls}><span>Export controls</span> <ArrowUp size={16} aria-hidden="true" /></button>
      </nav>
      <details className="evidence-guide inspector-details">
        <summary>How to read the evidence labels</summary>
        <dl>
          <div><dt>Detected</dt><dd>A value found in the captured source or measured CSS.</dd></div>
          <div><dt>Inferred</dt><dd>A value deduced from the available evidence; it was not directly measured.</dd></div>
          <div><dt>AI interpretation</dt><dd>A visual judgment or suggestion made by the AI.</dd></div>
        </dl>
        <p>The percentage is the confidence recorded with this analysis. It is not a verified accuracy score. Check the source and known gaps before reusing a value.</p>
      </details>
      <section className="inspector-overview" id={`${id}-overview-section`} tabIndex={-1} aria-labelledby={`${id}-overview-title`}>
        <div>
          <p className="eyebrow">System overview</p>
          <h3 id={`${id}-overview-title`}>{system.overview.identity}</h3>
        </div>
        <p>{system.overview.summary}</p>
        <dl>
          <div>
            <dt>Density</dt>
            <dd>{system.overview.density}</dd>
          </div>
          <div>
            <dt>Tone</dt>
            <dd>{system.overview.tone.join(', ') || 'Not enough evidence'}</dd>
          </div>
          <div>
            <dt>Layout</dt>
            <dd>{system.overview.layout_philosophy}</dd>
          </div>
        </dl>
      </section>

      <section className="inspector-section" id={`${id}-colors-section`} tabIndex={-1} aria-labelledby={`${id}-colors-title`}>
        <SectionHeading
          id={`${id}-colors-title`}
          index="01"
          title="Color system"
          description="Grouped by role, with evidence status and confidence kept visible."
        />
        <div className="color-groups">
          {COLOR_GROUPS.map(([key, label]) => {
            const tokens = system.colors[key]
            if (!tokens.length) return null
            return (
              <div className="color-group" key={key}>
                <h4>{label}</h4>
                <div className="swatch-list">
                  {tokens.map((token, index) => {
                    const value = tokenValue(token.value)
                    return (
                      <article className="swatch-row" key={`${tokenLabel(token)}-${index}`}>
                        <div className="color-swatch" style={{ background: value }} aria-hidden="true" />
                        <EvidenceLine token={token} />
                      </article>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="inspector-section" id={`${id}-type-section`} tabIndex={-1} aria-labelledby={`${id}-type-title`}>
        <SectionHeading
          id={`${id}-type-title`}
          index="02"
          title="Typography"
          description="Recorded sizes, line heights and letter spacing. Font files are not included; your browser may substitute a font. Missing metrics are listed with each sample."
        />
        {system.typography.scale.length ? (
          <div className="type-scale">
            {system.typography.scale.slice(0, 3).map(spec => <TypographySample key={spec.name} spec={spec} />)}
            {system.typography.scale.length > 3 && <details className="inspector-details">
              <summary>More type samples ({system.typography.scale.length - 3})</summary>
              {system.typography.scale.slice(3).map(spec => <TypographySample key={spec.name} spec={spec} />)}
            </details>}
          </div>
        ) : (
          <p className="inspector-empty">Not enough evidence to build a type scale.</p>
        )}
      </section>

      <section className="inspector-section" id={`${id}-spacing-section`} tabIndex={-1} aria-labelledby={`${id}-spacing-title`}>
        <SectionHeading
          id={`${id}-spacing-title`}
          index="03"
          title="Spacing & shape"
          description="Bars are proportional within a safe preview range; labels preserve the detected values."
        />
        <div className="measure-grid">
          <div>
            <h4>Spacing scale</h4>
            {spacingTokens.length ? (
              <div className="spacing-list">
                {renderSpacing(spacingTokens.filter(token => !token.name?.startsWith('measured-')))}
                {measuredSpacing.length > 0 && <details className="inspector-details">
                  <summary>Element spacing ({measuredSpacing.length} measurements)</summary>
                  <div className="spacing-list">{renderSpacing(measuredSpacing)}</div>
                </details>}
              </div>
            ) : (
              <p className="inspector-empty">Not enough spacing evidence.</p>
            )}
          </div>
          <div>
            <h4>Radii</h4>
            {system.shapes.radii.length ? (
              <div className="radius-list">
                {system.shapes.radii.map((token, index) => (
                  <article className="radius-sample" key={`${tokenLabel(token)}-${index}`}>
                    <span className="radius-swatch" style={{ borderRadius: tokenValue(token.value) }} aria-hidden="true" />
                    <div>
                      <strong>{tokenLabel(token)}</strong>
                      <code>{tokenValue(token.value)}</code>
                    </div>
                    <TokenCopyButton value={tokenValue(token.value)} label={`${tokenLabel(token)} radius token`} />
                  </article>
                ))}
              </div>
            ) : (
              <p className="inspector-empty">Not enough radius evidence.</p>
            )}
          </div>
        </div>
      </section>

      <section className="inspector-section" id={`${id}-elevation-section`} tabIndex={-1} aria-labelledby={`${id}-elevation-title`}>
        <SectionHeading
          id={`${id}-elevation-title`}
          index="04"
          title="Elevation"
          description={system.elevation.philosophy || 'Detected shadow and border treatments.'}
        />
        {system.elevation.tokens.length ? (
          <div className="shadow-list">
            {system.elevation.tokens.map((token, index) => (
              <article className="shadow-sample" key={`${tokenLabel(token)}-${index}`}>
                <div style={{ boxShadow: tokenValue(token.value) }} aria-hidden="true" />
                <EvidenceLine token={token} />
              </article>
            ))}
          </div>
        ) : (
          <p className="inspector-empty">Not enough evidence to establish elevation levels.</p>
        )}
      </section>

      <section className="inspector-section" id={`${id}-components-section`} tabIndex={-1} aria-labelledby={`${id}-components-title`}>
        <SectionHeading
          id={`${id}-components-title`}
          index="05"
          title="Observed components"
          description="Only states supported by the captured evidence are marked as observed."
        />
        {observedComponents.length ? (
          <div className="component-list">
            {renderComponents(observedComponents.filter(component => !component.name.startsWith('measured-')))}
            {measuredComponents.length > 0 && <details className="inspector-details measured-components">
              <summary>Element measurements ({measuredComponents.length} components)</summary>
              <div className="component-list">{renderComponents(measuredComponents)}</div>
            </details>}
          </div>
        ) : (
          <p className="inspector-empty">Not enough evidence to describe components.</p>
        )}
      </section>

      <section className="inspector-section" id={`${id}-responsive-section`} tabIndex={-1} aria-labelledby={`${id}-responsive-title`}>
        <SectionHeading
          id={`${id}-responsive-title`}
          index="06"
          title="Responsive behavior"
          description="Breakpoints and layout changes found in the captured source."
        />
        <div className="responsive-grid">
          <div>
            <h4>Breakpoints</h4>
            {system.responsive.breakpoints.length ? (
              <div className="breakpoint-list">
                {system.responsive.breakpoints.map((token, index) => (
                  <article key={`${tokenLabel(token)}-${index}`}>
                    <strong>{tokenLabel(token)}</strong>
                    <code>{tokenValue(token.value)}</code>
                    <EvidenceBadge status={token.status} confidence={token.confidence} />
                  </article>
                ))}
              </div>
            ) : (
              <p className="inspector-empty">No explicit breakpoints detected.</p>
            )}
          </div>
          <div>
            <h4>Detected changes</h4>
            {system.responsive.changes.length ? (
              <div className="responsive-change-list">
                {system.responsive.changes.map((token, index) => (
                  <EvidenceLine token={token} key={`${tokenLabel(token)}-${index}`} />
                ))}
              </div>
            ) : (
              <p className="inspector-empty">No responsive changes were confirmed.</p>
            )}
          </div>
        </div>
      </section>

      <section className="inspector-section inspector-evidence" id={`${id}-evidence-section`} tabIndex={-1} aria-labelledby={`${id}-evidence-title`}>
        <SectionHeading
          id={`${id}-evidence-title`}
          index="07"
          title="Evidence & known gaps"
          description="Limits stay next to the result so uncertain findings cannot read as facts."
        />
        <div className="evidence-grid">
          <div>
            <h4>Sources</h4>
            <ul>
              {system.evidence.sources.map((source) => (
                <li key={source.label}>
                  <span>{source.label.replace('_', ' ')}</span>
                  <strong>{source.weight}%</strong>
                  <small>{source.status}</small>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Known gaps</h4>
            {system.known_gaps.length ? (
              <ul className="gap-list">
                {system.known_gaps.map((gap, index) => (
                  <li key={`${gap.code}-${gap.source.join(',')}-${index}`}>
                    <WarningCircle size={19} weight="bold" aria-hidden="true" />
                    <div>
                      <strong>{gap.code}</strong>
                      <p>{gap.message}</p>
                      {gap.source.length > 0 && <small>Source: {gap.source.map(source => source.replace('_', ' ')).join(', ')}</small>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="inspector-empty">No known evidence gaps were recorded.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
