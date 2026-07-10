// AppletSDK — public API surface with BridgeAdapter architecture.
// Auto-detects the runtime environment and selects the appropriate adapter.

import type { BridgeAdapter } from './adapter.js';
import { detectAdapter } from './detect.js';
import { createStorageAPI } from './capabilities/storage.js';
import { createNetworkAPI } from './capabilities/network.js';
import { createConfigAPI } from './capabilities/config.js';
import { createSystemAPI } from './capabilities/system.js';
import { createDeviceAPI, type DeviceAPI } from './capabilities/device.js';
import { createClipboardAPI, type ClipboardAPI } from './capabilities/clipboard.js';
import { createFileAPI, type FileAPI } from './capabilities/file.js';
import {
  createAgentAPI,
  createAIAPI,
  createAppRuntimeAPI,
  createEventAPI,
  createLifecycleAPI,
  createNavigationAPI,
  createSkillAPI,
  createTaskAPI,
  createTelemetryAPI,
  createTopicSubscriptionManager,
  createUIAPI,
  type AgentAPI,
  type AIAPI,
  type AppRuntimeAPI,
  type EventAPI,
  type LifecycleAPI,
  type NavigationAPI,
  type SkillAPI,
  type TaskAPI,
  type TelemetryAPI,
  type UIAPI,
} from './capabilities/core.js';

import type { StorageAPI } from './capabilities/storage.js';
import type { NetworkAPI, NetworkDownloadOptions, NetworkDownloadResult, NetworkRequestOptions, NetworkResponse, NetworkUploadOptions, NetworkUploadResult } from './capabilities/network.js';
import type { ConfigAPI } from './capabilities/config.js';
import type { SystemAPI, SystemInfo } from './capabilities/system.js';

export class AppletSDK {
  private adapter: BridgeAdapter;
  private eventHandlers: Array<{ topic: string; handler: (payload: unknown) => void }> = [];
  private pendingEvents: Array<{ topic: string; payload: unknown }> = [];
  private unsubscribeBridge: (() => void) | null = null;
  private static readonly MAX_PENDING_EVENTS = 100;

  readonly storage: StorageAPI;
  readonly network: NetworkAPI;
  readonly config: ConfigAPI;
  readonly system: SystemAPI;
  readonly device: DeviceAPI;
  readonly clipboard: ClipboardAPI;
  readonly file: FileAPI;
  readonly app: AppRuntimeAPI;
  readonly lifecycle: LifecycleAPI;
  readonly navigation: NavigationAPI;
  readonly ui: UIAPI;
  readonly events: EventAPI;
  readonly skills: SkillAPI;
  readonly tasks: TaskAPI;
  readonly agent: AgentAPI;
  readonly ai: AIAPI;
  readonly telemetry: TelemetryAPI;

  constructor(adapter?: BridgeAdapter) {
    this.adapter = adapter ?? detectAdapter();
    const addLocalHandler = <T>(topic: string, handler: (payload: T) => void): (() => void) => this.onEvent(topic, handler as (payload: unknown) => void);
    const subscriptions = createTopicSubscriptionManager(this.adapter);
    this.events = createEventAPI(this.adapter, subscriptions, addLocalHandler);
    this.storage = createStorageAPI(this.adapter);
    this.network = createNetworkAPI(this.adapter);
    this.config = createConfigAPI(this.adapter);
    this.system = createSystemAPI(this.adapter);
    this.device = createDeviceAPI(this.adapter);
    this.clipboard = createClipboardAPI(this.adapter);
    this.file = createFileAPI(this.adapter);
    this.app = createAppRuntimeAPI(this.adapter);
    this.lifecycle = createLifecycleAPI(this.adapter, this.events.on);
    this.navigation = createNavigationAPI(this.adapter);
    this.ui = createUIAPI(this.adapter);
    this.skills = createSkillAPI(this.adapter, subscriptions, this.events.on);
    this.tasks = createTaskAPI(this.adapter, this.events.on);
    this.agent = createAgentAPI(this.adapter, subscriptions, this.events.on);
    this.ai = createAIAPI(this.adapter);
    this.telemetry = createTelemetryAPI(this.adapter);

    // Subscribe to bridge events and dispatch to registered handlers
    this.unsubscribeBridge = this.adapter.onEvent((topic, payload) => {
      let delivered = false;
      for (const entry of this.eventHandlers) {
        if (entry.topic === topic) {
          entry.handler(payload);
          delivered = true;
        }
      }
      if (!delivered) {
        this.pendingEvents.push({ topic, payload });
        if (this.pendingEvents.length > AppletSDK.MAX_PENDING_EVENTS) {
          this.pendingEvents.splice(0, this.pendingEvents.length - AppletSDK.MAX_PENDING_EVENTS);
        }
      }
    });
  }

