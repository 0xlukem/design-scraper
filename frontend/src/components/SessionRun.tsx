import type { UsageEntry } from './SessionUsage'
import ResultPanel from './ResultPanel'

export default function SessionRun({ entry, busy, onRestore }: { entry?: UsageEntry; busy: boolean; onRestore: (entry: UsageEntry, settings?: boolean) => void }) {
  return <section className="session-run-view" aria-label="Session analysis">
    <div className="session-run-navigation"><a href="#/activity" className="text-button">← Back to activity</a>{entry && <button type="button" className="text-button" disabled={busy} onClick={() => onRestore(entry)}>Use these URLs</button>}</div>
    {!entry ? <div className="usage-empty" role="status"><h2>This analysis is no longer in this session.</h2><p>Session results are cleared on reload.</p><a href="#/library" className="secondary-button">Explore saved designs</a></div>
      : entry.result ? <ResultPanel scrollToResult={false} mode={entry.mode || 'single'} loading={false} error={null} result={entry.result} onRetry={() => onRestore(entry)} />
      : <div className="session-issue"><span className="field-label">Analysis #{entry.id}</span><h2>{entry.issue?.category || 'You stopped waiting'}</h2><p>{entry.issue?.message || 'Remote work may continue. The last received usage is in this analysis’s run details.'}</p>
        <div className="session-run-actions"><button type="button" className="action-button" disabled={busy} onClick={() => onRestore(entry, Boolean(entry.issue && /PROVIDER|BYOK|AUTH/.test(entry.issue.code)))}>{entry.issue && /PROVIDER|BYOK|AUTH/.test(entry.issue.code) ? 'Review settings' : 'Review inputs'}</button><a className="text-button" href="#/library">Open saved designs</a></div>
        {entry.issue && <details className="provider-rates"><summary>Error details</summary><p>{entry.issue.code}</p><p>{entry.issue.guidance}</p></details>}
      </div>}
  </section>
}
