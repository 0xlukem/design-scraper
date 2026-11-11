import { ArrowUpRight } from '@phosphor-icons/react'
import './colophon.css'

const socialLinks = [
  { label: 'GitHub', href: 'https://github.com/0xlukem' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/lucasmalizia' },
  { label: 'X', href: 'https://x.com/0xlukem' },
]

export default function SiteFooter({ isMix = false, onSwitch }: { isMix?: boolean; onSwitch?: () => void }) {
  if (isMix) return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div><p className="footer-brand">Never the same mix twice.</p><p className="footer-tagline">An experiment by Design Scraper.</p></div>
          {onSwitch && <button className="footer-world-link" type="button" onClick={onSwitch}>Back to Design Scraper <ArrowUpRight size={20} aria-hidden="true" /></button>}
        </div>
        <div className="footer-maker">
          <a className="footer-landing" href="https://www.lucasmalizia.xyz" target="_blank" rel="noopener noreferrer">
            Meet the maker <ArrowUpRight size={20} aria-hidden="true" />
            <span className="sr-only"> — Lucas Malizia (opens in a new tab)</span>
          </a>
        </div>
        <div className="footer-bottom">
          <p className="footer-credit">Made with love and overthinking<span>by Lucas Malizia · <a href="/">About Design Scraper</a></span></p>
          <nav aria-label="Lucas Malizia’s social profiles" className="footer-socials">
            {socialLinks.map(link => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label} <ArrowUpRight size={14} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  )
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
