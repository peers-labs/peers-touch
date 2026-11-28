/**
 * Generic region identifier; each composite narrows this to its own literal
 * union inside `<Component>.types.ts`. Only used as a type parameter — no
 * runtime values reference this symbol.
 */
export type RegionKey = string;

/**
 * Host-injected legacy class names and data hooks, preserving existing
 * native-gate and north-star-suite selectors. The composite renders its own
 * `ptc-*` class and `data-ui-*` hooks; hosts merge legacy selectors through
 * this surface at their adaptation layer.
 *
 * See CMP-D03 (design.md) and data-model.md §1 for the contract.
 */
export interface SurfaceHooks<K extends RegionKey> {
  classNames?: Partial<Record<K, string>>;
  dataAttributes?: Partial<
    Record<K, Record<string, string | boolean | undefined>>
  >;
}
