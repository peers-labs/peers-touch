type AcceptanceHarnessMethod = (...args: never[]) => Promise<unknown>;

interface AcceptanceHarnessNamespace {
  [method: string]: AcceptanceHarnessMethod;
}

interface AcceptanceHarnessRegistry {
  [namespace: string]: AcceptanceHarnessNamespace;
}

declare global {
  interface Window {
    __PT_ACCEPTANCE__?: AcceptanceHarnessRegistry;
  }
}

export function registerAcceptanceHarness(
  namespace: string,
  methods: AcceptanceHarnessNamespace,
): void {
  if (!window.__PT_ACCEPTANCE__) {
    window.__PT_ACCEPTANCE__ = {};
  }
  window.__PT_ACCEPTANCE__[namespace] = methods;
}

export function getAcceptanceHarness(namespace?: string): AcceptanceHarnessNamespace | AcceptanceHarnessRegistry | undefined {
  const root = window.__PT_ACCEPTANCE__;
  if (!root) return undefined;
  if (namespace) return root[namespace];
  return root;
}

interface AcceptanceHarnessModule {
  installAcceptanceHarness(): void;
}

const harnessModules = import.meta.glob<AcceptanceHarnessModule>('./*/harness.ts');

export async function installAcceptanceHarnesses(): Promise<void> {
  const paths = Object.keys(harnessModules).sort();
  for (const path of paths) {
    const module = await harnessModules[path]();
    module.installAcceptanceHarness();
  }
}
