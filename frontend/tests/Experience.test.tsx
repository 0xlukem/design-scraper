import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../src/App'

afterEach(() => vi.restoreAllMocks())

it('keeps Design Scraper and Mix It as distinct visual experiences', () => {
  const { container } = render(<App />)
  const shell = container.querySelector('[data-experience]')!
  expect(shell).toHaveAttribute('data-experience', 'single')
  expect(shell).toHaveClass('theme-sober')
  expect(container.querySelector('.studio-scene')).toBeInTheDocument()
  expect(container.querySelector('.mix-world')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Design, decoded.', exact: true })).toBeVisible()

  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Enter Mix It', exact: true }))
  expect(shell).toHaveAttribute('data-experience', 'mix')
  expect(shell).toHaveClass('theme-wild')
  expect(container.querySelector('.mix-world')).toBeInTheDocument()
  expect(container.querySelector('.studio-scene')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'MIX IT UP.', exact: true })).toBeVisible()
})

it('preserves both forms and their blend balance during rapid world changes without submitting', () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
  render(<App />)
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://single.example' } })
  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Enter Mix It', exact: true }))
  fireEvent.change(screen.getByLabelText('First website URL'), { target: { value: 'https://first.example' } })
  fireEvent.change(screen.getByLabelText('Second website URL'), { target: { value: 'https://second.example' } })
  fireEvent.change(screen.getByLabelText('Mix balance'), { target: { value: '-25' } })
  for (let i = 0; i < 3; i++) {
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Back to Design Scraper', exact: true }))
    expect(screen.getByLabelText('Website URL')).toHaveValue('https://single.example')
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Enter Mix It', exact: true }))
  }
  expect(screen.getByLabelText('First website URL')).toHaveValue('https://first.example')
  expect(screen.getByLabelText('Second website URL')).toHaveValue('https://second.example')
  expect(screen.getByLabelText('Mix balance')).toHaveValue('-25')
  expect(fetcher).not.toHaveBeenCalled()
})

it('bypasses the paint transition with reduced motion and retains a usable form', () => {
  const { container } = render(<App />)
  expect(container.querySelector('.world-transition')).toHaveAttribute('data-state', 'idle')
  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Enter Mix It', exact: true }))
  expect(container.querySelector('.world-transition')).toHaveAttribute('data-state', 'idle')
  expect(screen.getByLabelText('First website URL')).toBeEnabled()
  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Back to Design Scraper', exact: true }))
  expect(container.querySelector('.world-transition')).toHaveAttribute('data-state', 'idle')
  expect(screen.getByLabelText('Website URL')).toBeEnabled()
})

it('keeps each home link in its own world and provides an explicit footer return', () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const { container } = render(<App />)
  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Enter Mix It', exact: true }))
  fireEvent.click(screen.getByRole('link', { name: 'Mix It home', exact: true }))
  expect(container.querySelector('[data-experience]')).toHaveAttribute('data-experience', 'mix')
  fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Back to Design Scraper', exact: true }))
  expect(container.querySelector('[data-experience]')).toHaveAttribute('data-experience', 'single')
  expect(screen.getByRole('link', { name: 'Design Scraper home', exact: true })).toBeInTheDocument()
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
})

it('switches the world immediately when the paint cannot play, without a pending target', () => {
  const { container } = render(<App />)
  const shell = container.querySelector('[data-experience]')!
  fireEvent.click(screen.getByRole('tab', { name: 'Mix It', exact: true }))
  expect(shell).toHaveAttribute('data-experience', 'mix')
  expect(container.querySelector('.world-transition')).toHaveAttribute('data-target', 'mix')
  fireEvent.click(screen.getByRole('tab', { name: 'Extract design', exact: true }))
  expect(shell).toHaveAttribute('data-experience', 'single')
  expect(container.querySelector('.world-transition')).toHaveAttribute('data-target', 'single')
})
