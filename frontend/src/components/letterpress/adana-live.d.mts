import type { StudyFrame } from './adana-playback.mjs'
type Track = number[][]
export interface LineData {
  groups: string[]; phases: string[]; samples: number[]; points: number[]
  edges: [number,number,...Track[]][]
}
export function createDraftingRenderer(data: LineData): (frame: Pick<StudyFrame, 'family' | 'value' | 'explosion' | 'pressure' | 'delivery'>) => { paths: string[]; platen: number; handle: number }
