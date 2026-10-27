import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ComponentPreview, { componentPreviewStyle } from '../src/components/ComponentPreview'
import TypographySample from '../src/components/TypographySample'
import ResultPanel from '../src/components/ResultPanel'
import { designSystemFixture } from './resultFixture'
import stripe from '../src/examples/stripe.json'
import milligram from '../src/examples/milligram.json'
import github from '../src/examples/github.json'
import type { ComponentSpec, TypographySpec, AnalysisResult } from '../src/types'

it('uses the recorded line height and tracking instead of a shared preview scale', () => {
  const spec = stripe.design_system.typography.scale[0] as TypographySpec
  const { container } = render(<TypographySample spec={spec} />)
  expect(screen.getByText('Font family')).toBeVisible()
  expect(screen.getByText(String(spec.family?.value))).toBeVisible()
  expect(container.querySelector('.type-specimen')).toHaveStyle({ fontSize: '48px', lineHeight: '55.2px', letterSpacing: '-0.96px' })
})

it('does not invent a visual scale for records missing family or size', () => {
  const { container } = render(<TypographySample spec={milligram.design_system.typography.scale[0] as TypographySpec} />)
  expect(container.querySelector('.type-specimen')).not.toBeInTheDocument()
  expect(screen.getByText(/No visual sample/)).toBeVisible()
  expect(screen.getByText(/Not recorded: size, family/)).toBeVisible()
})

it('renders button shape and color from saved component properties, without treating borders as text color', () => {
  const primary = stripe.design_system.components.find(c => c.name === 'primary-button') as ComponentSpec
  const { container } = render(<ComponentPreview component={primary} />)
  expect(container.querySelector('.component-specimen')).toHaveStyle({ borderRadius: '4px', backgroundColor: '#533AFD', color: '#FFFFFF' })
  const card = stripe.design_system.components.find(c => c.name === 'bento-card') as ComponentSpec
  expect(componentPreviewStyle(card)).toEqual({ borderColor: '#E5EDF5', borderRadius: '6px' })
})

it('excludes resource-loading values and layout properties from component specimens', () => {
  const component = structuredClone(designSystemFixture.components[0])
  const token = component.values[0]
  component.values = [
    { ...token, name: 'button-bg', value: 'url(https://example.com/track)' },
    { ...token, name: 'position', value: 'fixed' },
    { ...token, name: 'button-radius', value: '6px' },
  ]
  expect(componentPreviewStyle(component)).toEqual({ borderRadius: '6px' })
})

it('keeps measurements accessible in a selected section and restores that export trigger', () => {
  render(<ResultPanel mode="single" loading={false} error={null} result={github as unknown as AnalysisResult} onRetry={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Components', exact: true }))
  expect(screen.getByRole('region', { name: 'Components' })).toHaveFocus()
  expect(screen.getAllByText('Measured element')).toHaveLength(5)
  const trigger = screen.getByRole('button', { name: 'Open export controls' })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: 'Close export' }))
  expect(trigger).toHaveFocus()
  expect(screen.getByRole('heading', { name: 'Components' })).toBeVisible()
})

it('does not present sparse card properties as a reconstructed component', () => {
  const card = stripe.design_system.components.find(c => c.name === 'bento-card') as ComponentSpec
  const { container } = render(<ComponentPreview component={card} />)
  expect(container.querySelector('.component-specimen')).not.toBeInTheDocument()
  expect(screen.getByText(/No component preview/)).toBeVisible()
})

it('explains evidence labels and qualifies confidence without changing the recorded values', () => {
  render(<ResultPanel mode="single" loading={false} error={null} result={stripe as unknown as AnalysisResult} onRetry={vi.fn()} />)
  const guide = screen.getByText('How to read the evidence labels').closest('details')!
  fireEvent.click(screen.getByText('How to read the evidence labels'))
  expect(guide.textContent).toContain('not a verified accuracy score')
  expect(guide.textContent).toContain('not directly measured')
})
