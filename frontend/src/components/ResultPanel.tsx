import TelemetrySummary from './TelemetrySummary'
import AnalysisErrorPanel from './AnalysisErrorPanel'
import type { AnalysisIssue } from '../analysisError'
import {
  Scan,
} from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type {
  AnalyzeMetadata,
  AnalysisResult,
  AnalysisProgress,
  AppMode,
  MixMetadata,
  OutputFormat,
} from '../types'
import DownloadButton from './DownloadButton'
import LoadingSkeleton from './LoadingSkeleton'
import SyntaxHighlightedCode from './SyntaxHighlightedCode'
import UsageSummary from './UsageSummary'
import VisualInspector from './VisualInspector'
import './results.css'

interface ResultPanelProps {
  mode: AppMode
  loading: boolean
  error: AnalysisIssue | null
  result: AnalysisResult | null
  progress?: AnalysisProgress
  startedAt?: number
  retryDisabled?: boolean
  historical?: boolean
  onRetry: () => void
  onReviewSettings?: () => void
  onReviewUrl?: () => void
  onCancel?: () => void
  cancelled?: boolean
  active?: boolean
  title?: string
  scrollToResult?: boolean
  headingLevel?: 'h1' | 'h2'
}

function isMixResult(result: AnalysisResult): result is AnalysisResult & {
  metadata: MixMetadata
} {
  return 'mode' in result.metadata && result.metadata.mode === 'mix'
}

interface OutputDefinition {
  id: OutputFormat
  label: string
  content: string
  filename: string
  mimeType: string
  downloadLabel: string
  language: 'markdown' | 'css' | 'json'
}

type DocumentVariant = 'compact' | 'extended'
type OutputView = 'visual' | 'raw'

function outputDefinitions(
  result: AnalysisResult,
  documentVariant: DocumentVariant,
): OutputDefinition[] {
  const outputs: OutputDefinition[] = [
    {
      id: 'markdown',
      label: 'DESIGN.md',
      content:
        result.documents?.[documentVariant] ||
        result.documents?.extended ||
        result.design_md,
      filename: documentVariant === 'compact' ? 'design-compact.md' : 'design.md',
      mimeType: 'text/markdown;charset=utf-8',
      downloadLabel: documentVariant === 'compact' ? 'Download design-compact.md' : 'Download design.md',
      language: 'markdown',
    },
  ]

  if (!result.exports) return outputs

  return outputs.concat([
    {
      id: 'tailwind',
      label: 'Tailwind v4',
      content: result.exports.tailwind,
      filename: 'tailwind-theme.css',
      mimeType: 'text/css;charset=utf-8',
      downloadLabel: 'Download tailwind-theme.css',
      language: 'css',
    },
    {
      id: 'css_variables',
      label: 'CSS Variables',
      content: result.exports.css_variables,
      filename: 'design-variables.css',
      mimeType: 'text/css;charset=utf-8',
      downloadLabel: 'Download design-variables.css',
      language: 'css',
    },
    {
      id: 'design_tokens',
      label: 'Design Tokens',
      content: result.exports.design_tokens,
      filename: 'tokens.json',
      mimeType: 'application/json;charset=utf-8',
      downloadLabel: 'Download tokens.json',
      language: 'json',
    },
  ])
}

