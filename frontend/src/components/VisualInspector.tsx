import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react'
import { useId } from 'react'
import type {
  DesignSystem,
  EvidenceStatus,
  EvidenceToken,
  TypographySpec,
} from '../types'
import EvidenceBadge from './EvidenceBadge'
import TokenCopyButton from './TokenCopyButton'

interface VisualInspectorProps {
  system: DesignSystem
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

function typographyStyle(spec: TypographySpec) {
  const size = Math.min(56, Math.max(14, visualPixels(spec.size?.value, 22)))
  const weight = tokenValue(spec.weight?.value ?? 400)
  const family = tokenValue(spec.family?.value ?? 'inherit')
  return {
    fontFamily: `${family}, sans-serif`,
    fontSize: `${size}px`,
    fontWeight: weight,
  }
}

const COLOR_GROUPS = [
  ['brand', 'Brand'],
  ['accent', 'Accent'],
  ['surfaces', 'Surfaces'],
  ['text', 'Text'],
  ['borders', 'Borders'],
  ['gradients', 'Gradients'],
] as const

export default function VisualInspector({ system }: VisualInspectorProps) {
  const id = useId()
  const spacingTokens = [
    ...(system.spacing.base_unit ? [system.spacing.base_unit] : []),
    ...system.spacing.tokens,
    ...system.spacing.section_padding,
    ...system.spacing.card_padding,
    ...system.spacing.button_padding,
  ]
  const observedComponents = system.components

  return (
    <div className="visual-inspector" aria-label="Visual design system inspector">
      <section className="inspector-overview" aria-labelledby={`${id}-overview-title`}>
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

      <section className="inspector-section" aria-labelledby={`${id}-colors-title`}>
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

      <section className="inspector-section" aria-labelledby={`${id}-type-title`}>
        <SectionHeading
          id={`${id}-type-title`}
          index="02"
          title="Typography"
          description="The detected scale is rendered at a bounded preview size while preserving its exact values."
        />
        {system.typography.scale.length ? (
          <div className="type-scale">
            {system.typography.scale.map((spec) => (
              <article className="type-sample" key={spec.name}>
                <p style={typographyStyle(spec)}>Aa — Design systems stay coherent.</p>
                <div>
                  <strong>{spec.name}</strong>
                  <span>{spec.use}</span>
                  <code>
                    {tokenValue(spec.size?.value ?? '—')} / {tokenValue(spec.weight?.value ?? '—')} / {tokenValue(spec.line_height?.value ?? '—')} / {tokenValue(spec.letter_spacing?.value ?? '—')}
                  </code>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="inspector-empty">Not enough evidence to build a type scale.</p>
        )}
      </section>

      <section className="inspector-section" aria-labelledby={`${id}-spacing-title`}>
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
                {spacingTokens.map((token, index) => {
                  const width = Math.min(220, Math.max(6, visualPixels(token.value, 18 + index * 10)))
                  return (
                    <div className="spacing-row" key={`${tokenLabel(token)}-${index}`}>
                      <span className="spacing-bar" style={{ width: `${width}px` }} aria-hidden="true" />
                      <span>{tokenLabel(token)}</span>
                      <code>{tokenValue(token.value)}</code>
                      <TokenCopyButton value={tokenValue(token.value)} label={`${tokenLabel(token)} spacing token`} />
                    </div>
                  )
                })}
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
                    <span style={{ borderRadius: tokenValue(token.value) }} aria-hidden="true" />
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

      <section className="inspector-section" aria-labelledby={`${id}-elevation-title`}>
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

      <section className="inspector-section" aria-labelledby={`${id}-components-title`}>
        <SectionHeading
          id={`${id}-components-title`}
          index="05"
          title="Observed components"
          description="Only states supported by the captured evidence are marked as observed."
        />
        {observedComponents.length ? (
          <div className="component-list">
            {observedComponents.map((component) => (
              <article className="component-card" key={component.name}>
                <div className="component-heading">
                  <div>
                    <h4>{component.name}</h4>
                    <p>{component.description}</p>
                  </div>
                  {statusForComponent(component.status, component.confidence)}
                </div>
                {component.values.length ? (
                  <div className="component-values">
                    {component.values.map((token, index) => (
                      <EvidenceLine token={token} key={`${tokenLabel(token)}-${index}`} />
                    ))}
                  </div>
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
            ))}
          </div>
        ) : (
          <p className="inspector-empty">Not enough evidence to describe components.</p>
        )}
      </section>

      <section className="inspector-section" aria-labelledby={`${id}-responsive-title`}>
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
                    <span aria-hidden="true" />
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

      <section className="inspector-section inspector-evidence" aria-labelledby={`${id}-evidence-title`}>
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
