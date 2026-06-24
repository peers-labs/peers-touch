import type { PrototypeManifest } from './types';

type PrototypeManifestModule = {
  default: PrototypeManifest;
};

const manifestModules = import.meta.glob<PrototypeManifestModule>(
  '../../../*/prototype.manifest.ts',
  { eager: true },
);

export const LOCAL_PROTOTYPES = Object.values(manifestModules)
  .map((module) => module.default)
  .sort(
    (a, b) =>
      a.site.localeCompare(b.site) ||
      (a.order ?? 100) - (b.order ?? 100) ||
      a.id.localeCompare(b.id),
  );
