import type { Source } from './normalize';
import type { DesignSystem, TokenValue, DimensionToken } from './types';
import { ApiError } from '../errors';

type Sample = { id: string; kind: string; tag: string; selector: string; styles: Record<string, string> };
const kinds = ['heading','body','button','link','input','card','section','navigation','layout','image','footer'];
const dimension = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/i;
const typographyKeys = ['family','size','weight','line_height','letter_spacing'] as const;
const componentProperties = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','borderRadius','border','boxShadow','paddingTop','paddingRight','paddingBottom','paddingLeft'];
const cssName = (key: string) => key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
const prefix = (label: string, id: string) => `measured-${label.replace('_','-')}-${id}`;
const issue = (reason: string): never => {
  const error = new ApiError('AI_FAILED', 'The design evidence could not be preserved.', 502);
  Object.assign(error, { validationReason: reason }); throw error;
};
function samples(source: Source): Sample[] | null {
  const capture = source.data.measurements as {version?: number;samples?: Sample[]} | undefined;
  if (!capture || capture.version !== 1) return null;
  if (!Array.isArray(capture.samples) || capture.samples.length > 24) return issue('measurement_shape');
  const ids = new Set<string>();
  for (const sample of capture.samples) {
    if (!sample || !kinds.includes(sample.kind) || !new RegExp(`^${sample.kind}-[1-6]$`).test(sample.id) || ids.has(sample.id)
      || typeof sample.selector !== 'string' || sample.selector.length > 1600
      || typeof sample.tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(sample.tag) || !sample.styles || typeof sample.styles !== 'object' || Array.isArray(sample.styles)
      || Object.values(sample.styles).some(v => typeof v !== 'string' || v.length > 300)) return issue('measurement_shape');
    ids.add(sample.id);
  }
  return capture.samples;
}

/** A null state-property slot is absence, never an observed TokenValue.
 * Only this lossless empty-value normalization is allowed; other malformed
 * properties must still fail the canonical schema. */
export function omitNullStateProperties(value: unknown, sources: Source[]): number {
  if (!sources.some(s => s.weight > 0 && (s.data.measurements as {version?: number})?.version === 1)) return 0;
  if (!value || typeof value !== 'object') return 0;
  const components = (value as {components?: unknown}).components;
  if (!Array.isArray(components)) return 0;
  let omitted = 0;
  for (const component of components) {
    if (!component || !Array.isArray(component.states)) continue;
    component.states = component.states.filter((state: {values?: unknown[];observed?: boolean} | null) => {
      if (!state || !Array.isArray(state.values) || !state.values.includes(null)) return true;
      omitted += state.values.filter(v => v === null).length;
      state.values = state.values.filter(v => v !== null);
      state.observed = false;
      return state.values.length > 0;
    });
  }
  return omitted;
}

/** Preserve measurements as explicitly scoped references, never as inferred global roles.
 * Old saved captures/contract fixtures have no measurements version and keep their output. */
