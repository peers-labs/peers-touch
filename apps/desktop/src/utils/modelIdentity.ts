import type { AvailableModel, ModelRef } from '../services/desktop_api';

export function modelIdentityKey(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

export function availableModelIdentityKey(model: AvailableModel): string {
  return modelIdentityKey(model.provider_id, model.id);
}

export function parseModelIdentityKey(value: string): ModelRef | undefined {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
      && parsed[0]
      && parsed[1]
    ) {
      return { provider: parsed[0], model: parsed[1] };
    }
  } catch {
    // Invalid values are treated as no selection.
  }
  return undefined;
}

export function findAvailableModel(
  models: AvailableModel[],
  reference?: Partial<ModelRef>,
): AvailableModel | undefined {
  if (!reference?.provider || !reference.model) return undefined;
  return models.find(
    (model) =>
      model.provider_id === reference.provider
      && model.id === reference.model,
  );
}

export function findUniqueAvailableModelById(
  models: AvailableModel[],
  modelId: string,
): AvailableModel | undefined {
  if (!modelId) return undefined;
  const matches = models.filter((model) => model.id === modelId);
  return matches.length === 1 ? matches[0] : undefined;
}
