import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DownloadButton from '../src/components/DownloadButton'

describe('DownloadButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports clipboard success inline without alert dialogs', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)

    render(<DownloadButton content="# Design" filename="design.md" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('# Design')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('reports clipboard failure through the accessible inline state', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })

    render(<DownloadButton content="# Design" filename="design.md" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument()
    expect(screen.getByText('Could not copy visible output.')).toBeInTheDocument()
  })

  it('downloads with the exact supplied filename and disables empty output', () => {
    let downloadedAs = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      downloadedAs = this.download
    })
    const { rerender } = render(
      <DownloadButton content="{}" filename="tokens.json" downloadLabel="Download tokens.json" />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Download tokens.json' }))
    expect(downloadedAs).toBe('tokens.json')

    rerender(<DownloadButton content="" filename="tokens.json" downloadLabel="Download tokens.json" />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download tokens.json' })).toBeDisabled()
  })
})