  // Generic invoke for extensions beyond built-in capabilities
  invoke<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.adapter.invoke(method, params) as Promise<T>;
  }

  // Event subscription — returns an unsubscribe function
  onEvent(topic: string, handler: (payload: unknown) => void): () => void {
    const entry = { topic, handler };
    this.eventHandlers.push(entry);
    const remaining: Array<{ topic: string; payload: unknown }> = [];
    for (const event of this.pendingEvents) {
      if (event.topic === topic) {
        handler(event.payload);
      } else {
        remaining.push(event);
      }
    }
    this.pendingEvents = remaining;

    return () => {
      const idx = this.eventHandlers.indexOf(entry);
      if (idx !== -1) {
        this.eventHandlers.splice(idx, 1);
      }
    };
  }

  // Current adapter runtime name
  get runtime(): string {
    return this.adapter.name;
  }

  // Teardown: remove all event listeners
  destroy(): void {
    this.eventHandlers = [];
    this.pendingEvents = [];
    if (this.unsubscribeBridge) {
      this.unsubscribeBridge();
      this.unsubscribeBridge = null;
    }
  }
}

// Singleton instance with auto-detected adapter
export const sdk = new AppletSDK();

// Re-export types and constructs
export type { BridgeAdapter } from './adapter.js';
export type { StorageAPI } from './capabilities/storage.js';
export type { NetworkAPI, NetworkDownloadOptions, NetworkDownloadResult, NetworkRequestOptions, NetworkResponse, NetworkUploadOptions, NetworkUploadResult } from './capabilities/network.js';
export type { ConfigAPI } from './capabilities/config.js';
export type { SystemAPI, SystemInfo } from './capabilities/system.js';
export type { DeviceAPI, SafeArea, VibrationOptions, WindowInfo } from './capabilities/device.js';
export type { ClipboardAPI, ClipboardSetTextOptions } from './capabilities/clipboard.js';
export type { FileAPI, FileEntry, FileInfo, FileListOptions, FileReadOptions, FileReadResult, FileWriteOptions, FileWriteResult } from './capabilities/file.js';
export type {
  AgentAPI,
  AIAPI,
  AppRuntimeAPI,
  EventAPI,
  LifecycleAPI,
  NavigationAPI,
  SkillAPI,
  TaskAPI,
  TelemetryAPI,
  UIAPI,
  Unsubscribe,
} from './capabilities/core.js';
export type {
  ActionSheetItem,
  ActionSheetOptions,
  ActionSheetResult,
  AppletLaunchOptions,
  LoadingOptions,
  ModalOptions,
  ModalResult,
  NavigateToInput,
  NavigationBarOptions,
  NavigationTarget,
  OpenAppletInput,
  RedirectToInput,
  ToastOptions,
  ToastType,
} from '@peers-touch/applet-contract';
export type { AppletEvent, EventCallback } from './types.js';
export { AppletErrorCode, AppletError } from './errors.js';
export { LynxBridgeAdapter } from './adapters/lynx.js';
export { WebHostBridgeAdapter } from './adapters/web-host.js';
export { StandaloneBridgeAdapter } from './adapters/standalone.js';
export { HostUnavailableBridgeAdapter, detectAdapter } from './detect.js';
