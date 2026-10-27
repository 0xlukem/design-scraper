// Lightweight card metadata derived from saved responses; no network or model calls.
import { readFile, writeFile } from 'node:fs/promises'
const source = new URL('../src/', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('examples/catalog.json', source), 'utf8'))
const previews = {}
for (const entry of catalog) {
  const { design_system: system, metadata } = JSON.parse(await readFile(new URL(`examples/${entry.id}.json`, source), 'utf8'))
  const colors = [...system.colors.brand, ...system.colors.accent, ...system.colors.surfaces, ...system.colors.text]
  const families = [...system.typography.families, ...system.typography.scale.flatMap(spec => spec.family ? [spec.family] : [])]
  previews[entry.id] = {
    colors: [...new Set(colors.map(token => token.value).filter(value => typeof value === 'string'))].slice(0, 4),
    fonts: [...new Set(families.map(token => typeof token.value === 'string' ? token.value.split(',')[0].trim().replace(/["']/g, '') : '').filter(Boolean))],
    weights: metadata.mode === 'mix' ? metadata.sources.map(source => source.influence) : null,
  }
}
await writeFile(new URL('library-previews.json', source), JSON.stringify(previews, null, 2) + '\n')
