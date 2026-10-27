import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResultPanel from '../src/components/ResultPanel'
import { resultFixture } from './resultFixture'

function renderResult() {
  return render(
    <ResultPanel
      mode="single"
      loading={false}
      error={null}
      result={resultFixture}
      onRetry={vi.fn()}
    />,
  )
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('ResultPanel experience', () => {
  it('opens export on demand, preserves visual evidence and returns focus on close', () => {
    renderResult()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible()
    screen.getByRole('button', { name: 'Export design', exact: true }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Export design', exact: true }))
    for (const name of ['DESIGN.md', 'Tailwind v4', 'CSS Variables', 'Design Tokens', 'DESIGN.md']) {
      fireEvent.click(screen.getByRole('tab', { name, exact: true }))
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close export' }))
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export design', exact: true })).toHaveFocus()
    screen.getByRole('button', { name: 'Export design', exact: true }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Export design', exact: true }))
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps matching gap codes for different sources distinct and attributed', () => {
    const result = structuredClone(resultFixture)
    result.design_system!.known_gaps = [
      { code: 'capture-sections', message: 'First source limitation.', source: ['web_1'] },
      { code: 'capture-sections', message: 'Second source limitation.', source: ['web_2'] },
    ]
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<ResultPanel mode="single" loading={false} error={null} result={result} onRetry={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Evidence & gaps' }))
      expect(screen.getByText('Source: https://example.com/')).toBeInTheDocument()
      expect(screen.getByText('Source: web 2')).toBeInTheDocument()
      expect(error).not.toHaveBeenCalled()
    } finally { error.mockRestore() }
  })
  it('names every inspector region uniquely when saved and active results coexist', () => {
    const { container } = render(<>
      <ResultPanel mode="single" loading={false} error={null} result={resultFixture} onRetry={vi.fn()} />
      <ResultPanel mode="single" loading={false} error={null} result={resultFixture} historical onRetry={vi.fn()} />
    </>)
    const inspectors = container.querySelectorAll('.visual-inspector')
    expect(inspectors).toHaveLength(2)
    const regions = [...container.querySelectorAll('.visual-inspector section[aria-labelledby]')]
    expect(regions).toHaveLength(2)
    const ids = regions.map(region => region.getAttribute('aria-labelledby')!)
    expect(new Set(ids).size).toBe(ids.length)
    regions.forEach((region, index) => {
      const heading = document.getElementById(ids[index])
      expect(heading).toHaveProperty('tagName', 'H3')
      expect(region).toContainElement(heading)
      expect(region).toHaveAccessibleName(heading!.textContent!)
    })
  })
  it('renders valid typography entries with missing dimensions without crashing', () => {
    const result = structuredClone(resultFixture)
    const spec = result.design_system!.typography.scale[0]
    spec.size = null
    spec.line_height = null
    render(<ResultPanel mode="single" loading={false} error={null} result={result} onRetry={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Typography', exact: true }))
    expect(screen.getByRole('heading', { name: 'Typography' })).toBeInTheDocument()
    expect(screen.getAllByText(/Aa — Design/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Export design' }))
    expect(screen.getByLabelText('DESIGN.md raw output')).toBeInTheDocument()
  })
  it('shows provider usage, screenshots, and transparent estimated cost', () => {
    render(<ResultPanel mode="single" loading={false} error={null} result={resultFixture} historical onRetry={vi.fn()} />)
    fireEvent.click(screen.getByText('Original analysis usage'))

    expect(screen.getByRole('heading', { name: 'This analysis used 18,400 tokens.' })).toBeInTheDocument()
    expect(screen.getByText('Exact provider usage')).toBeInTheDocument()
    expect(screen.getByText('13,200')).toBeInTheDocument()
    expect(screen.getByText('5,200')).toBeInTheDocument()
    expect(screen.getByText('US$0.02')).toBeInTheDocument()
    expect(screen.getByText('Always estimated')).toBeInTheDocument()
    expect(screen.getByText(/Provider:/)).toHaveTextContent('gemini-2.5-flash')
    expect(screen.getByText(/Consumption depends on the model/)).toBeInTheDocument()
  })

  it('shows a concise overview and opens each section with accurate evidence labels', () => {
    renderResult()
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Colors' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Colors', exact: true }))
    expect(screen.getByRole('heading', { name: 'Brand' })).toBeVisible()
    expect(screen.getByText('Brand primary')).toBeVisible()
    expect(screen.getAllByLabelText('92 percent confidence').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Components', exact: true }))
    expect(screen.getByText('active/pressed')).toBeVisible()
    expect(screen.getByText('Not observed')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Responsive', exact: true }))
    expect(screen.getByRole('heading', { name: 'Detected rules' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Evidence & gaps', exact: true }))
    expect(screen.getByText('focus-evidence-limited')).toBeInTheDocument()
  })

  it('shows the exact selected format in Raw with format-specific highlighting', () => {
    const { container } = renderResult()
    fireEvent.click(screen.getByRole('button', { name: 'Export design' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Design Tokens' }))

    const raw = screen.getByLabelText('Design Tokens raw output')
    expect(raw).toHaveTextContent('"brand-primary": { "$value": "#b84a32" }')
    expect(container.querySelector('code[data-language="json"]')).toBeInTheDocument()
    expect(container.querySelector('.syntax-string')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download tokens.json' })).toBeInTheDocument()
  })

  it('changes Compact and Extended locally and copies the visible variant', async () => {
    renderResult()
    fireEvent.click(screen.getByRole('button', { name: 'Export design' }))
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))

    expect(screen.getByLabelText('DESIGN.md raw output')).toHaveTextContent('# Compact system')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '# Compact system\n\nCompact body.',
    )
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('supports arrow-key navigation across all output tabs', () => {
    renderResult()
    fireEvent.click(screen.getByRole('button', { name: 'Export design' }))
    const markdownTab = screen.getByRole('tab', { name: 'DESIGN.md' })
    markdownTab.focus()
    fireEvent.keyDown(markdownTab, { key: 'ArrowRight' })

    const tailwindTab = screen.getByRole('tab', { name: 'Tailwind v4' })
    expect(tailwindTab).toHaveAttribute('aria-selected', 'true')
    expect(tailwindTab).toHaveFocus()

    fireEvent.keyDown(tailwindTab, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Design Tokens' })).toHaveFocus()
  })

  it('copies an individual visual token without changing the selected output', () => {
    renderResult()
    fireEvent.click(screen.getByRole('button', { name: 'Colors', exact: true }))
    const brandRow = screen.getByText('Brand primary').closest('.token-evidence-line')
    expect(brandRow).not.toBeNull()
    fireEvent.click(within(brandRow as HTMLElement).getByRole('button', { name: /copy brand-primary token/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('#b84a32')
    expect(screen.getByRole('button', { name: 'Export design', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the original export for legacy responses without normalized data', () => {
    render(
      <ResultPanel
        mode="single"
        loading={false}
        error={null}
        result={{ ...resultFixture, design_system: null }}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Export design', exact: true })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('DESIGN.md raw output')).toBeInTheDocument()
  })
})

it('keeps interpreted responsive changes out of detected rules and follows token provenance', () => {
  const result = structuredClone(resultFixture)
  result.design_system!.responsive.changes[0].status = 'interpreted'
  render(<ResultPanel mode="single" loading={false} error={null} result={result} onRetry={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Responsive', exact: true }))
  expect(screen.queryByRole('heading', { name: 'Detected rules' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'AI interpretations' })).toBeVisible()
  fireEvent.click(screen.getByText('Evidence · AI interpretation'))
  const token = screen.getByText('Evidence · AI interpretation').closest('.token-evidence-line')!
  fireEvent.click(within(token as HTMLElement).getByRole('button', { name: 'View source & gaps' }))
  expect(screen.getByRole('heading', { name: 'Evidence & gaps' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Show all sources' })).toBeVisible()
})

it('copies all five exports byte-for-byte without changing the underlying result', async () => {
  renderResult()
  fireEvent.click(screen.getByRole('button', { name: 'Export design', exact: true }))
  const formats = [
    ['DESIGN.md', resultFixture.documents!.extended],
    ['Tailwind v4', resultFixture.exports!.tailwind],
    ['CSS Variables', resultFixture.exports!.css_variables],
    ['Design Tokens', resultFixture.exports!.design_tokens],
  ] as const
  for (const [name, content] of formats) {
    fireEvent.click(screen.getByRole('tab', { name, exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy', exact: true }))
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(content)
    await screen.findByRole('button', { name: 'Copied' })
  }
  fireEvent.click(screen.getByRole('tab', { name: 'DESIGN.md' }))
  fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy', exact: true }))
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(resultFixture.documents!.compact)
})
