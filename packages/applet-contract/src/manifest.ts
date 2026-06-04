// Applet manifest type definitions and validation.
// Aligned with architecture document data-model.md AppletManifest structure.

export interface LynxWebLoad {
  type: 'lynx-web';
  entry: string;
}

export interface LynxNativeLoad {
  type: 'lynx-native';
  entry: string;
}

export interface WebSpaLoad {
  type: 'web-spa';
  entry: string;
}

export interface AppletLoadMap {
  desktop?: LynxWebLoad;
  android?: LynxNativeLoad;
  ios?: LynxNativeLoad;
  standalone?: WebSpaLoad;
}

export interface AppletBridge {
  protocol: 'peers-touch.applet.bridge';
  version: string;
}

export type TargetPlatform = 'desktop' | 'android' | 'ios' | 'standalone';

export interface AppletManifest {
  id: string;
  name: string;
  version: string;
  load: AppletLoadMap;
  bridge: AppletBridge;
  targetPlatforms: TargetPlatform[];
  permissions: string[];
  capabilities: string[];
}

// Runtime validation for untrusted manifest input.
export function validateManifest(raw: unknown): {
  valid: boolean;
  errors: string[];
  manifest?: AppletManifest;
} {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['manifest must be a non-null object'] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    errors.push('id must be a non-empty string');
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push('name must be a non-empty string');
  }
  if (typeof obj.version !== 'string' || obj.version.length === 0) {
    errors.push('version must be a non-empty string');
  }

  // Validate load
  if (typeof obj.load !== 'object' || obj.load === null) {
    errors.push('load must be a non-null object');
  } else {
    const load = obj.load as Record<string, unknown>;
    const platformValidators: Record<string, string> = {
      desktop: 'lynx-web',
      android: 'lynx-native',
      ios: 'lynx-native',
      standalone: 'web-spa',
    };

    for (const [platform, expectedType] of Object.entries(platformValidators)) {
      if (load[platform] !== undefined) {
        const entry = load[platform] as Record<string, unknown>;
        if (typeof entry !== 'object' || entry === null) {
          errors.push(`load.${platform} must be an object`);
        } else if (entry.type !== expectedType) {
          errors.push(`load.${platform}.type must be '${expectedType}'`);
        } else if (typeof entry.entry !== 'string' || entry.entry.length === 0) {
          errors.push(`load.${platform}.entry must be a non-empty string`);
        }
      }
    }
  }

  // Validate bridge
  if (typeof obj.bridge !== 'object' || obj.bridge === null) {
    errors.push('bridge must be a non-null object');
  } else {
    const bridge = obj.bridge as Record<string, unknown>;
    if (bridge.protocol !== 'peers-touch.applet.bridge') {
      errors.push("bridge.protocol must be 'peers-touch.applet.bridge'");
    }
    if (typeof bridge.version !== 'string' || bridge.version.length === 0) {
      errors.push('bridge.version must be a non-empty string');
    }
  }

  // Validate targetPlatforms
  const validPlatforms: TargetPlatform[] = ['desktop', 'android', 'ios', 'standalone'];
  if (!Array.isArray(obj.targetPlatforms)) {
    errors.push('targetPlatforms must be an array');
  } else {
    for (const p of obj.targetPlatforms) {
      if (!validPlatforms.includes(p as TargetPlatform)) {
        errors.push(`targetPlatforms contains invalid value: ${String(p)}`);
      }
    }
  }

  // Validate permissions
  if (!Array.isArray(obj.permissions)) {
    errors.push('permissions must be an array');
  } else {
    for (const p of obj.permissions) {
      if (typeof p !== 'string') {
        errors.push('permissions must contain only strings');
        break;
      }
    }
  }

  // Validate capabilities
  if (!Array.isArray(obj.capabilities)) {
    errors.push('capabilities must be an array');
  } else {
    for (const c of obj.capabilities) {
      if (typeof c !== 'string') {
        errors.push('capabilities must contain only strings');
        break;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], manifest: raw as unknown as AppletManifest };
}