export function preserveMeasurements(system: DesignSystem, sources: Source[]) {
  const active = sources.filter(s => s.weight > 0);
  const observed = active.flatMap(source => {
    const values = samples(source); return values ? [{source, values}] : [];
  });
  if (!observed.length) return;
  // AI cannot opt in to the renderer mode: the server sets this from capture evidence.
  system.metadata.measurements_version = 1;
  system.metadata.measurement_scope = 'Element measurements from a single static viewport per source; not a complete responsive system. In a mix, measured references retain their original source and are not blended tokens.';
  const addGap = (code: string, message: string, source: string[]) => {
    if (!system.known_gaps.some(g => g.code === code && g.source.join() === source.join())) system.known_gaps.push({code,message,source});
  };
  const activeLabels = active.map(s => s.label);
  const markInterpretations = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(markInterpretations); return; }
    const object = value as Record<string, unknown>;
    if (object.status === 'detected') object.status = 'inferred';
    Object.values(object).forEach(markInterpretations);
  };
  markInterpretations(system);
  for (const component of system.components) for (const state of component.states) state.observed = false;
  addGap('model-roles-inferred', 'Model-assigned roles and recipes are interpretations, even when their values appear in CSS. Only measured- entries are linked to exact sampled elements; interaction states were not exercised.', activeLabels);
  const locators: Record<string, {selector:string;tag:string;kind:string;source:string;influence:number}> = {};
  // Preserve the fact that the model omitted fields without publishing unusable empty rows.
  if (observed.some(x => x.values.some(v => ['heading','body'].includes(v.kind)))) {
    const blank = system.typography.scale.filter(t => typographyKeys.every(k => t[k] === null));
    if (blank.length) {
      system.typography.scale = system.typography.scale.filter(t => !blank.includes(t));
      addGap('model-typography-omitted', 'The model returned unmeasured typography roles. Element-scoped measurements are supplied below; global role assignments remain unverified.', activeLabels);
    }
  }
  if (observed.some(x => x.values.some(v => ['button','input','card','navigation','footer'].includes(v.kind)))) {
    const blank = system.components.filter(c => !c.values.length && !c.states.some(s=>s.values.length));
    if (blank.length) {
      system.components = system.components.filter(c => !blank.includes(c));
      addGap('model-components-omitted', 'Unmeasured component descriptions were replaced by element-scoped specifications. No automatic equivalence between a model-assigned role and a sampled element is assumed.', activeLabels);
    }
  }
  // Reserved measured names are always derived from capture, never model claims.
  const arrays: TokenValue[][] = [system.typography.families, system.spacing.tokens, system.spacing.section_padding,
    system.spacing.card_padding, system.spacing.button_padding, system.layout.values, system.layout.container, system.layout.grid];
  for (const items of arrays) for (let i = items.length - 1; i >= 0; i--) if (items[i].name.startsWith('measured-')) items.splice(i, 1);
  system.typography.scale = system.typography.scale.filter(t => !t.name.startsWith('measured-'));
  system.components = system.components.filter(c => !c.name.startsWith('measured-'));
  const totals: Record<string, number> = {};
  for (const {source, values} of observed) {
    totals[source.label] = values.length;
    for (const sample of values) {
      const name = prefix(source.label, sample.id), style = sample.styles;
      locators[name] = {selector:sample.selector,tag:sample.tag,kind:sample.kind,source:source.label,influence:source.weight};
      const where = `${name} (${sample.tag}, static; ${source.label}, influence ${source.weight}%; locator in Evidence)`;
      const token = (property: string, value: string): TokenValue => ({name:`${name}-${property}`,value,
        role:`Observed ${property} on ${where}`,source:[source.label],status:'detected',confidence:1});
      const dim = (property: string, value: string | undefined): DimensionToken | null =>
        value && dimension.test(value) ? token(property,value) as DimensionToken : null;
      if (['heading','body','button','link','input'].includes(sample.kind)) {
        const weight = style.fontWeight;
        system.typography.scale.push({name,use:where,
          family:style.fontFamily ? token('font-family',style.fontFamily) : null,
          size:dim('font-size',style.fontSize),
          weight:weight && (/^[1-9]00$/.test(weight) || /^(normal|bold|lighter|bolder)$/.test(weight)) ? token('font-weight',weight) as DimensionToken : null,
          line_height:dim('line-height',style.lineHeight),letter_spacing:dim('letter-spacing',style.letterSpacing)});
      }
      if (['button','input','card','navigation','footer'].includes(sample.kind)) {
        const measured = componentProperties.flatMap(key => style[key] ? [token(cssName(key),style[key])] : []);
        system.components.push({name,description:`Observed ${sample.kind} sample: ${where}. Category is a DOM heuristic. Hover/focus/expanded states were not exercised.`,values:measured,states:[],source:[source.label],confidence:1,status:'detected'});
      }
      for (const property of ['paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','rowGap','columnGap']) {
        const t = dim(property.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),style[property]);
        const scopedPadding = property.startsWith('padding') && ['section','card','button'].includes(sample.kind);
        if (!t || (!scopedPadding && /^0(?:px)?$/.test(String(t.value)))) continue;
        const collection = scopedPadding
          ? system.spacing[`${sample.kind}_padding` as 'section_padding'|'card_padding'|'button_padding'] : system.spacing.tokens;
        collection.push(t);
      }
      if (['section','card','navigation','layout','footer'].includes(sample.kind)) {
        // Only numeric dimensions enter dimension exports. Composite CSS grid
        // declarations remain in source evidence, not DTCG dimension tokens.
        for (const property of ['width','maxWidth']) {
          const t = dim(property === 'maxWidth' ? 'max-width' : property,style[property]);
          if (t) system.layout.container.push(t);
        }
        for (const property of ['rowGap','columnGap']) {
          const t = dim(property === 'rowGap' ? 'row-gap' : 'column-gap',style[property]);
          if (t) system.layout.grid.push(t);
        }
      }
    }
    addGap('measurement-scope', 'Measurements are bounded element samples from one static viewport. CSS frequencies and sample categories do not establish global roles, a base spacing unit, mobile behavior or unvisited interaction states.', [source.label]);
    if (!values.some(v => v.kind === 'footer')) addGap('footer-not-observed', 'No footer was present in the sampled region; footer components are not documented as observed.', [source.label]);
    const missing = ['heading','body','button','input','card'].filter(kind => !values.some(v => v.kind === kind));
    if (missing.length) addGap('measurement-categories-missing', `No sampled measurements for: ${missing.join(', ')}. Inspect these elements separately if needed.`, [source.label]);
  }
  system.metadata.measurement_counts = totals;
  system.metadata.measurement_locators = locators;
  // A schema-valid model can still silently lose core evidence. Audit the output,
  // including property values and source, rather than trusting counts alone.
  assertMeasurementCoverage(system, sources);
}

