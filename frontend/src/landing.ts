import './landing.css'
import { initLandingMotion } from './landing-motion'
import { providerNames } from './byok'

// Hash links from the original single-document application remain usable.
function forwardWorkspaceLink() {
  if (/^#\/(?:analyze|library|activity)(?:\/|$)/.test(window.location.hash)) {
    window.location.replace(`/app/${window.location.hash}`)
  }
}
forwardWorkspaceLink()
window.addEventListener('hashchange', forwardWorkspaceLink)

const demo = document.querySelector<HTMLDetailsElement>('.hero-demo')!
// Native disclosure keeps task entry first on mobile and works without JS.
// The initial viewport never overrides a later explicit open/close choice.
demo.open = window.matchMedia('(min-width: 761px)').matches
initLandingMotion()

const rates = document.querySelector<HTMLDetailsElement>('#model-rates')!
const status = document.querySelector<HTMLParagraphElement>('#rates-status')!
const list = document.querySelector<HTMLDivElement>('#rates-list')!
const reload = document.querySelector<HTMLButtonElement>('#reload-rates')!
let request: AbortController | undefined
let loaded = false

async function loadRates() {
  if (request || loaded) return
  const controller = new AbortController()
  request = controller
  status.hidden = false
  status.textContent = 'Loading models and rates…'
  list.hidden = true
  reload.hidden = true
  const timeout = window.setTimeout(() => controller.abort(), 10000)
  try {
    // Reuse the validated public catalog. Comparing models requires no key,
    // quota check, provider call or analysis.
    const { getProviders } = await import('./api')
    if (request !== controller) return
    const options = await getProviders(controller.signal)
    if (request !== controller) return
    const items = options.map(option => {
      const item = document.createElement('section')
      item.className = 'rate-item'
      const title = document.createElement('h3')
      title.textContent = providerNames[option.provider]
      const model = document.createElement('p')
      model.className = 'rate-model'
      model.textContent = option.model
      const prices = document.createElement('dl')
      for (const [label, value] of [['Input / 1M', option.inputPrice], ['Output / 1M', option.outputPrice]] as const) {
        const row = document.createElement('div')
        const term = document.createElement('dt')
        term.textContent = label
        const price = document.createElement('dd')
        price.textContent = value === null ? 'Unavailable' : `US$${value}`
        row.append(term, price)
        prices.append(row)
      }
      item.append(title, model, prices)
      return item
    })
    list.replaceChildren(...items)
    list.hidden = false
    status.textContent = 'Models loaded. These are estimates, not invoices. Unavailable rates are not zero.'
    loaded = true
  } catch {
    if (request !== controller) return
    status.textContent = 'Model rates could not be loaded. You can still explore saved designs.'
    reload.hidden = false
  } finally {
    window.clearTimeout(timeout)
    if (request === controller) request = undefined
  }
}
function cancelRates() {
  request?.abort()
  request = undefined
}
rates.addEventListener('toggle', () => {
  if (rates.open) void loadRates()
  else cancelRates()
})
reload.addEventListener('click', () => void loadRates())
function openRatesLink() {
  if (window.location.hash !== '#model-rates') return
  rates.open = true
  rates.querySelector('summary')?.focus({ preventScroll: true })
  rates.scrollIntoView({ block: 'start', behavior: 'instant' })
}
window.addEventListener('hashchange', openRatesLink)
document.querySelectorAll<HTMLAnchorElement>('a[href="#model-rates"]').forEach(link => {
  link.addEventListener('click', () => { rates.open = true })
})
window.addEventListener('pagehide', cancelRates)
window.addEventListener('pageshow', () => { if (rates.open && !loaded) void loadRates() })
openRatesLink()
