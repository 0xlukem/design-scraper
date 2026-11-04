import { ApiError } from './errors';
import parse from 'css-tree/parser';
import type { CssNode } from 'css-tree';
import { collectTokens, renderDocuments, renderExports } from './domain/renderers';
import type { DesignSystem, DimensionToken } from './domain/types';
import validate from './domain/validate.js';
import type { ResourceTransport } from './public-resources';
import { targetUrl } from './url-safety';

const scope = 'Declarations from source HTML and CSS. Active selectors, responsive states and rendered appearance are unverified.';
const unknown = 'Unverified in source CSS.';
const dimension = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw|ch)$/i;
const color = /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgb|rgba|hsl|hsla|oklch)\([\d\s.,%/+\-]+\))$/i;
type Category = 'color' | 'radius' | 'space' | 'font' | 'size';
type Declaration = { category: Category; name: string; value: string; at: string; property: string };

function category(prop: string, value: string): Category | undefined {
  const variable = prop.startsWith('--');
  if (color.test(value) && (variable || /^(?:background|color|fill|stroke|.*-color)$/.test(prop))) return 'color';
  if ((dimension.test(value) || value === '0') && /(?:radius|rounded)/i.test(prop)) return 'radius';
  if (dimension.test(value) && /^(?:font-size|--(?:.*-)?(?:font-size|text-size)(?:-.*)?)$/i.test(prop)) return 'size';
  if (dimension.test(value) && /^(?:padding|margin|gap|--(?:.*-)?(?:spacing|space|gap))(?:-|$)/i.test(prop)) return 'space';
  if (/^(?:font-family|--[\w-]*(?:font-family|font-sans|font-serif|font-mono)[\w-]*)$/i.test(prop) &&
    /^[\w "'-]+(?:\s*,\s*[\w "'-]+)*$/.test(value) && !/^(?:inherit|initial|unset|revert)$/i.test(value)) return 'font';
}

export function readCss(css: string, sheet: string, found: Declaration[]) {
  if (!css || css.length > 320_000 || found.length >= 80) return;
  let root;
  try { root = parse(css, { positions: true, parseValue: false, parseRulePrelude: false, parseAtrulePrelude: false }); }
  catch { return; }
  if (root.type !== 'StyleSheet') return;
  const pending: CssNode[] = root.children.toArray().reverse();
  let visited = 0;
  while (pending.length && ++visited <= 8000 && found.length < 80) {
    const node = pending.pop()!;
    if (node.type === 'Rule' || (node.type === 'Atrule' && /^(?:media|supports|layer|container|scope)$/i.test(node.name))) {
      node.block?.children.forEachRight(child => { pending.push(child); });
      continue;
    }
    if (node.type !== 'Declaration' || node.value.type !== 'Raw') continue;
    const prop = node.property, value = node.value.value.trim();
    if (prop.length > 72 || value.length > 128 || !/^[\w-]+$/.test(prop)) continue;
    const kind = category(prop, value);
    if (['--__proto__', '--constructor', '--prototype'].includes(prop)) continue;
    if (!kind || found.filter(d => d.category === kind).length >= 16 || found.some(d => d.category === kind && d.value === value)) continue;
    const at = sheet + ', line ' + (node.loc?.start.line ?? 1);
    found.push({ category: kind, name: prop.startsWith('--') ? prop.slice(2) : prop + '-' + (found.length + 1), value, at, property: prop });
  }
}

export function declaredResult(url: string, found: Declaration[]) {
  if (!found.length) return null;
  const tokens = (kind: Category): DimensionToken[] => found.filter(d => d.category === kind).map(d => ({
    name: d.name, value: d.value, role: d.property + ' declared in ' + d.at,
    status: 'detected', confidence: 1, source: ['web_1'],
  }));
  const identity = new URL(url).hostname;
  const system: DesignSystem = {
    metadata: { extraction_method: 'declared-css' },
    overview: { identity, summary: scope, tone: [], personality: [], density: unknown, layout_philosophy: unknown },
    colors: { brand: [], accent: tokens('color'), surfaces: [], text: [], borders: [], gradients: [] },
    surfaces: { levels: [], philosophy: unknown }, typography: { families: tokens('font'), scale: tokens('size').map(size => ({
      name: size.name, size, use: size.role, family: null, weight: null, line_height: null, letter_spacing: null,
    })), principles: [], substitutes: [] },
    spacing: { base_unit: null, tokens: tokens('space'), section_padding: [], card_padding: [], button_padding: [] },
    layout: { values: [], container: [], grid: [], whitespace_philosophy: unknown },
    shapes: { radii: tokens('radius'), image_geometry: [], aspect_ratios: [], cropping: unknown },
    elevation: { tokens: [], borders: [], philosophy: unknown }, components: [],
    imagery: { elements: [], visual_language: unknown, photography: unknown, iconography: unknown },
    responsive: { breakpoints: [], touch_targets: [], changes: [], image_behavior: [] },
    guidelines: { dos: [], donts: [] }, iteration_guide: [], agent_prompt_guide: [], similar_brands: [], quick_start: [],
    known_gaps: [{ code: 'css-declarations-only', message: scope, source: ['web_1'] }],
    evidence: { sources: [{ label: 'web_1', url, weight: 100, status: 'analyzed' }], notes: [scope] },
  };
  if (!validate(system)) throw new Error('Invalid declared style result');
  const documents = renderDocuments(system);
  return { success: true as const, design_md: documents.extended, documents, exports: renderExports(system), design_system: system,
    metadata: { url, title: identity, description: scope, colors_extracted: system.colors.accent.length, fonts_extracted: system.typography.families.length } };
}
export type DeclaredResult = NonNullable<ReturnType<typeof declaredResult>>;

/** Retain source values that visual analysis did not include in its exportable token groups. */
export function retainDeclaredStyles(system: DesignSystem, declared: DesignSystem) {
  const existing = new Set(collectTokens(system).map(t => JSON.stringify([t.category, t.value])));
  const missing = (category: string, value: unknown) => !existing.has(JSON.stringify([category, value]));
  const prefix = <T extends { name: string }>(token: T) => ({ ...token, name: 'declared-' + token.name });
  const colors = declared.colors.accent.filter(t => missing('color', t.value));
  const radii = declared.shapes.radii.filter(t => missing('radius', t.value));
  const spacing = declared.spacing.tokens.filter(t => missing('spacing', t.value));
  const families = declared.typography.families.filter(t => missing('font-family', t.value));
  const sizes = declared.typography.scale.filter(t => t.size && missing('font-size', t.size.value));
  if (!(colors.length || radii.length || spacing.length || families.length || sizes.length)) return;
  system.colors.accent.push(...colors.map(prefix));
  system.shapes.radii.push(...radii.map(prefix));
  system.spacing.tokens.push(...spacing.map(prefix));
  system.typography.families.push(...families.map(prefix));
  system.typography.scale.push(...sizes.map(prefix));
  system.known_gaps.push({ code: 'source-declarations-retained', source: ['web_1'],
    message: 'Tokens prefixed with declared- come from source CSS. Their stylesheet references are retained. Their use in the photographed state is unverified.' });
}

export async function extractDeclared(url: string, transport: ResourceTransport) {
  async function get(raw: string, mime: RegExp) {
    let href = targetUrl(raw, 16384).href;
    for (let hop = 0; hop <= 3; hop++) {
      const response = await transport.load({ url: href, method: 'GET', headers: { accept: 'text/html,text/css;q=0.9' }, body: null });
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        let next;
        try { next = new URL(response.headers.location, href); } catch { return null; }
        href = targetUrl(next.href, 16384).href;
        continue;
      }
      if (response.status !== 200 || !mime.test(response.headers['content-type'] ?? '')) return null;
      return { href, body: response.body.toString('utf8') };
    }
    return null;
  }
  const doc = await get(url, /^text\/html(?:\s*;|$)/i);
  if (!doc) return null;
  const found: Declaration[] = [];
  const links: string[] = [];
  let base = doc.href, baseSeen = false, buffer = '', block = 0, inline = 0;
  await new HTMLRewriter()
    .on('base[href]', { element(e) { if (!baseSeen) { baseSeen = true; try { base = new URL(e.getAttribute('href')!, doc.href).href; } catch {} } } })
    .on('style', {
      element(e) { buffer = ''; block++;
        const type = e.getAttribute('type')?.trim().toLowerCase();
        e.onEndTag(() => { if (block <= 64 && (!type || type === 'text/css')) readCss(buffer, 'style block ' + block, found); });
      },
      text(t) { if (block <= 64 && buffer.length <= 320_000) buffer += t.text; },
    })
    .on('[style]', { element(e) {
      if (++inline <= 64) readCss('x{' + e.getAttribute('style') + '}', 'style attribute ' + inline, found);
    } })
    .on('link[href]', { element(e) {
      const rel = e.getAttribute('rel')?.toLowerCase().split(/\s+/) ?? [];
      if (links.length < 2 && rel.includes('stylesheet') && !rel.includes('alternate') && !e.hasAttribute('disabled')) {
        const href = e.getAttribute('href')!;
        if (!links.includes(href)) links.push(href);
      }
    } })
    .transform(new Response(doc.body)).arrayBuffer();
  for (const link of links) {
    if (found.length >= 80) break;
    let href;
    try { href = new URL(link, base); } catch { continue; }
    if (!['https:', 'http:'].includes(href.protocol)) continue;
    let sheet;
    try { sheet = await get(href.href, /^text\/css(?:\s*;|$)/i); }
    catch (error) {
      // Keep complete declarations collected before an optional sheet's local budget expired.
      if (!(error instanceof ApiError) || !['SCRAPE_TIMEOUT', 'SCRAPE_FAILED', 'SCRAPE_RESOURCE_LIMIT'].includes(error.code)) throw error;
      break;
    }
    if (sheet) {
      const source = new URL(sheet.href);
      readCss(sheet.body, source.hostname + '/' + (source.pathname.split('/').pop() ?? '').replace(/[^\w.-]/g, '').slice(0,80), found);
    }
  }
  return declaredResult(url, found);
}
