export type PrototypeChatModelId =
  | 'gpt-5.4'
  | 'gpt-5.4-mini'
  | 'claude-sonnet'
  | 'claude-haiku'
  | 'qwen-max'
  | 'codex-cli/default'
  | 'cursor-cli/auto'
  | 'claude-cli/default'
  | 'trae-cli/default';

export interface PrototypeChatModel {
  id: PrototypeChatModelId;
  label: string;
  description: string;
  providerId: string;
  providerLabel: string;
}

export interface PrototypeChatModelCatalogItem
  extends Omit<PrototypeChatModel, 'providerId' | 'providerLabel'> {
  enabledByDefault?: boolean;
}

export interface PrototypeChatModelProvider {
  id: string;
  label: string;
  enabledByDefault?: boolean;
  models: readonly PrototypeChatModelCatalogItem[];
}

export const PROTOTYPE_CHAT_MODEL_PROVIDERS: readonly PrototypeChatModelProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI-compatible',
    models: [
      { id: 'gpt-5.4', label: 'gpt-5.4', description: 'General-purpose model' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', description: 'Fast, lightweight model' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    enabledByDefault: false,
    models: [
      { id: 'claude-sonnet', label: 'claude-sonnet-4', description: 'Balanced reasoning model' },
      { id: 'claude-haiku', label: 'claude-haiku-4', description: 'Fast response model' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    enabledByDefault: false,
    models: [
      { id: 'qwen-max', label: 'qwen-max', description: 'Local general-purpose model' },
    ],
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    enabledByDefault: false,
    models: [
      { id: 'codex-cli/default', label: 'Default', description: 'Model selected by the registered Codex adapter' },
    ],
  },
  {
    id: 'cursor-cli',
    label: 'Cursor CLI',
    enabledByDefault: false,
    models: [
      { id: 'cursor-cli/auto', label: 'Auto', description: 'Model selected by the registered Cursor adapter' },
    ],
  },
  {
    id: 'claude-cli',
    label: 'Claude CLI',
    enabledByDefault: false,
    models: [
      { id: 'claude-cli/default', label: 'Default', description: 'Model selected by the registered Claude adapter' },
    ],
  },
  {
    id: 'trae-cli',
    label: 'TRAE CLI',
    models: [
      { id: 'trae-cli/default', label: 'Default', description: 'Model selected by the registered TRAE adapter' },
    ],
  },
];

export const PROTOTYPE_CHAT_MODELS: readonly PrototypeChatModel[] =
  PROTOTYPE_CHAT_MODEL_PROVIDERS.flatMap((provider) =>
    provider.models.map((model) => ({
      ...model,
      providerId: provider.id,
      providerLabel: provider.label,
    })));

export const PROTOTYPE_DEFAULT_MODEL: PrototypeChatModelId = 'gpt-5.4';

const DEFAULT_MODEL_KEY = 'peers-prototype-default-chat-model';
const DEFAULT_MODEL_EVENT = 'peers-prototype-default-chat-model-change';
const MODEL_AVAILABILITY_KEY = 'peers-prototype-chat-model-availability-v2';
const MODEL_AVAILABILITY_EVENT = 'peers-prototype-chat-model-availability-change';

export interface PrototypeChatModelAvailability {
  providers: Record<string, boolean>;
  models: Record<string, boolean>;
}

function modelAvailabilityKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function defaultPrototypeChatModelAvailability(): PrototypeChatModelAvailability {
  return {
    providers: Object.fromEntries(PROTOTYPE_CHAT_MODEL_PROVIDERS.map((provider) => [
      provider.id,
      provider.enabledByDefault !== false,
    ])),
    models: Object.fromEntries(PROTOTYPE_CHAT_MODEL_PROVIDERS.flatMap((provider) =>
      provider.models.map((model) => [
        modelAvailabilityKey(provider.id, model.id),
        model.enabledByDefault !== false,
      ]))),
  };
}

export function loadPrototypeChatModelAvailability(): PrototypeChatModelAvailability {
  const defaults = defaultPrototypeChatModelAvailability();
  if (typeof window === 'undefined') return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MODEL_AVAILABILITY_KEY) ?? '{}') as {
      providers?: Record<string, unknown>;
      models?: Record<string, unknown>;
    };
    return {
      providers: Object.fromEntries(Object.entries(defaults.providers).map(([id, enabled]) => [
        id,
        typeof parsed.providers?.[id] === 'boolean' ? parsed.providers[id] : enabled,
      ])),
      models: Object.fromEntries(Object.entries(defaults.models).map(([id, enabled]) => [
        id,
        typeof parsed.models?.[id] === 'boolean' ? parsed.models[id] : enabled,
      ])),
    };
  } catch {
    return defaults;
  }
}

