export function formatMomentTime(
  timestampMillis: number | undefined,
  t: (key: string, options?: { count: number }) => string,
): string {
  if (timestampMillis === undefined || !Number.isFinite(timestampMillis)) return '';
  const age = Math.max(0, Math.floor((Date.now() - timestampMillis) / 1000));
  if (age < 60) return t('moments.time.seconds', { count: age });
  if (age < 3600) return t('moments.time.minutes', { count: Math.floor(age / 60) });
  if (age < 86400) return t('moments.time.hours', { count: Math.floor(age / 3600) });
  if (age < 2592000) return t('moments.time.days', { count: Math.floor(age / 86400) });
  return new Date(timestampMillis).toLocaleDateString();
}
