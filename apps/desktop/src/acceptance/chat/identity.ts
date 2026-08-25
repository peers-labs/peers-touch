export function requireCanonicalAcceptancePtid(value: string | null | undefined): string {
  const ptid = value?.trim() ?? '';
  if (!ptid.startsWith('ptid:')) {
    throw new Error('authenticated actor has no canonical PTID');
  }
  return ptid;
}
