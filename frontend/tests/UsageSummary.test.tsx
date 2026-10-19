import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import UsageSummary from '../src/components/UsageSummary'

describe('UsageSummary', () => {
  it('labels fallback metrics as approximate and does not invent a cost', () => {
    render(
      <UsageSummary
        usage={{
          provider: 'custom',
          model: 'vision-preview',
          input_tokens: 1002,
          output_tokens: 1,
          total_tokens: 1003,
          reasoning_tokens: null,
          status: 'estimated',
          estimated_cost_usd: null,
          cost_status: 'unavailable',
          pricing_source: null,
          sources_count: 2,
          screenshots_sent: 1,
          notes: ['Token usage is estimated because the provider did not return complete usage metadata.'],
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'This analysis used approximately 1,003 tokens.' })).toBeInTheDocument()
    expect(screen.getByText('Estimated usage')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('2 / 1')).toBeInTheDocument()
  })
})
