export function boundedListRange(
  keys: readonly string[],
  anchor: string | undefined,
  size: number,
  initial: 'start' | 'end',
): { start: number; end: number } {
  const limit = Math.max(1, Math.floor(size));
  const index = anchor === undefined ? -1 : keys.indexOf(anchor);
  const start = index >= 0
    ? Math.min(index, Math.max(0, keys.length - limit))
    : initial === 'end' ? Math.max(0, keys.length - limit) : 0;
  return { start, end: Math.min(keys.length, start + limit) };
}
