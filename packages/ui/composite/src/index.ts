/**
 * @peers-touch/ui-composite — public entry point.
 *
 * Three composite components are exported from this barrel. Hosts must NOT
 * deep-path import internal files (test utilities, CSS modules, or type-only
 * siblings of a component). See module-layout.md §3 for the boundary.
 *
 * P0 skeleton exports only the generic port types. Component-specific types
 * and the three surfaces land in P1–P3.
 */

export type { CompositeTranslate } from './i18n';
export type { RegionKey, SurfaceHooks } from './hooks';
