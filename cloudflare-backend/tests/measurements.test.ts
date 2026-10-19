import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/contracts.json';
import type { DesignSystem } from '../src/domain/types';
import { normalize, type Source } from '../src/domain/normalize';
import { assertMeasurementCoverage } from '../src/domain/measurements';
import { renderDocuments, renderExports } from '../src/domain/renderers';

function setup() {
  const f=structuredClone(fixtures[0]);
  const sources=f.sources as Source[];
  sources[0].data.measurements={version:1,samples:[
    {id:'heading-1',kind:'heading',tag:'h3',selector:'html > body > article > h3',styles:{fontFamily:'Sohne',fontSize:'26px',fontWeight:'300',lineHeight:'31.2px',letterSpacing:'-0.52px'}},
    {id:'button-1',kind:'button',tag:'button',selector:'html > body > button',styles:{fontFamily:'Sohne',fontSize:'14px',fontWeight:'400',lineHeight:'normal',letterSpacing:'normal',paddingTop:'12px',paddingRight:'0px',paddingBottom:'12px',paddingLeft:'0px',color:'rgb(6, 27, 49)',backgroundColor:'rgb(255, 255, 255)',borderRadius:'4px'}},
  ]};
  const raw=f.raw as DesignSystem;
  raw.typography.scale=[{name:'invented-heading-role',family:null,size:null,weight:null,line_height:null,letter_spacing:null,use:'Model omitted values'}];
  f.raw.spacing.tokens=[];f.raw.spacing.button_padding=[];
  return {raw,sources};
}
it('retains linked measured values even when the provider omits every dimension',()=>{
  const {raw,sources}=setup();
  const system=normalize(JSON.stringify(raw),sources);
  const row=system.typography.scale.find(t=>t.name==='measured-web-1-heading-1')!;
  expect(row).toMatchObject({size:{value:'26px',status:'detected',source:['web_1']},weight:{value:'300'},line_height:{value:'31.2px'},letter_spacing:{value:'-0.52px'}});
  expect(system.typography.scale.some(t=>t.name==='invented-heading-role')).toBe(false);
  expect(system.spacing.button_padding.map(t=>t.value)).toEqual(['12px','0px','12px','0px']);
  expect(system.components.find(t=>t.name==='measured-web-1-button-1')?.values).toContainEqual(expect.objectContaining({value:'rgb(6, 27, 49)',role:expect.stringContaining('measured-web-1-button-1')}));
  expect(system.metadata.measurement_locators).toMatchObject({'measured-web-1-button-1':{selector:'html > body > button'}});
  expect(system.colors.brand[0].status).toBe('inferred');
  const docs=renderDocuments(system),exp=renderExports(system);
  expect(docs.extended).toContain('size=26px');expect(docs.compact).toContain('size=26px');
  for(const v of Object.values(exp))expect(v).toContain('26px');
  expect(system.known_gaps.map(g=>g.code)).toContain('model-typography-omitted');
});
it('does not turn global frequencies into role-linked measurements',()=>{
  const {raw,sources}=setup();
  sources[0].data.measurements={version:1,samples:[]};
  sources[0].data.fontSizes=[{size:'99px',count:999}];
  const s=normalize(JSON.stringify(raw),sources);
  expect(s.typography.scale.some(t=>t.size?.value==='99px')).toBe(false);
  expect(s.known_gaps.map(g=>g.code)).toContain('measurement-categories-missing');
});
it('keeps normal line-height unavailable instead of inventing a dimension',()=>{
  const {raw,sources}=setup();const s=normalize(JSON.stringify(raw),sources);
  expect(s.typography.scale.find(t=>t.name==='measured-web-1-button-1')?.line_height).toBeNull();
});
it('shows an explicit empty section explanation without changing historical rendering',()=>{
  const {raw,sources}=setup();raw.shapes.aspect_ratios=[];
  const s=normalize(JSON.stringify(raw),sources);
  expect(renderDocuments(s).extended).toContain('No reliable reusable image geometry');
  expect(renderDocuments(s).extended).not.toContain('## Tokens — Colors\n\n*No verified');
  expect(renderDocuments(fixtures[0].normalized as DesignSystem)).toEqual(fixtures[0].documents);
});
it('prevents the provider from impersonating the measurement renderer mode',()=>{
  const f=structuredClone(fixtures[0]);Object.assign(f.raw.metadata,{measurements_version:1});
  expect(normalize(JSON.stringify(f.raw),f.sources as Source[])).toEqual(fixtures[0].normalized);
});
it('fails quality validation if measured values or provenance are lost after normalization',()=>{
  const {raw,sources}=setup();const s=normalize(JSON.stringify(raw),sources);
  s.typography.scale.find(t=>t.name==='measured-web-1-heading-1')!.size!.value='99px';
  expect(()=>assertMeasurementCoverage(s,sources)).toThrow();
  const t=normalize(JSON.stringify(raw),sources);
  t.components.find(t=>t.name==='measured-web-1-button-1')!.values[0].source=['web_2'];
  expect(()=>assertMeasurementCoverage(t,sources)).toThrow();
});
it('treats null state properties as unobserved absence with an explicit gap, not invented values',()=>{
  const {raw,sources}=setup();
  raw.components[0].states=[{name:'default',observed:true,values:[null as never]}];
  const s=normalize(JSON.stringify(raw),sources);
  expect(s.components.find(c=>c.name===raw.components[0].name)?.states || []).toEqual([]);
  expect(s.known_gaps.map(g=>g.code)).toContain('model-state-properties-absent');
  expect(s.components.find(c=>c.name==='measured-web-1-button-1')?.values.length).toBeGreaterThan(0);
});
it('continues rejecting malformed non-null state properties and does not weaken legacy validation',()=>{
  const {raw,sources}=setup();
  raw.components[0].states=[{name:'default',observed:true,values:[null as never, 'not-a-token' as never]}];
  expect(()=>normalize(JSON.stringify(raw),sources)).toThrow();
  const old=structuredClone(fixtures[0]);
  old.raw.components[0].states[0].values=[null as never];
  expect(()=>normalize(JSON.stringify(old.raw),old.sources as Source[])).toThrow();
});
describe('source weighting and isolation',()=>{
  it.each([-50,-25,0,25,50])('keeps measurements source-scoped for bias %s',bias=>{
    const f=structuredClone(fixtures.find(f=>f.bias===bias)!);
    const sources=f.sources as Source[];
    for(const source of sources)source.data.measurements=setup().sources[0].data.measurements;
    const s=normalize(JSON.stringify(f.raw),sources);
    for(const source of sources)expect(s.typography.scale.some(t=>t.name.startsWith(`measured-${source.label.replace('_','-')}-`))).toBe(source.weight>0);
    expect(s.evidence.sources.map(s=>s.weight)).toEqual(sources.map(s=>s.weight));
    expect(s.metadata.measurement_scope).toContain('not blended tokens');
  });
});
