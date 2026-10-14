export function stationDisplayName(
  stationLabel: string,
  stationUrl: string,
  fallback: string,
): string {
  const candidate = stationLabel.trim();
  if (!candidate) return fallback;
  const candidateHost = stationHost(candidate);
  const selectedHost = stationHost(stationUrl);
  if (
    /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    || (candidateHost && selectedHost && candidateHost === selectedHost)
  ) {
    return fallback;
  }
  return candidate;
}

function stationHost(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    ).host.toLowerCase();
  } catch {
    return null;
  }
}
