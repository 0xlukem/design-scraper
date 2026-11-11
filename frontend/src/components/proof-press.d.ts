import type { AppMode } from '../types'

export function createProofPress(host: HTMLDivElement, canvas: HTMLCanvasElement, labels: string[], mode: AppMode): {
  render(progress: number): void
  resize(width: number, height: number): void
  dispose(): void
}
