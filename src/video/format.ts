export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// mm:ss (zero-padded seconds). Used by trim/cover UI and accessibility labels.
export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
