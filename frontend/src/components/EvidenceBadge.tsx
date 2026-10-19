import type { EvidenceStatus } from '../types'

interface EvidenceBadgeProps {
  status: EvidenceStatus
  confidence: number
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
    <span className={`evidence-badge evidence-${status}`}>
      <span>{STATUS_LABELS[status]}</span>
      <span aria-label={`${percentage} percent confidence`}>{percentage}%</span>
    </span>
  )
}
