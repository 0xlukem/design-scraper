import { Check, Copy, Warning } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

interface TokenCopyButtonProps {
  value: string
  label: string
}

export default function TokenCopyButton({ value, label }: TokenCopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timeout = window.setTimeout(() => setStatus('idle'), 2000)
    return () => window.clearTimeout(timeout)
  }, [status])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <span className="token-copy-action">
      <button
        type="button"
        className="token-copy-button"
        onClick={copy}
        aria-label={`${status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed for' : 'Copy'} ${label}`}
      >
        {status === 'copied' ? (
          <Check size={15} weight="bold" aria-hidden="true" />
        ) : status === 'failed' ? (
          <Warning size={15} weight="bold" aria-hidden="true" />
        ) : (
          <Copy size={15} weight="bold" aria-hidden="true" />
        )}
        <span>{status === 'copied' ? 'Copied' : status === 'failed' ? 'Failed' : 'Copy'}</span>
      </button>
      <span className="sr-only" aria-live="polite">
        {status === 'copied'
          ? `${label} copied to clipboard.`
          : status === 'failed'
            ? `Could not copy ${label}.`
            : ''}
      </span>
    </span>
  )
}
