import type { MixBias } from './types'

function comparableUrl(value: string) {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch {
    return null
  }
}

export function mixInputIssue(url1: string, url2: string, bias: MixBias) {
  const first = comparableUrl(url1)
  const second = comparableUrl(url2)
  if ((bias !== 50 && !first) || (bias !== -50 && !second)) return 'invalid'
  if (bias !== 50 && bias !== -50 && first === second) return 'duplicate'
  return null
}