export function assertMeasurementCoverage(system: DesignSystem, sources: Source[]) {
  for (const source of sources.filter(s => s.weight > 0)) for (const sample of samples(source) || []) {
    const name = prefix(source.label, sample.id);
    if (['heading','body','button','link','input'].includes(sample.kind) && dimension.test(sample.styles.fontSize || '')) {
      const t = system.typography.scale.find(t => t.name === name)?.size;
      if (!t || t.value !== sample.styles.fontSize || t.source.join() !== source.label) issue('measurement_typography_lost');
    }
    if (['heading','body','button','link','input'].includes(sample.kind)) {
      const row = system.typography.scale.find(t => t.name === name);
      for (const [property, key] of [['fontFamily','family'],['lineHeight','line_height'],['letterSpacing','letter_spacing']] as const) {
        const value = sample.styles[property];
        if (!value || (key !== 'family' && !dimension.test(value))) continue;
        if (!row?.[key] || row[key].value !== value || row[key].source.join() !== source.label) issue('measurement_typography_lost');
      }
      const weight = sample.styles.fontWeight;
      if (weight && (/^[1-9]00$/.test(weight) || /^(normal|bold|lighter|bolder)$/.test(weight))) {
        if (!row?.weight || row.weight.value !== weight || row.weight.source.join() !== source.label) issue('measurement_typography_lost');
      }
    }
    if (['button','input','card','navigation','footer'].includes(sample.kind)) {
      const c = system.components.find(c => c.name === name);
      if (!c || !c.values.length || c.source.join() !== source.label) return issue('measurement_component_lost');
      for (const property of componentProperties) {
        if (!sample.styles[property]) continue;
        const t = c.values.find(t => t.name === `${name}-${cssName(property)}`);
        if (!t || t.value !== sample.styles[property] || t.source.join() !== source.label) issue('measurement_component_lost');
      }
    }
    for (const property of ['paddingTop','paddingRight','paddingBottom','paddingLeft']) {
      const value = sample.styles[property];
      if (!value || !dimension.test(value) || (!['section','card','button'].includes(sample.kind) && /^0(?:px)?$/.test(value))) continue;
      const key = `${name}-${property.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}`;
      const t = [...system.spacing.tokens,...system.spacing.section_padding,...system.spacing.card_padding,...system.spacing.button_padding].find(t=>t.name===key);
      if (!t || t.value !== value || t.source.join() !== source.label) issue('measurement_spacing_lost');
    }
  }
}
