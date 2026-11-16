// Pure shared vocabulary; no registry, provider or process dependencies.
export class MachineDevError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'MachineDevError';
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code, message, detail = {}) {
  throw new MachineDevError(code, message, detail);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}
