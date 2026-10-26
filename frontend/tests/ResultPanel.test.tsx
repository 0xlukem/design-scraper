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
  it('preserves the chosen view across format and document-length changes', () => {
    renderResult()
    for (const name of ['DESIGN.md', 'Tailwind v4', 'CSS Variables', 'Design Tokens', 'DESIGN.md']) {
      fireEvent.click(screen.getByRole('tab', { name, exact: true }))
      expect(screen.getByRole('button', { name: 'View design', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('heading', { name: 'Color system' })).toBeVisible()
    }
    for (const name of ['Extended', 'Compact', 'Extended']) {
      fireEvent.click(screen.getByRole('button', { name, exact: true }))
      expect(screen.getByRole('button', { name: 'View design', exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    fireEvent.click(screen.getByRole('button', { name: 'View code', exact: true }))
    fireEvent.click(screen.getByRole('tab', { name: 'CSS Variables' }))
    expect(screen.getByLabelText('CSS Variables raw output')).toBeVisible()
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
      expect(screen.getByText('Source: web 1')).toBeInTheDocument()
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
    expect(regions).toHaveLength(16)
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
    expect(screen.getByRole('heading', { name: 'Typography' })).toBeInTheDocument()
    expect(screen.getAllByText(/Aa — Design systems stay coherent/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'View code' }))
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

  it('opens as a visual inspector with grouped evidence, observed states, and gaps', () => {
    renderResult()

    expect(screen.getByRole('button', { name: 'View design' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Color system' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Brand' })).toBeInTheDocument()
    expect(screen.getByText('brand-primary')).toBeInTheDocument()
    expect(screen.getAllByText('Detected').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('92 percent confidence').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Typography' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Spacing & shape' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Elevation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Observed components' })).toBeInTheDocument()
    expect(screen.getByText('active/pressed')).toBeInTheDocument()
    expect(screen.getByText('Not observed')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Responsive behavior' })).toBeInTheDocument()
    expect(screen.getByText('focus-evidence-limited')).toBeInTheDocument()
  })

  it('shows the exact selected format in Raw with format-specific highlighting', () => {
    const { container } = renderResult()
    fireEvent.click(screen.getByRole('tab', { name: 'Design Tokens' }))
    fireEvent.click(screen.getByRole('button', { name: 'View code' }))

    const raw = screen.getByLabelText('Design Tokens raw output')
    expect(raw).toHaveTextContent('"brand-primary": { "$value": "#b84a32" }')
    expect(container.querySelector('code[data-language="json"]')).toBeInTheDocument()
    expect(container.querySelector('.syntax-string')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download tokens.json' })).toBeInTheDocument()
  })

  it('changes Compact and Extended locally and copies the visible variant', async () => {
    renderResult()
    fireEvent.click(screen.getByRole('button', { name: 'View code' }))
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
    const brandRow = screen.getByText('brand-primary').closest('.token-evidence-line')
    expect(brandRow).not.toBeNull()
    fireEvent.click(within(brandRow as HTMLElement).getByRole('button', { name: /copy brand-primary token/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('#b84a32')
    expect(screen.getByRole('tab', { name: 'DESIGN.md' })).toHaveAttribute('aria-selected', 'true')
  })

  it('falls back to Raw and disables Visual for legacy responses without normalized data', () => {
    render(
      <ResultPanel
        mode="single"
        loading={false}
        error={null}
        result={{ ...resultFixture, design_system: null }}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'View design' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'View code' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('DESIGN.md raw output')).toBeInTheDocument()
  })
})
