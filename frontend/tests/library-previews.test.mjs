import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { expect, it } from 'vitest'
import { libraryPreviews } from '../scripts/library-previews.mjs'

it('builds cards for new catalog entries while keeping the saved document in a lazy chunk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-scraper-library-'))
  try {
    await mkdir(join(root, 'examples'))
    const entry = join(root, 'library.ts')
    await copyFile(join(process.cwd(), 'src/library.ts'), entry)
    await writeFile(join(root, 'examples/catalog.json'), JSON.stringify([{ id: 'new-reference', mode: 'single' }]))
    await writeFile(join(root, 'examples/new-reference.json'), JSON.stringify({
      design_system: { colors: { brand: [{ value: '#0acafe' }], accent: [], surfaces: [], text: [] }, typography: { families: [], scale: [] } },
      documents: { extended: 'Full document from a newly added reference' }, metadata: { mode: 'single' },
    }))
    const [result] = await build({ root, configFile: false, plugins: [libraryPreviews()], logLevel: 'silent',
      build: { write: false, lib: { entry, formats: ['es'] }, minify: false },
    })
    const chunks = result.output.filter(file => file.type === 'chunk')
    const card = chunks.find(chunk => chunk.isEntry).code
    expect(card).toContain('#0acafe')
    expect(card).not.toContain('Full document from a newly added reference')
    expect(chunks.some(chunk => !chunk.isEntry && chunk.code.includes('Full document from a newly added reference'))).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
