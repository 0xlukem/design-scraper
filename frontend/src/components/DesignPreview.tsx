import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface DesignPreviewProps {
  content: string
}

export default function DesignPreview({ content }: DesignPreviewProps) {
  return (
    <div className="design-preview">
      <div className="prose prose-zinc max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-a:break-all prose-a:text-[var(--accent)] prose-code:font-mono">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
