import type { EvidenceStatus } from '../types'

interface EvidenceBadgeProps {
  status: EvidenceStatus
  confidence: number
}

const STATUS_DESCRIPTIONS: Record<EvidenceStatus, string> = {
  detected: 'Found in the captured source or measured CSS.',
  inferred: 'Deduced from evidence; not directly measured.',
  interpreted: 'A visual judgment or suggestion made by the AI.',
}

const STATUS_LABELS: Record<EvidenceStatus, string> = {
  detected: 'Detected',
  inferred: 'Inferred',
  interpreted: 'AI interpretation',
}

export default function EvidenceBadge({
  status,
  confidence,
}: EvidenceBadgeProps) {
  const percentage = Math.round(Math.min(1, Math.max(0, confidence)) * 100)

  return (
    <span className={`evidence-badge evidence-${status}`} title={`${STATUS_DESCRIPTIONS[status]} Recorded confidence: ${percentage}%. Not a verified accuracy score.`}>
      <span>{STATUS_LABELS[status]}</span>
      <span aria-label={`${percentage} percent confidence`}>{percentage}%</span>
    </span>
  )
}
