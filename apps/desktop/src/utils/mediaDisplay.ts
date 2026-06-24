export function formatMediaDurationSeconds(durationSeconds: number | undefined | null): string {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return '';
  const rounded = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
