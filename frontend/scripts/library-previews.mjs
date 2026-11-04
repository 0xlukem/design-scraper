import { readFile } from 'node:fs/promises'

// Vite builds compact card metadata while keeping complete responses lazy-loaded.
const previewPrefix = '\0library-preview:'

export function libraryPreviews() {
  return {
    name: 'library-previews',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.json?library-preview')) return
      const file = await this.resolve(source.split('?')[0], importer, { skipSelf: true })
      if (file) return previewPrefix + file.id.slice(0, -'.json'.length)
    },
    async load(id) {
      if (!id.startsWith(previewPrefix)) return
      const file = id.slice(previewPrefix.length) + '.json'
      this.addWatchFile(file)
      const { design_system: system, metadata } = JSON.parse(await readFile(file, 'utf8'))
      const colors = [...system.colors.brand, ...system.colors.accent, ...system.colors.surfaces, ...system.colors.text]
      const families = [...system.typography.families, ...system.typography.scale.flatMap(spec => spec.family ? [spec.family] : [])]
      const preview = {
        colors: [...new Set(colors.map(token => token.value).filter(value => typeof value === 'string'))].slice(0, 4),
        fonts: [...new Set(families.map(token => typeof token.value === 'string' ? token.value.split(',')[0].trim().replace(/["']/g, '') : '').filter(Boolean))],
        weights: metadata.mode === 'mix' ? metadata.sources.map(source => source.influence) : null,
      }
      return `export default ${JSON.stringify(preview)}`
    },
  }
}
