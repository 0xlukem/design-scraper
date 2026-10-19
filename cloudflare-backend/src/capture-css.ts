import { captureRegionPredicate } from "./capture-region";
/** Runs inside Chromium. Only bounded, applicable custom properties cross back
 * to the host; stylesheet source and selector are retained as evidence. */
export const selectCssEvidence = String.raw`({ text, source, height, maxRules }) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const variables = {};
  const evidence = {};
  const breakpoints = new Set();
  let inspected = 0, omitted = 0;
  const inRegion = element => element === document.documentElement || element === document.body || (${captureRegionPredicate})(element, height);
  function visit(rules, active = true) {
    for (const rule of rules) {
      if (++inspected > maxRules) { omitted++; continue; }
      if (rule instanceof CSSMediaRule) {
        if (breakpoints.size < 40) breakpoints.add(rule.conditionText);
        visit(rule.cssRules, active && matchMedia(rule.conditionText).matches);
      } else if (rule instanceof CSSSupportsRule) {
        visit(rule.cssRules, active && CSS.supports(rule.conditionText));
      } else if ('cssRules' in rule && !(rule instanceof CSSStyleRule)) {
        visit(rule.cssRules, active);
      } else if (active && rule instanceof CSSStyleRule) {
        const names = [...rule.style].filter(name => name.startsWith('--'));
        if (!names.length) continue;
        let matches = false;
        try { matches = [...document.querySelectorAll(rule.selectorText)].some(inRegion); } catch {}
        if (!matches) continue;
        for (const name of names) {
          const value = rule.style.getPropertyValue(name).trim();
          if (name.length > 200 || value.length > 500 || (Object.keys(variables).length >= 120 && !(name in variables))) { omitted++; continue; }
          variables[name] = value;
          evidence[name] = { name, value, selector: rule.selectorText.slice(0, 300), stylesheet: source };
        }
      }
    }
  }
  visit(sheet.cssRules);
  return { variables, evidence: Object.values(evidence), breakpoints: [...breakpoints], inspected, omitted };
}`;
