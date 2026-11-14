/**
 * Structural equality for plain protocol-derived data trees.
 *
 * Why hand-rolled instead of JSON.stringify:
 *  - reaction counters are bigint, which JSON.stringify cannot serialize;
 *  - object key order must not affect the result;
 *  - an explicit `undefined` member is semantically identical to an absent key
 *    (normalized projections can carry undefined placeholders that hand-built
 *    state omits), so only defined members participate in the comparison.
 *
 * Inputs are immutable projection snapshots (no functions, DOM nodes, cycles,
 * Date instances, etc.), so a recursive value compare is sufficient. The point
 * is reference stabilization: when a periodic reconcile re-emits an identical
 * projection as a new object, callers keep the existing reference and memoized
 * components do not repaint.
 */
export function structuralEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== 'object' || left === null
    || typeof right !== 'object' || right === null
  ) {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray !== rightIsArray) return false;
  if (leftIsArray && rightIsArray) {
    return left.length === right.length
      && left.every((item, index) => structuralEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => structuralEqual(leftRecord[key], rightRecord[key]));
}
