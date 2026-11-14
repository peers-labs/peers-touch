import {
  cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore,
  type FormHTMLAttributes, type ReactElement, type ReactNode,
} from 'react';
import { Field } from './fields';
import { restoreNavigationFocus } from './focus';

export interface ValidationRule<T = unknown> {
  required?: boolean; message?: string; minimum?: number; maximum?: number; pattern?: RegExp;
  validate?: (value: T) => string | undefined | Promise<string | undefined>;
}
export interface FormSnapshot<T> { values: T; errors: Readonly<Record<string, string>>; dirty: boolean }
export class FormValidationError extends Error {
  constructor(readonly errors: Readonly<Record<string,string>>) { super('Form validation failed.'); }
}
export function createFormController<T extends object>(initial: T) {
  let original = { ...initial }, snapshot: FormSnapshot<T> = { values: { ...initial }, errors: {}, dirty: false }, epoch = 0;
  let initialized = Object.keys(initial).length > 0;
  const listeners = new Set<() => void>(), rules = new Map<string, readonly ValidationRule[]>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getValues: (): T => snapshot.values,
    getValue: <K extends keyof T>(name: K): T[K] => snapshot.values[name],
    initialize: (values: T) => {
      if (initialized) return;
      initialized = true; original = {...values};
      snapshot = {values:{...values},errors:{},dirty:false}; emit();
    },
    initializeField: (name: string, value: unknown) => {
      if ((snapshot.values as Record<string,unknown>)[name] !== undefined || value === undefined) return;
      original = {...original,[name]:value};
      snapshot = {...snapshot,values:{...snapshot.values,[name]:value}}; emit();
    },
    setValues: (patch: Partial<T>) => {
      // A field may be bound through both the native onChange bridge and the
      // semantic onValueChange channel for the same keystroke; same-value
      // writes must not mint a new snapshot (no render, no validation epoch).
      const changed = Object.entries(patch).some(([key, next]) =>
        (snapshot.values as Record<string, unknown>)[key] !== next);
      if (!changed) return;
      epoch++; snapshot = { ...snapshot, values: { ...snapshot.values, ...patch }, dirty: true }; emit();
    },
    reset: (next?: T) => {
      epoch++; if (next) original = { ...next };
      snapshot = { values: { ...original }, errors: {}, dirty: false }; emit();
    },
    register: (name: string, valueRules: readonly ValidationRule[]) => {
      rules.set(name, valueRules); return () => { if (rules.get(name) === valueRules) rules.delete(name); };
    },
    validate: async (): Promise<T> => {
      const current = ++epoch, errors: Record<string,string> = {};
      for (const [name, valueRules] of rules) {
        const value = (snapshot.values as Record<string,unknown>)[name];
        for (const rule of valueRules) {
          let message: string | undefined;
          if (rule.required && (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)))
            message = rule.message ?? 'Required';
          const length = typeof value === 'number' ? value : typeof value === 'string' || Array.isArray(value) ? value.length : undefined;
          if (length !== undefined && rule.minimum !== undefined && length < rule.minimum) message = rule.message ?? `Minimum ${rule.minimum}`;
          if (length !== undefined && rule.maximum !== undefined && length > rule.maximum) message = rule.message ?? `Maximum ${rule.maximum}`;
          if (rule.pattern && typeof value === 'string') {
            rule.pattern.lastIndex = 0;
            if (!rule.pattern.test(value)) message = rule.message ?? 'Invalid format';
          }
          if (!message && rule.validate) message = await rule.validate(value);
          if (message) { errors[name] = message; break; }
        }
      }
      if (current !== epoch) throw new FormValidationError({ form: 'Values changed during validation.' });
      snapshot = { ...snapshot, errors }; emit();
      if (Object.keys(errors).length) throw new FormValidationError(errors);
      return snapshot.values;
    },
  };
}
export type FormController<T extends object = Record<string, unknown>> = ReturnType<typeof createFormController<T>>;
export function useFormController<T extends object = Record<string, unknown>>(initial = {} as T): FormController<T> {
  const [controller] = useState(() => createFormController(initial));
  return controller;
}
interface FormContextValue { controller: FormController; disabled: boolean }
const FormContext = createContext<FormContextValue | null>(null);
export function useFormValue<T = unknown>(controller: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => FormSnapshot<object>;
}, name: string): T | undefined {
  const snapshot = useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  return (snapshot.values as Record<string,unknown>)[name] as T | undefined;
}
export interface FormProps<T extends object> extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  controller?: FormController<T>; initialValues?: Partial<T>; disabled?: boolean;
  onCommit?: (values: T) => void; onDraftChange?: (patch: Partial<T>, values: T) => void;
}
export function Form<T extends object>({
  controller: supplied, initialValues, disabled = false, onCommit, onDraftChange, children, className = '', ...props
}: FormProps<T>) {
  const local = useFormController<T>((initialValues ?? {}) as T), controller = supplied ?? local;
  useLayoutEffect(() => { if (initialValues) controller.initialize(initialValues as T); },[controller,initialValues]);
  useEffect(() => {
    let previous = controller.getValues();
    return controller.subscribe(() => {
      const next = controller.getValues();
      if (previous === next) return;
      const patch = Object.fromEntries(Object.entries(next).filter(([key,value]) => (previous as Record<string,unknown>)[key] !== value)) as Partial<T>;
      previous = next; onDraftChange?.(patch,next);
    });
  }, [controller, onDraftChange]);
  return <FormContext.Provider value={{ controller: controller as unknown as FormController, disabled }}>
    <form {...props} className={`pt-form ${className}`} onSubmit={event => {
      event.preventDefault();
      const formElement = event.currentTarget;
      void controller.validate().then(values => onCommit?.(values)).catch(error => {
        if (!(error instanceof FormValidationError)) throw error;
        const first = Object.keys(error.errors)[0];
        const input = formElement.elements.namedItem(first);
        if (input instanceof HTMLElement) restoreNavigationFocus(input);
      });
    }}>{children}</form>
  </FormContext.Provider>;
}
export interface FormFieldProps {
  name: string; label?: ReactNode; rules?: readonly ValidationRule[]; description?: ReactNode;
  required?: boolean; valueKind?: 'value' | 'checked'; children: ReactNode;
  initialValue?: unknown;
  style?: React.CSSProperties;
}
interface ControlledField {
  name?: string; disabled?: boolean; value?: unknown; checked?: boolean;
  onChange?: (event: { target: { value?: unknown; checked?: boolean } }) => void;
  onValueChange?: (value: unknown) => void; onCheckedChange?: (checked: boolean) => void;
  onClear?: () => void;
}
export function FormField({ name, label, rules = [], description, required, initialValue, valueKind = 'value', children, style }: FormFieldProps) {
  const context = useContext(FormContext);
  if (!context) throw new Error('FormField requires Form.');
  const { controller, disabled } = context;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => controller.register(name,rules), [controller,name,rules]);
  useLayoutEffect(() => controller.initializeField(name,initialValue),[controller,name,initialValue]);
  const value = snapshot.values[name], error = snapshot.errors[name];
  // Inject only the channel matching the child's value kind. A value control
  // never receives onCheckedChange and a checked control never receives
  // onValueChange; otherwise unknown semantic props leak onto native elements
  // (React "Unknown event handler property" on the DOM input/button).
  const bindField = (element: ReactElement<ControlledField>) => {
    const own = element.props;
    const binding = valueKind === 'checked'
      ? {
          checked: !!value,
          onChange: (event: { target: { checked?: boolean } }) => {
            own.onChange?.(event); controller.setValues({ [name]: event.target.checked });
          },
          onCheckedChange: (next: boolean) => {
            own.onCheckedChange?.(next); controller.setValues({ [name]: next });
          },
        }
      : {
          value: value ?? '',
          onChange: (event: { target: { value?: unknown } }) => {
            own.onChange?.(event); controller.setValues({ [name]: event.target.value });
          },
          onValueChange: (next: unknown) => {
            own.onValueChange?.(next); controller.setValues({ [name]: next });
          },
          onClear: () => { own.onClear?.(); controller.setValues({ [name]: '' }); },
        };
    return cloneElement(element, { name, disabled: disabled || own.disabled, ...binding });
  };
  const child = isValidElement<ControlledField>(children) ? bindField(children) : children;
  return <Field fieldId={name} label={label} description={description} required={required}
    validation={error ? { state: 'invalid', message: error } : { state: 'unchecked' }} style={style}>{child}</Field>;
}
export function FormGroup({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <fieldset className="pt-form-section"><legend>{title}</legend>{children}</fieldset>;
}
export function FormFooter({ children }: { children: ReactNode }) { return <div className="pt-dialog-footer">{children}</div>; }
