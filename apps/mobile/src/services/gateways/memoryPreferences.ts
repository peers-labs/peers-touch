import { create, fromJson, toJson, type JsonObject } from '@bufbuild/protobuf';
import { MemoryPreferencesSchema, type MemoryPreferences } from '../../gen/proto/domain/agent/memory_pb';
import { AgentSettingsError } from './agentSettingsRpc';

const defaults = () => create(MemoryPreferencesSchema, {
  enabled: true, tuningEnabled: true, vectorWeight: 0.55, keywordWeight: 0.45,
});

/** The generated Agent memory contract refines the existing config envelope. */
function envelope(configJson: string): JsonObject {
  try {
    const value: unknown = configJson ? JSON.parse(configJson) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as JsonObject;
  } catch { throw new AgentSettingsError(null, 'mobile.settings.memory.invalidConfig'); }
}

export function readMemoryPreferences(configJson: string): MemoryPreferences {
  const raw = envelope(configJson).memory;
  if (raw === undefined) return defaults();
  try {
    const saved = fromJson(MemoryPreferencesSchema, raw, { ignoreUnknownFields: true });
    const fallback = defaults();
    return create(MemoryPreferencesSchema, {
      enabled: saved.enabled ?? fallback.enabled,
      tuningEnabled: saved.tuningEnabled ?? fallback.tuningEnabled,
      vectorWeight: saved.vectorWeight ?? fallback.vectorWeight,
      keywordWeight: saved.keywordWeight ?? fallback.keywordWeight,
      effort: saved.effort,
    });
  } catch { throw new AgentSettingsError(null, 'mobile.settings.memory.invalidConfig'); }
}

export function writeMemoryPreferences(configJson: string, preferences: MemoryPreferences): string {
  const vector = preferences.vectorWeight ?? 0.55;
  const keyword = preferences.keywordWeight ?? 0.45;
  if (![vector, keyword].every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1)
    || vector + keyword <= 0) throw new AgentSettingsError(null, 'mobile.settings.memory.invalidWeights');
  const config = envelope(configJson);
  const currentMemory = config.memory;
  // Other memory fields, identity prompts and capability bindings retain their
  // ownership. Editing weights cannot discard an unrelated Agent configuration.
  if (currentMemory !== undefined && (!currentMemory || typeof currentMemory !== 'object' || Array.isArray(currentMemory))) {
    throw new AgentSettingsError(null, 'mobile.settings.memory.invalidConfig');
  }
  const policy = toJson(MemoryPreferencesSchema, preferences) as JsonObject;
  return JSON.stringify({ ...config, memory: { ...currentMemory as JsonObject | undefined, ...policy } });
}

export function sameMemoryPreferences(left: MemoryPreferences, right: MemoryPreferences): boolean {
  return left.enabled === right.enabled && left.tuningEnabled === right.tuningEnabled
    && left.vectorWeight === right.vectorWeight && left.keywordWeight === right.keywordWeight
    && left.effort === right.effort;
}

export const defaultMemoryPreferences = defaults;
