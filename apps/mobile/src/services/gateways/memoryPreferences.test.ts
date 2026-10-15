import { describe, expect, it } from 'vitest';
import {
  readMemoryPreferences, sameMemoryPreferences, writeMemoryPreferences,
} from './memoryPreferences';

describe('Agent memory preferences', () => {
  it('retains prompts and unowned memory settings when saving explicit disabled and zero values', () => {
    const config = '{"identity":"persona","capabilities":{"revision":7},"memory":{"enabled":true,"effort":"high","embeddingModel":"existing-model"}}';
    const preferences = readMemoryPreferences(config);
    preferences.enabled = false;
    preferences.tuningEnabled = false;
    preferences.vectorWeight = 0;
    preferences.keywordWeight = 1;
    const output = writeMemoryPreferences(config, preferences);
    expect(JSON.parse(output)).toMatchObject({
      identity: 'persona', capabilities: { revision: 7 },
      memory: { enabled: false, tuningEnabled: false, vectorWeight: 0, keywordWeight: 1,
        effort: 'high', embeddingModel: 'existing-model' },
    });
    expect(sameMemoryPreferences(readMemoryPreferences(output), preferences)).toBe(true);
  });

  it('inherits missing fields while retaining older Agent memory enable and effort choices', () => {
    const result = readMemoryPreferences('{"memory":{"enabled":false,"effort":"low"}}');
    expect(result).toMatchObject({
      enabled: false, tuningEnabled: true, vectorWeight: 0.55, keywordWeight: 0.45, effort: 'low',
    });
  });

  it('rejects a malformed envelope and weights that cannot retrieve any records', () => {
    expect(() => readMemoryPreferences('[]')).toThrow('mobile.settings.memory.invalidConfig');
    const result = readMemoryPreferences('{}');
    result.vectorWeight = 0;
    result.keywordWeight = 0;
    expect(() => writeMemoryPreferences('{}', result)).toThrow('mobile.settings.memory.invalidWeights');
  });
});
