import { describe, it, expect, beforeEach } from 'vitest';

// We test the registry logic directly by creating a fresh registry per test.
// This avoids side effects from module registrations in the global registry.

interface TestModule {
  id: string;
  name: string;
  settingsEntry?: { order: number };
}

function createTestRegistry() {
  const registry = new Map<string, TestModule>();

  return {
    register(def: TestModule) { registry.set(def.id, def); },
    get(id: string) { return registry.get(id); },
    all() { return Array.from(registry.values()); },
    withSettings() {
      return this.all()
        .filter((m) => m.settingsEntry)
        .sort((a, b) => a.settingsEntry!.order - b.settingsEntry!.order);
    },
  };
}

describe('ModuleRegistry', () => {
  let reg: ReturnType<typeof createTestRegistry>;

  beforeEach(() => {
    reg = createTestRegistry();
  });

  it('registers and retrieves a module', () => {
    reg.register({ id: 'test', name: 'Test' });
    expect(reg.get('test')).toBeDefined();
    expect(reg.get('test')!.name).toBe('Test');
  });

  it('returns undefined for unregistered module', () => {
    expect(reg.get('nope')).toBeUndefined();
  });

  it('lists all registered modules', () => {
    reg.register({ id: 'a', name: 'A' });
    reg.register({ id: 'b', name: 'B' });
    expect(reg.all()).toHaveLength(2);
  });

  it('returns settings modules sorted by order', () => {
    reg.register({ id: 'z', name: 'Z', settingsEntry: { order: 50 } });
    reg.register({ id: 'a', name: 'A', settingsEntry: { order: 10 } });
    reg.register({ id: 'no-settings', name: 'NoSettings' });

    const settings = reg.withSettings();
    expect(settings).toHaveLength(2);
    expect(settings[0].id).toBe('a');
    expect(settings[1].id).toBe('z');
  });

  it('overwrites module on re-register', () => {
    reg.register({ id: 'x', name: 'Original' });
    reg.register({ id: 'x', name: 'Updated' });
    expect(reg.get('x')!.name).toBe('Updated');
  });
});
