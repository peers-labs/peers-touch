/**
 * Simple fuzzy-match scoring for command palette filtering.
 * Returns a score > 0 if the query matches the target, 0 otherwise.
 * Higher scores indicate better matches.
 */
export function fuzzyMatch(query: string, target: string): number {
  if (!query) return 1;

  const normalizedQuery = query.toLowerCase().trim();
  const normalizedTarget = target.toLowerCase();

  if (!normalizedQuery) return 1;

  // Exact substring match — highest priority
  if (normalizedTarget.includes(normalizedQuery)) {
    // Bonus for prefix match
    if (normalizedTarget.startsWith(normalizedQuery)) return 100;
    return 80;
  }

  // Character-by-character fuzzy matching
  let queryIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let i = 0; i < normalizedTarget.length && queryIdx < normalizedQuery.length; i++) {
    if (normalizedTarget[i] === normalizedQuery[queryIdx]) {
      score += 10;
      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) score += 5;
      // Bonus for matching at word boundaries
      if (i === 0 || normalizedTarget[i - 1] === ' ' || normalizedTarget[i - 1] === '-') score += 3;
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  // All query characters must be found in order
  if (queryIdx < normalizedQuery.length) return 0;

  return score;
}

/**
 * Matches query against multiple text fields and returns the best score.
 */
export function fuzzyMatchMulti(query: string, ...targets: (string | undefined)[]): number {
  let best = 0;
  for (const target of targets) {
    if (!target) continue;
    const score = fuzzyMatch(query, target);
    if (score > best) best = score;
  }
  return best;
}
