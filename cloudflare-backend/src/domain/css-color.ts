// Bounded CSS-like color validation shared by normalization and renderer tests.
// check, not a browser CSS parser. Nested color functions are valid (e.g. the
// Bootstrap gradient with rgba() stops), but declarations/URLs/markup are not.
const simple = /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i;
const functions = new Set(['rgb','rgba','hsl','hsla','hwb','lab','lch','oklab','oklch','color','color-mix','linear-gradient','radial-gradient','conic-gradient','repeating-linear-gradient','repeating-radial-gradient','repeating-conic-gradient','calc','min','max','clamp','var']);
const outer = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|(?:repeating-)?(?:linear|radial|conic)-gradient)\([^;{}<>\[\]\\"']*\)$/i;
export function cssLikeColor(value: string): boolean {
  if (value.length > 4096) return false;
  if (simple.test(value)) return true;
  if (!outer.test(value) || /[\r\n\x00]/.test(value)) return false;
  let depth = 0;
  for (const char of value) {
    if (char === '(' && ++depth > 8) return false;
    if (char === ')' && --depth < 0) return false;
  }
  if (depth !== 0) return false;
  for (const match of value.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi))
    if (!functions.has(match[1].toLowerCase())) return false;
  return true;
}
