export type Family = 'explosion' | 'pressure' | 'delivery'
export interface StudyFrame {family: Family; value: number; ink: boolean; phase: string; explosion: number; pressure: number; delivery: number}
export const durationMs: number
export function studyFrame(progress: number): StudyFrame
export function viewBox(explosion: number): string
