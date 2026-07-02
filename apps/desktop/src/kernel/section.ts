import type { ReactNode } from 'react';

export type SectionCachePolicy = 'first-visit-cache' | 'selected-only' | 'none';

export interface SectionHostPolicy {
  readonly cache: SectionCachePolicy;
}

export interface SectionFactoryContext {
  readonly active: boolean;
  readonly highlightId?: string;
  readonly sectionId: string;
}

export interface SectionDescriptor {
  readonly id: string;
  readonly policy?: SectionHostPolicy;
  render(context: SectionFactoryContext): ReactNode;
}

export const DEFAULT_SECTION_HOST_POLICY: SectionHostPolicy = {
  cache: 'first-visit-cache',
};

export function getSectionHostPolicy(descriptor: Pick<SectionDescriptor, 'policy'>): SectionHostPolicy {
  return descriptor.policy ?? DEFAULT_SECTION_HOST_POLICY;
}

export function shouldRenderSection(
  descriptor: Pick<SectionDescriptor, 'id' | 'policy'>,
  activeSectionId: string,
  mountedSectionIds: ReadonlySet<string>,
): boolean {
  if (descriptor.id === activeSectionId) return true;
  return getSectionHostPolicy(descriptor).cache === 'first-visit-cache' && mountedSectionIds.has(descriptor.id);
}

export function nextMountedSectionIds(
  descriptor: Pick<SectionDescriptor, 'id' | 'policy'> | undefined,
  mountedSectionIds: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!descriptor || getSectionHostPolicy(descriptor).cache !== 'first-visit-cache') return mountedSectionIds;
  if (mountedSectionIds.has(descriptor.id)) return mountedSectionIds;
  const next = new Set(mountedSectionIds);
  next.add(descriptor.id);
  return next;
}
