import { memo } from 'react'

function KineticTicker() {
  const phrase = 'MIX IT ALL / TWO WEBS / ONE SYSTEM / '
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        <span>{phrase.repeat(4)}</span>
        <span>{phrase.repeat(4)}</span>
      </div>
    </div>
  )
}

export default memo(KineticTicker)