export default function ResultPanel({
  mode,
  loading,
  error,
  result,
  onRetry,
  progress,
  startedAt,
  retryDisabled = false,
  historical = false,
  onReviewSettings, onReviewUrl, onCancel, cancelled = false, active = true, title, headingLevel: Heading = 'h2', scrollToResult = !historical,
}: ResultPanelProps) {
  const panelId = useId().replace(/:/g, '')
  const controls = useRef<HTMLHeadingElement>(null)
  const exportOrigin = useRef<HTMLElement | null>(null)
  const exportScroll = useRef({ x: 0, y: 0 })
  const dialog = useRef<HTMLDialogElement>(null)
  const [selection, setSelection] = useState<{
    result: AnalysisResult | null
    format: OutputFormat
    documentVariant: DocumentVariant
    view: OutputView
  }>({
    result: null,
    format: 'markdown',
    documentVariant: 'extended',
    view: 'visual',
  })

  const exportsOpen = Boolean(result && (selection.result === result ? selection.view === 'raw' : !result.design_system))
  useEffect(() => {
    if (active && result && !loading && !error && !cancelled && !controls.current?.closest('[hidden]')) {
      controls.current?.focus({ preventScroll: true })
      if (scrollToResult) controls.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }, [result, loading, error, cancelled, active, scrollToResult])
  useEffect(() => {
    if (exportsOpen && active) {
      dialog.current?.showModal()
      window.scrollTo?.({ left: exportScroll.current.x, top: exportScroll.current.y, behavior: 'instant' })
    }
    else dialog.current?.close()
  }, [exportsOpen, active])

  if (loading) return <LoadingSkeleton isMix={mode === 'mix'} startedAt={startedAt} progress={progress} onCancel={onCancel} />

  if (error) return <AnalysisErrorPanel issue={error} onRetry={onRetry} disabled={retryDisabled} onReviewSettings={onReviewSettings} onReviewUrl={onReviewUrl} />

  if (cancelled) return <section className="stopped-result" role="status"><h2>You stopped waiting</h2><p>Remote work may continue. Activity keeps the last received usage.</p><a href="#/activity" className="secondary-button">View activity</a><button className="text-button" type="button" onClick={onRetry} disabled={retryDisabled}>Analyze again</button></section>

  if (!result) return (
    <section className="findings-empty" aria-label="Design findings">
      <div className="findings-empty-heading">
        <h2>Design findings</h2>
        <span>No analysis yet</span>
      </div>
      <div className="findings-empty-body">
        <div className="findings-empty-symbol" aria-hidden="true"><Scan size={40} weight="light" /></div>
        <div>
          <p className="result-placeholder">A little input. A whole design language.</p>
          <p className="findings-scope">Analyze a website to inspect its typography, colors, spacing and components.</p>
        </div>
      </div>
      <div className="findings-formats" aria-label="Available export formats"><span>DESIGN.md</span><span>Compact Markdown</span><span>CSS variables</span><span>Tailwind CSS</span><span>Tokens JSON</span></div>
    </section>
  )

  const mixResult = isMixResult(result)
  const singleMetadata = mixResult
    ? null
    : (result.metadata as AnalyzeMetadata)
  const currentSelection =
    selection.result === result
      ? selection
      : {
          result,
          format: 'markdown' as OutputFormat,
          documentVariant: 'extended' as DocumentVariant,
          view: result.design_system ? ('visual' as OutputView) : ('raw' as OutputView),
        }
  const outputs = outputDefinitions(result, currentSelection.documentVariant)
  const activeOutput = currentSelection.format
  const selectedOutput =
    outputs.find((output) => output.id === activeOutput) || outputs[0]

  const downloadName = mixResult && selectedOutput.id === 'markdown'
    ? currentSelection.documentVariant === 'compact' ? 'mixed-design-compact.md' : 'mixed-design.md'
    : selectedOutput.filename

  const selectOutput = (format: OutputFormat) => {
    setSelection({ ...currentSelection, result, format })
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % outputs.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + outputs.length) % outputs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = outputs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    selectOutput(outputs[nextIndex].id)
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  const closeExport = () => {
    setSelection({ ...currentSelection, result, view: 'visual' })
    dialog.current?.close()
    exportOrigin.current?.focus({ preventScroll: true })
    window.scrollTo?.({ left: exportScroll.current.x, top: exportScroll.current.y, behavior: 'instant' })
    requestAnimationFrame(() => window.scrollTo?.({ left: exportScroll.current.x, top: exportScroll.current.y, behavior: 'instant' }))
  }
  const openExport = () => {
    exportOrigin.current = document.activeElement as HTMLElement
    exportScroll.current = { x: window.scrollX, y: window.scrollY }
    setSelection({ ...currentSelection, result, view: 'raw' })
  }
  const sources = mixResult ? result.metadata.sources.map(source => ({ label: source.slot, url: source.url, title: source.title })) : [{ label: 'web_1', url: singleMetadata?.url || '', title: singleMetadata?.title }]
  const sourceName = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
  const resultTitle = title || sources.map(source => sourceName(source.url)).filter(Boolean).join(' + ') || 'Design findings'

  return (
    <section className={`result-shell ${mixResult ? 'result-shell-wild' : ''}`}>
      <div className="result-heading">
        <Heading ref={controls} tabIndex={-1} className="result-title">{resultTitle}</Heading>
        <button type="button" className="action-button" aria-expanded={exportsOpen} aria-controls={`${panelId}-exports`} onClick={openExport}>Export design</button>
      </div>
      <div className="result-source-list">{sources.map(source => <span key={source.label}>{source.url}{mixResult && ` · ${result.metadata.sources.find(item => item.slot === source.label)?.influence}% influence`}</span>)}</div>
      <dialog ref={dialog} id={`${panelId}-exports`} className="export-dialog" aria-labelledby={`${panelId}-export-title`} onCancel={event => { event.preventDefault(); closeExport() }}>
        {exportsOpen && <>
        <div className="export-heading"><div><h3 id={`${panelId}-export-title`}>Export design</h3><p>{resultTitle}</p></div><button autoFocus type="button" className="text-button" onClick={closeExport}>Close export</button></div>
      <div className="output-navigation">
        <div className="output-tabs" role="tablist" aria-label="Design system outputs">
          {outputs.map((output, index) => (
              <button
                key={output.id}
                id={`${panelId}-output-tab-${output.id}`}
                type="button"
                role="tab"
                aria-selected={selectedOutput.id === output.id}
                aria-controls={`${panelId}-output-content`}
                tabIndex={selectedOutput.id === output.id ? 0 : -1}
                onClick={() => selectOutput(output.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`output-tab ${selectedOutput.id === output.id ? 'output-tab-active' : ''}`}
              >
                {output.label}
              </button>
            ))}
        </div>
        <div className="output-controls">
          {selectedOutput.id === 'markdown' ? (
            <div className="segmented-control" role="group" aria-label="Document length">
              {(['compact', 'extended'] as const).map((variant) => (
                <button
                  key={variant}
                  type="button"
                  aria-pressed={currentSelection.documentVariant === variant}
                  onClick={() => setSelection({ ...currentSelection, result, documentVariant: variant })}
                >
                  {variant === 'compact' ? 'Compact' : 'Extended'}
                </button>
              ))}
            </div>
          ) : (
            null
          )}
          <DownloadButton
            key={`${selectedOutput.id}-${currentSelection.documentVariant}`}
            content={selectedOutput.content} filename={downloadName} mimeType={selectedOutput.mimeType}
            downloadLabel={`Download ${downloadName}`} contentLabel={selectedOutput.label}
          />
        </div>
      </div>
      <div id={`${panelId}-output-content`} role="tabpanel" aria-labelledby={`${panelId}-output-tab-${selectedOutput.id}`}>
        <details className="export-preview" open={!result.design_system || undefined}><summary>Preview code</summary><SyntaxHighlightedCode content={selectedOutput.content} language={selectedOutput.language} label={`${selectedOutput.label} raw output`} /></details>
      </div>
      </>}</dialog>
      {result.design_system ? <VisualInspector key={resultTitle} system={result.design_system} sources={sources} onBackToControls={openExport} /> : <p className="field-help">This saved response has no visual evidence. Use Export design to open its original document.</p>}
      {historical ? <details className="provider-rates"><summary>Original analysis usage</summary><p className="field-help">Historical usage from the saved analysis. Opening or downloading this design adds no usage.</p>
        {result.telemetry && <TelemetrySummary telemetry={result.telemetry} />}
        {result.metadata.usage ? <UsageSummary usage={result.metadata.usage} /> : <p>Usage unavailable.</p>}
      </details> : <a href="#/activity" className="text-button result-activity-link">View analysis costs</a>}

    </section>
  )
}