export function isPrototypeChatProviderEnabled(
  providerId: string,
  availability = loadPrototypeChatModelAvailability(),
): boolean {
  return availability.providers[providerId] ?? false;
}

export function isPrototypeChatModelEnabled(
  providerId: string,
  modelId: string,
  availability = loadPrototypeChatModelAvailability(),
): boolean {
  return availability.models[modelAvailabilityKey(providerId, modelId)] ?? false;
}

export function getEnabledPrototypeChatModelProviders(
  availability = loadPrototypeChatModelAvailability(),
): PrototypeChatModelProvider[] {
  return PROTOTYPE_CHAT_MODEL_PROVIDERS
    .filter((provider) => isPrototypeChatProviderEnabled(provider.id, availability))
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) =>
        isPrototypeChatModelEnabled(provider.id, model.id, availability)),
    }))
    .filter((provider) => provider.models.length > 0);
}

export function resolveAvailablePrototypeChatModelId(
  value: unknown,
  availability = loadPrototypeChatModelAvailability(),
): PrototypeChatModelId {
  const normalized = normalizePrototypeChatModelId(value);
  const selected = PROTOTYPE_CHAT_MODELS.find((model) => model.id === normalized);
  if (
    selected
    && isPrototypeChatProviderEnabled(selected.providerId, availability)
    && isPrototypeChatModelEnabled(selected.providerId, selected.id, availability)
  ) {
    return selected.id;
  }
  return getEnabledPrototypeChatModelProviders(availability)[0]?.models[0]?.id
    ?? PROTOTYPE_DEFAULT_MODEL;
}

function persistPrototypeChatModelAvailability(availability: PrototypeChatModelAvailability): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MODEL_AVAILABILITY_KEY, JSON.stringify(availability));
  const storedDefault = normalizePrototypeChatModelId(window.localStorage.getItem(DEFAULT_MODEL_KEY));
  const availableDefault = resolveAvailablePrototypeChatModelId(storedDefault, availability);
  if (availableDefault !== storedDefault) savePrototypeDefaultModel(availableDefault);
  window.dispatchEvent(new CustomEvent<PrototypeChatModelAvailability>(MODEL_AVAILABILITY_EVENT, {
    detail: availability,
  }));
}

export function savePrototypeChatProviderEnabled(providerId: string, enabled: boolean): void {
  const availability = loadPrototypeChatModelAvailability();
  if (!(providerId in availability.providers)) return;
  persistPrototypeChatModelAvailability({
    ...availability,
    providers: { ...availability.providers, [providerId]: enabled },
  });
}

export function savePrototypeChatModelEnabled(
  providerId: string,
  modelId: string,
  enabled: boolean,
): void {
  const availability = loadPrototypeChatModelAvailability();
  const key = modelAvailabilityKey(providerId, modelId);
  if (!(key in availability.models)) return;
  persistPrototypeChatModelAvailability({
    ...availability,
    models: { ...availability.models, [key]: enabled },
  });
}

export function subscribePrototypeChatModelAvailability(
  listener: (availability: PrototypeChatModelAvailability) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onChange = () => listener(loadPrototypeChatModelAvailability());
  window.addEventListener(MODEL_AVAILABILITY_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(MODEL_AVAILABILITY_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function isPrototypeChatModelId(value: unknown): value is PrototypeChatModelId {
  return PROTOTYPE_CHAT_MODELS.some((model) => model.id === value);
}

export function normalizePrototypeChatModelId(value: unknown): PrototypeChatModelId {
  if (isPrototypeChatModelId(value)) return value;
  if (value === 'reasoning') return 'gpt-5.4';
  if (value === 'default') return PROTOTYPE_DEFAULT_MODEL;
  return PROTOTYPE_DEFAULT_MODEL;
}

export function loadPrototypeDefaultModel(): PrototypeChatModelId {
  if (typeof window === 'undefined') return PROTOTYPE_DEFAULT_MODEL;
  return resolveAvailablePrototypeChatModelId(window.localStorage.getItem(DEFAULT_MODEL_KEY));
}

export function savePrototypeDefaultModel(model: PrototypeChatModelId): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEFAULT_MODEL_KEY, model);
  window.dispatchEvent(new CustomEvent<PrototypeChatModelId>(DEFAULT_MODEL_EVENT, {
    detail: model,
  }));
}

export function subscribePrototypeDefaultModel(
  listener: (model: PrototypeChatModelId) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onChange = (event: Event) => {
    if (event instanceof CustomEvent && isPrototypeChatModelId(event.detail)) {
      listener(event.detail);
      return;
    }
    listener(loadPrototypeDefaultModel());
  };
  window.addEventListener(DEFAULT_MODEL_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(DEFAULT_MODEL_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
