/** Runs in Chromium, on the already bounded visible element set. No site rules. */
export const measurementScript = String.raw`(elements, height) => {
  const selectors = {
    heading: 'h1,h2,h3,h4,h5,h6,[role="heading"]',
    body: 'p,li', card: 'article,[class~="card"],[class$="-card"],[class*="-card "]',
    button: 'button,a[role="button"],a[class*="button" i],a[class*="btn" i]',
    link: 'a[href]', input: 'input:not([type="hidden"]),select,textarea',
    section: 'main,section', navigation: 'nav,[role="navigation"]',
    layout: '', image: 'img', footer: 'footer,[role="contentinfo"]'
  };
  const properties = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing',
    'color','backgroundColor','borderRadius','border','boxShadow',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'marginTop','marginRight','marginBottom','marginLeft',
    'display','width','maxWidth','gap','rowGap','columnGap','gridTemplateColumns',
    'flexDirection','justifyContent','alignItems','objectFit'];
  const buckets = Object.fromEntries(Object.keys(selectors).map(k => [k, []]));
  const counts = Object.fromEntries(Object.keys(selectors).map(k => [k, 0]));
  const seen = Object.fromEntries(Object.keys(selectors).map(k => [k, new Set()]));
  const locator = element => {
    const path = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const tag = current.tagName.toLowerCase();
      const peers = current.parentElement ? [...current.parentElement.children].filter(e => e.tagName === current.tagName) : [current];
      path.unshift(tag + ':nth-of-type(' + (peers.indexOf(current) + 1) + ')');
    }
    const result = path.join(' > ');
    return result.length <= 1600 ? result : null;
  };
  for (const element of elements) {
    const css = getComputedStyle(element);
    const kind = Object.entries(selectors).find(([kind, selector]) =>
      kind === 'layout' ? ['grid','flex','inline-grid','inline-flex'].includes(css.display) : element.matches(selector))?.[0];
    if (!kind) continue;
    counts[kind]++;
    const limit = kind === 'heading' ? 6 : 3;
    if (buckets[kind].length >= limit) {
      if (kind !== 'heading' || buckets[kind].some(s => s.tag === element.tagName.toLowerCase())) continue;
      // A later heading level must not lose its place to variants of an earlier level.
      const repeated = buckets[kind].findLastIndex((s,i,all) => all.findIndex(t=>t.tag===s.tag) !== i);
      if (repeated < 0) continue;
      buckets[kind].splice(repeated,1);
    }
    const styles = Object.fromEntries(properties.map(key => [key, css[key]]).filter(([,value]) => value && value.length <= 300));
    const signature = JSON.stringify([kind === 'heading' ? element.tagName : kind,
      Object.fromEntries(Object.entries(styles).filter(([key]) => key !== 'width' || ['section','layout','image'].includes(kind)))]);
    if (seen[kind].has(signature)) continue;
    const selector = locator(element);
    if (!selector) continue;
    seen[kind].add(signature);
    buckets[kind].push({kind,tag:element.tagName.toLowerCase(),selector,styles});
  }
  const samples = [];
  const selected = new Set();
  const headingTags = new Set();
  for (const [index,sample] of buckets.heading.entries()) {
    if (headingTags.has(sample.tag)) continue;
    headingTags.add(sample.tag);selected.add(sample);
    samples.push({...sample,id:'heading-'+(index+1)});
  }
  for (let index = 0; index < 6 && samples.length < 24; index++) {
    for (const [kind, bucket] of Object.entries(buckets)) {
      if (samples.length === 24) break;
      if (bucket[index] && !selected.has(bucket[index])) {
        selected.add(bucket[index]);samples.push({...bucket[index],id:kind+'-'+(index+1)});
      }
    }
  }
  return {version:1,viewport:{width:innerWidth,height:innerHeight,captureHeight:height || innerHeight},
    candidateCounts:counts,samples,limit:24,scope:'visible static samples; categories are DOM heuristics, not global component roles'};
}`;
