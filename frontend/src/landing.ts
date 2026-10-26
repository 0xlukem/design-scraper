import './landing.css'
import { initLandingMotion } from './landing-motion'

// Hash links from the original single-document application remain usable.
function forwardWorkspaceLink() {
  if (/^#\/(?:analyze|library|activity)(?:\/|$)/.test(window.location.hash)) {
    window.location.replace(`/app/${window.location.hash}`)
  }
}
forwardWorkspaceLink()
window.addEventListener('hashchange', forwardWorkspaceLink)
initLandingMotion()
