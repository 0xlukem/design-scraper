import './colophon.css'

const socialLinks = [
  { label: 'GitHub', href: 'https://github.com/0xlukem' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/lucasmalizia' },
  { label: 'X', href: 'https://x.com/0xlukem' },
]

export default function SiteFooter({ isMix = false, onSwitch }: { isMix?: boolean; onSwitch?: () => void }) {
  return <footer className="drawing-footer">
    <div className="drawing-footer-inner">
      <div className="drawing-footer-tools">
        <a href="/" aria-label="About Design Scraper" className="drawing-home">
          <img src="/design-scraper.svg" width="24" height="24" alt="" />
        </a>
        {onSwitch && <button type="button" onClick={onSwitch} aria-label={isMix ? 'Back to Design Scraper' : 'Open Mix It'}>
          {isMix ? 'Design Scraper' : 'Mix It'}
        </button>}
      </div>
      <nav aria-label="Lucas Malizia’s social profiles">
        {socialLinks.map(link => <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
          {link.label}<span className="sr-only"> (opens in a new tab)</span>
        </a>)}
      </nav>
      <a className="drawing-signature" href="https://lucasmalizia.xyz/" target="_blank" rel="noopener noreferrer">
        <span>By</span> <i>Lucas Malizia</i><span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  </footer>
}
