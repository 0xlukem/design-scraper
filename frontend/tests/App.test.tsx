import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'

const mixedResponse = {
  success: true,
  design_md: '# Mixed system\n\n#### Blend Manifest',
  exports: {
    css_variables: ':root { --ds-color-brand-primary: #112233; }\n',
    tailwind: '@theme { --color-brand-primary: #112233; }\n',
    design_tokens: '{\n  "tokens": {\n    "color": {}\n  }\n}\n',
  },
  metadata: {
    mode: 'mix',
    bias: -25,
    weights: { web_1: 75, web_2: 25 },
    sources: [
      {
        slot: 'web_1',
        url: 'https://one.example/',
        influence: 75,
        status: 'analyzed',
        title: 'One',
        description: '',
        colors_extracted: 4,
        fonts_extracted: 2,
      },
      {
        slot: 'web_2',
        url: 'https://two.example/',
        influence: 25,
        status: 'analyzed',
        title: 'Two',
        description: '',
        colors_extracted: 3,
        fonts_extracted: 1,
      },
    ],
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('App', () => {
  it('opens the minimal Design Scraper experience with a clear next action', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: 'Design, decoded.', exact: true }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Website URL')).toBeInTheDocument()
    expect(
      screen.getAllByText('A little input. A whole design language.')[0],
    ).toBeInTheDocument()
  })

  it('switches complete modes and preserves each mode state', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Website URL'), {
      target: { value: 'https://single.example' },
    })

    fireEvent.click(screen.getByRole('tab', { name: /mix it/i }))
    expect(
      await screen.findByRole('heading', { name: 'MIX IT UP.', exact: true }),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('First website URL'), {
      target: { value: 'https://one.example' },
    })

    fireEvent.click(screen.getByRole('tab', { name: /extract design/i }))
    expect(await screen.findByLabelText('Website URL')).toHaveValue(
      'https://single.example',
    )

    fireEvent.click(screen.getByRole('tab', { name: /mix it/i }))
    expect(await screen.findByLabelText('First website URL')).toHaveValue(
      'https://one.example',
    )
  })

  it('wraps mode tabs with arrow keys and supports Home and End without submitting', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    render(<App />)
    const single = screen.getByRole('tab', { name: 'Extract design' })
    const mix = screen.getByRole('tab', { name: 'Mix It' })
    single.focus()
    fireEvent.keyDown(single, { key: 'ArrowLeft' })
    expect(mix).toHaveFocus()
    expect(mix).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(mix, { key: 'ArrowRight' })
    expect(single).toHaveFocus()
    expect(single).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(single, { key: 'End' })
    expect(mix).toHaveFocus()
    fireEvent.keyDown(mix, { key: 'Home' })
    expect(single).toHaveFocus()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('submits the exact two-source payload for a slider stop', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mixedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /mix it/i }))
    fireEvent.change(await screen.findByLabelText('First website URL'), {
      target: { value: 'https://one.example' },
    })
    fireEvent.change(screen.getByLabelText('Second website URL'), {
      target: { value: 'https://two.example' },
    })
    fireEvent.change(screen.getByLabelText('Mix balance'), {
      target: { value: '-25' },
    })
    expect(screen.getByText('Web #1')).toHaveTextContent('75%')
    expect(screen.getByText('Web #2')).toHaveTextContent('25%')

    fireEvent.click(
      screen.getByRole('button', { name: /mix designs/i }),
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(options?.body))).toEqual({
      url_1: 'https://one.example',
      url_2: 'https://two.example',
      bias: -25,
    })
    expect(
      await screen.findByRole('heading', { name: 'one.example + two.example' }),
    ).toBeInTheDocument()
  })

  it('shows a structured server error without retrying an unsafe URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: 'UNSAFE_URL',
            message: 'Private and reserved network addresses are not allowed.',
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(<App />)
    fireEvent.change(screen.getByLabelText('Website URL'), {
      target: { value: 'https://unsafe.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /analyze design/i }))

    expect(
      await screen.findByText(
        'Private and reserved network addresses are not allowed.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByText('Issue: UNSAFE_URL')).toBeInTheDocument()
  })

  it('honors a retry deadline for primary submit and both worlds, then allows another request', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ detail: { code: 'RATE_LIMITED', message: 'Please wait before another analysis.', retryable: true } }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } },
    ))
    render(<App />)
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /analyze design/i })) })
    expect(screen.getByRole('button', { name: /analyze design/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retry in 2s' })).toBeDisabled()
    expect(screen.getByText(/New analyses are available in 2s/)).toBeInTheDocument()
    fireEvent.submit(screen.getByLabelText('Website URL').closest('form')!)
    fireEvent.click(screen.getByRole('tab', { name: 'Mix It' }))
    fireEvent.change(screen.getByLabelText('First website URL'), { target: { value: 'https://one.example' } })
    fireEvent.change(screen.getByLabelText('Second website URL'), { target: { value: 'https://two.example' } })
    expect(screen.getByRole('button', { name: /mix designs/i })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText('First website URL').closest('form')!)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(screen.getByRole('button', { name: /mix designs/i })).toBeEnabled()
    expect(screen.queryByText(/New analyses are available in/)).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /mix designs/i })) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('switches technical outputs locally without another analysis request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mixedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /mix it/i }))
    fireEvent.change(await screen.findByLabelText('First website URL'), {
      target: { value: 'https://one.example' },
    })
    fireEvent.change(screen.getByLabelText('Second website URL'), {
      target: { value: 'https://two.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /mix designs/i }))

    await screen.findByRole('tab', { name: 'CSS Variables' })
    fireEvent.click(screen.getByRole('tab', { name: 'CSS Variables' }))

    expect(screen.getByText(/--ds-color-brand-primary/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download design-variables.css' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight request without showing an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    render(<App />)
    fireEvent.change(screen.getByLabelText('Website URL'), {
      target: { value: 'https://slow.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /analyze design/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop waiting' }))

    await waitFor(() =>
      expect(
        screen.getAllByText('A little input. A whole design language.')[0],
      ).toBeInTheDocument(),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
