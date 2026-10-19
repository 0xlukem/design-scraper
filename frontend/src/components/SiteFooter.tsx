import { ArrowUpRight } from '@phosphor-icons/react'

const socialLinks = [
  { label: 'GitHub', href: 'https://github.com/0xlukem' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/lucasmalizia' },
  { label: 'X', href: 'https://x.com/0xlukem' },
]

export default function SiteFooter({ isMix = false, onSwitch }: { isMix?: boolean; onSwitch?: () => void }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div><p className="footer-brand">{isMix ? 'Never the same mix twice.' : 'Look closer. Build better.'}</p><p className="footer-tagline">{isMix ? 'An experiment by Design Scraper.' : 'Design Scraper / From reference to system.'}</p></div>
          {onSwitch && <button className="footer-world-link" type="button" onClick={onSwitch}>{isMix ? 'Back to Design Scraper' : 'Feeling experimental? Enter Mix It'} <ArrowUpRight size={20} aria-hidden="true" /></button>}
        </div>
        <div className="footer-maker">
          <a className="footer-landing" href="https://www.lucasmalizia.xyz" target="_blank" rel="noopener noreferrer">
            Meet the maker <ArrowUpRight size={20} aria-hidden="true" />
            <span className="sr-only"> — Lucas Malizia (opens in a new tab)</span>
          </a>
        </div>
        <div className="footer-bottom">
          <p className="footer-credit">Made with love and overthinking<span>by Lucas Malizia</span></p>
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
}
