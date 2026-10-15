import type { MomentsFeedState } from './momentsFeedStore';
import type { MomentsAvailability } from '../../runtimes/momentsProjectionDescriptor';
import type { PrivateMomentsRuntimeSnapshot } from '../../runtimes/privateMomentsRuntime';

export interface MobileSocialScope {
  readonly stationPeerId: string;
  readonly actorPtid: string;
  readonly deviceId: string;
  readonly lifecycleGeneration: string;
}

export interface SocialRuntimeProjection {
  readonly availability: MomentsAvailability;
  readonly privateSocial: PrivateMomentsRuntimeSnapshot | null;
}

export interface SocialExperienceProjection {
  readonly scope: MobileSocialScope;
  readonly revision: number;
  readonly home: MomentsFeedState;
  readonly explore: MomentsFeedState;
  readonly runtime: SocialRuntimeProjection;
}

class ImmutableMapSnapshot<K, V> implements ReadonlyMap<K, V> {
  readonly #entries: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#entries = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    return this.#entries.get(key);
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#entries.entries();
  }

  keys(): MapIterator<K> {
    return this.#entries.keys();
  }

  values(): MapIterator<V> {
    return this.#entries.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    this.#entries.forEach((value, key) => {
      callbackfn.call(thisArg, value, key, this);
    });
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'Map';
  }
}

export function createDeepImmutableSocialProjection(
  projection: SocialExperienceProjection,
): SocialExperienceProjection {
  return immutableSnapshot(projection);
}

function immutableSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Map) {
    return new ImmutableMapSnapshot(
      [...value.entries()].map(([key, entryValue]) => [
        immutableSnapshot(key),
        immutableSnapshot(entryValue),
      ] as const),
    ) as T;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map(immutableSnapshot)) as T;
  }

  if (value instanceof Uint8Array) {
    const bytes = value.slice();
    return new Proxy(bytes, {
      get(target, property) {
        if (
          property === 'set'
          || property === 'copyWithin'
          || property === 'fill'
          || property === 'reverse'
          || property === 'sort'
        ) {
          return () => {
            throw new TypeError('immutable Social projection');
          };
        }
        const member = Reflect.get(target, property, target);
        return typeof member === 'function' ? member.bind(target) : member;
      },
      set() {
        throw new TypeError('immutable Social projection');
      },
      defineProperty() {
        throw new TypeError('immutable Social projection');
      },
      deleteProperty() {
        throw new TypeError('immutable Social projection');
      },
    }) as T;
  }

  const snapshot = Object.create(Object.getPrototypeOf(value)) as Record<
    PropertyKey,
    unknown
  >;
  for (const key of Reflect.ownKeys(value)) {
    snapshot[key] = immutableSnapshot(
      (value as Record<PropertyKey, unknown>)[key],
    );
  }
  return Object.freeze(snapshot) as T;
}
