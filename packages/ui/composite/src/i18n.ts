/**
 * Host translation port. The composite package never imports an i18n framework;
 * hosts inject their bound translate function (Desktop passes react-i18next `t`
 * with namespace, prototype passes a `makeTranslate` wrapper).
 */
export type CompositeTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;
