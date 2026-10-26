import { downloadFile } from '../download'
import {
  Check,
  Copy,
  DownloadSimple,
  Warning,
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

interface DownloadButtonProps {
  content: string
  filename: string
  mimeType?: string
  downloadLabel?: string
  contentLabel?: string
}
export default function DownloadButton({
  content,
  filename,
  mimeType = 'text/markdown;charset=utf-8',
  downloadLabel = 'Download .md',
  contentLabel = 'visible output',
}: DownloadButtonProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloaded' | 'failed'>('idle')
  const disabled = content.length === 0
  const visibleCopyStatus = disabled ? 'idle' : copyStatus
  const visibleDownloadStatus = disabled ? 'idle' : downloadStatus

  useEffect(() => {
    if (copyStatus === 'idle' && downloadStatus === 'idle') return
    const timeout = window.setTimeout(() => {
      setCopyStatus('idle')
      setDownloadStatus('idle')
    }, 2400)
    return () => window.clearTimeout(timeout)
  }, [copyStatus, downloadStatus])

  const handleDownload = () => {
    try {
      downloadFile(content, filename, mimeType)
      setDownloadStatus('downloaded')
    } catch {
      setDownloadStatus('failed')
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  return (
    <div className="output-actions">
      <button
        type="button"
        onClick={handleCopy}
        className="copy-button"
        aria-label={visibleCopyStatus === 'failed' ? 'Copy failed' : undefined}
        disabled={disabled}
      >
        {visibleCopyStatus === 'copied' ? (
          <Check size={16} weight="bold" aria-hidden="true" />
        ) : visibleCopyStatus === 'failed' ? (
          <Warning size={16} weight="bold" aria-hidden="true" />
        ) : (
          <Copy size={16} weight="bold" aria-hidden="true" />
        )}
        {visibleCopyStatus === 'copied'
          ? 'Copied'
          : visibleCopyStatus === 'failed'
            ? 'Failed'
            : 'Copy'}
      </button>
      <button
        type="button"
        onClick={handleDownload}
        className="action-button bg-[var(--ink)] text-[var(--paper)]"
        disabled={disabled}
      >
        {visibleDownloadStatus === 'failed' ? (
          <Warning size={16} weight="bold" aria-hidden="true" />
        ) : visibleDownloadStatus === 'downloaded' ? (
          <Check size={16} weight="bold" aria-hidden="true" />
        ) : (
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
        )}
        {visibleDownloadStatus === 'failed'
          ? 'Download failed'
          : visibleDownloadStatus === 'downloaded'
            ? 'Downloaded'
            : downloadLabel}
      </button>
      <span className="sr-only" aria-live="polite">
        {disabled
          ? `${contentLabel} is unavailable.`
          : visibleCopyStatus === 'copied'
          ? `${contentLabel} copied to clipboard.`
          : visibleCopyStatus === 'failed'
            ? `Could not copy ${contentLabel}.`
            : visibleDownloadStatus === 'downloaded'
              ? `${filename} downloaded.`
              : visibleDownloadStatus === 'failed'
                ? `Could not download ${filename}.`
                : ''}
      </span>
    </div>
  )
}
