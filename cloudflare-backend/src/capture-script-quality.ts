import { captureRegionPredicate } from "./capture-region";

/** A failed async dependency can leave useful static branding, but is never
 * evidence that hydration or interactive behavior completed. Everything outside
 * this narrow, observable case remains a required rendering failure. */
export const assessFailedScripts = String.raw`({ urls, height }) => {
  const visible = element => ((${captureRegionPredicate})(element, height));
  const scripts = [...document.scripts];
  const asyncClassicOnly = urls.every(url => {
    const matches = scripts.filter(script => script.src === url);
    return matches.length > 0 && matches.every(script => {
      const type = (script.getAttribute('type') || '').trim().toLowerCase();
      return script.hasAttribute('async') && !script.hasAttribute('defer') &&
        ['', 'text/javascript', 'application/javascript'].includes(type);
    });
  });
  if (!asyncClassicOnly) return false;
  // Loading shells, empty bootstrap roots and unstyled fallback text cannot
  // establish enough observed design evidence to soften a script failure.
  if ([...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible)) return false;
  const text = element => (element.textContent || '').replace(/\s+/g, ' ').trim();
  const headings = [...document.querySelectorAll('h1,h2')].filter(visible);
  const copy = [...document.querySelectorAll('p,li')].filter(visible);
  const controls = [...document.querySelectorAll('a[href],button,[role="button"]')].filter(visible);
  return document.styleSheets.length > 0 && headings.some(element => text(element).length >= 8) &&
    copy.reduce((length, element) => length + text(element).length, 0) >= 80 &&
    controls.some(element => text(element).length >= 2);
}`;
