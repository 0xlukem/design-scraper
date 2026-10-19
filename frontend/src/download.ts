import type { AnalysisResult } from './types'

export function downloadFile(content: string, filename: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadFormats = [
  { id: 'extended', label: 'design.md', mime: 'text/markdown;charset=utf-8' },
  { id: 'compact', label: 'design-compact.md', mime: 'text/markdown;charset=utf-8' },
  { id: 'tailwind', label: 'tailwind-theme.css', mime: 'text/css;charset=utf-8' },
  { id: 'css_variables', label: 'design-variables.css', mime: 'text/css;charset=utf-8' },
  { id: 'design_tokens', label: 'tokens.json', mime: 'application/json;charset=utf-8' },
] as const
export type DownloadFormat = typeof downloadFormats[number]['id']
export function savedContent(result: AnalysisResult, format: DownloadFormat) {
  if (format === 'extended') return result.documents?.extended || result.design_md
  if (format === 'compact') return result.documents?.compact
  return result.exports?.[format]
}
