import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    // Component tests use accessible reduced-motion behavior. Real animation
    // timing and playback are exercised by Chromium's verify-motion script.
    matches: query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: async () => undefined,
  },
})

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: () => 'blob:test',
})

Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: () => undefined,
})

window.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
afterEach(() => { window.history.replaceState(null, '', '/') })
