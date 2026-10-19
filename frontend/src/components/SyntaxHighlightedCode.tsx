import { Fragment } from 'react'

type CodeLanguage = 'markdown' | 'css' | 'json'

interface SyntaxHighlightedCodeProps {
  content: string
  language: CodeLanguage
  label: string
}

interface CodeToken {
  value: string
  kind?: string
}

const JSON_PATTERN = /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b(?:true|false|null)\b|[{}[\],:])/gi
const CSS_PATTERN = /(\/\*[\s\S]*?\*\/|@[a-z-]+|--[a-z0-9-]+|#[0-9a-f]{3,8}\b|-?\b\d*\.?\d+(?:px|rem|em|%|vh|vw|s|ms)?\b|[{}:;,])/gi
const MARKDOWN_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|^#{1,6}\s+|^\s*[-*+]\s+|^\s*\d+\.\s+)/gm

function classify(value: string, language: CodeLanguage): string {
  if (language === 'json') {
    if (value.startsWith('"')) return value.match(/"\s*$/) ? 'string' : 'string'
    if (/^-?\d/.test(value)) return 'number'
    if (/^(true|false|null)$/i.test(value)) return 'literal'
    return 'punctuation'
  }

  if (language === 'css') {
    if (value.startsWith('/*')) return 'comment'
    if (value.startsWith('@')) return 'keyword'
    if (value.startsWith('--')) return 'property'
    if (value.startsWith('#')) return 'color'
    if (/^-?\d/.test(value)) return 'number'
    return 'punctuation'
  }

  if (value.startsWith('#')) return 'keyword'
  if (value.startsWith('`')) return 'string'
  if (value.startsWith('**')) return 'property'
  if (value.startsWith('[')) return 'color'
  return 'punctuation'
}

function tokenize(content: string, language: CodeLanguage): CodeToken[] {
  const pattern =
    language === 'json'
      ? JSON_PATTERN
      : language === 'css'
        ? CSS_PATTERN
        : MARKDOWN_PATTERN
  const tokens: CodeToken[] = []
  let cursor = 0

  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ value: content.slice(cursor, index) })
    tokens.push({ value: match[0], kind: classify(match[0], language) })
    cursor = index + match[0].length
  }

  if (cursor < content.length) tokens.push({ value: content.slice(cursor) })
  return tokens
}

export default function SyntaxHighlightedCode({
  content,
  language,
  label,
}: SyntaxHighlightedCodeProps) {
  return (
    <pre className="technical-preview" tabIndex={0} aria-label={label}>
      <code data-language={language}>
        {tokenize(content, language).map((token, index) => (
          <Fragment key={`${index}-${token.value.slice(0, 8)}`}>
            {token.kind ? (
              <span className={`syntax-${token.kind}`}>{token.value}</span>
            ) : (
              token.value
            )}
          </Fragment>
        ))}
      </code>
    </pre>
  )
}
