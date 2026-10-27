import catalog from './examples/catalog.json'
import type { AnalysisResult, AppMode, MixBias } from './types'

export interface LibraryExample {
  id: string
  name: string
  description: string
  category: string
  /** ISO date of the saved analysis. */
  date: string
  mode: AppMode
  bias?: MixBias
  sources: string[]
  /** Local artwork from the reference site's public branding, with provenance. */
  cover: {
    src: string
    alt: string
    sourceUrls: string[]
  }
  initials: string
  /** Four representative colors from the saved design, darkest to lightest. */
  palette: string[]
  /** Cover background used by the Mix It world. */
  tone: string
  load: () => Promise<AnalysisResult>
}

// Saved responses stay separate chunks; the catalog only carries their metadata.
const modules = import.meta.glob<{ default: AnalysisResult }>(['./examples/*.json', '!./examples/catalog.json'])

export const libraryExamples: LibraryExample[] = (catalog as Omit<LibraryExample, 'load'>[]).map(entry => {
  const loader = modules[`./examples/${entry.id}.json`]
  if (!loader) throw new Error(`Missing saved design for ${entry.id}`)
  return { ...entry, load: async () => (await loader()).default }
})

export function formatLibraryDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** URL suggestions for the forms, taken from designs already in the library. */
export function librarySuggestions(mode: AppMode, limit: number): LibraryExample[] {
  return libraryExamples.filter(example => example.mode === mode).slice(0, limit)
}
