export const CapabilityMethod = {
  AppGetContext: 'app.getContext',
  AppGetLaunchOptions: 'app.getLaunchOptions',
  LifecycleOnReady: 'lifecycle.onReady',
  LifecycleReportReady: 'lifecycle.reportReady',
  LifecycleOnShow: 'lifecycle.onShow',
  LifecycleOnHide: 'lifecycle.onHide',
  LifecycleOnPause: 'lifecycle.onPause',
  LifecycleOnResume: 'lifecycle.onResume',
  LifecycleOnDestroy: 'lifecycle.onDestroy',
  LifecycleDestroy: 'lifecycle.destroy',
  NavigationOpenApplet: 'navigation.openApplet',
  NavigationCloseApplet: 'navigation.closeApplet',
  NavigationNavigateTo: 'navigation.navigateTo',
  NavigationRedirectTo: 'navigation.redirectTo',
  NavigationBack: 'navigation.back',
  NetworkRequest: 'network.request',
  NetworkUpload: 'network.upload',
  NetworkDownload: 'network.download',
  StorageGet: 'storage.get',
  StorageSet: 'storage.set',
  StorageRemove: 'storage.remove',
  StorageClear: 'storage.clear',
  StorageKeys: 'storage.keys',
  StorageGetInfo: 'storage.getInfo',
  ConfigGet: 'config.get',
  SystemGetInfo: 'system.getInfo',
  SystemGetTheme: 'system.getTheme',
  SystemGetNetworkType: 'system.getNetworkType',
  UiShowToast: 'ui.showToast',
  UiShowLoading: 'ui.showLoading',
  UiHideLoading: 'ui.hideLoading',
  UiShowModal: 'ui.showModal',
  UiShowActionSheet: 'ui.showActionSheet',
  UiSetNavigationBar: 'ui.setNavigationBar',
  DeviceGetSafeArea: 'device.getSafeArea',
  DeviceGetWindowInfo: 'device.getWindowInfo',
  DeviceVibrate: 'device.vibrate',
  ClipboardGetText: 'clipboard.getText',
  ClipboardSetText: 'clipboard.setText',
  FileRead: 'file.read',
  FileWrite: 'file.write',
  FileDelete: 'file.delete',
  FileList: 'file.list',
  FileGetInfo: 'file.getInfo',
  EventsEmit: 'events.emit',
  EventsSubscribe: 'events.subscribe',
  EventsUnsubscribe: 'events.unsubscribe',
  EventsPoll: 'events.poll',
  SkillsRegister: 'skills.register',
  SkillsList: 'skills.list',
  SkillsInvoke: 'skills.invoke',
  TasksStart: 'tasks.start',
  TasksGet: 'tasks.get',
  TasksCancel: 'tasks.cancel',
  AgentStartSession: 'agent.startSession',
  AgentSend: 'agent.send',
  AgentStream: 'agent.stream',
  AtelierWorkspaceLoad: 'atelier.workspace.load',
  AtelierProjectCreateFromGoal: 'atelier.project.createFromGoal',
  AtelierMessageSend: 'atelier.message.send',
  AtelierEscalationResolve: 'atelier.escalation.resolve',
  AtelierTaskSetStatus: 'atelier.task.setStatus',
  AtelierTaskPurge: 'atelier.task.purge',
  AtelierProviderCapabilities: 'atelier.provider.capabilities',
  AtelierFeedbackSubmit: 'atelier.feedback.submit',
  AtelierMemoryConfirmCandidate: 'atelier.memory.confirmCandidate',
  AtelierFeedbackConfirmRerun: 'atelier.feedback.confirmRerun',
  AtelierWorkspaceOpen: 'atelier.workspace.open',
  AtelierArtifactBodyFetch: 'atelier.artifact.body.fetch',
  AtelierArtifactPreviewOpen: 'atelier.artifact.preview.open',
  AtelierEventsSubscribe: 'atelier.events.subscribe',
  AiGenerate: 'ai.generate',
  AiChat: 'ai.chat',
  TelemetryTrack: 'telemetry.track',
  TelemetryReportError: 'telemetry.reportError',
  TelemetryMark: 'telemetry.mark',
} as const;

export type CapabilityMethod = (typeof CapabilityMethod)[keyof typeof CapabilityMethod];

export const CapabilityMethods = Object.values(CapabilityMethod);

export const CAPABILITY_METHODS_SCHEMA = Object.freeze([...CapabilityMethods]);

export type AppletPermission = CapabilityMethod;

export function isCapabilityMethod(value: unknown): value is CapabilityMethod {
  return typeof value === 'string' && (CapabilityMethods as string[]).includes(value);
}

export interface NetworkRequestParams {
  service: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  stream?: boolean;
}

export interface NetworkResponse<TBody = unknown> {
  status: number;
  headers: Record<string, string>;
  body: TBody;
}

export interface NetworkUploadParams {
  service: string;
  path: string;
  filePath?: string;
  fileName?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface NetworkDownloadParams {
  service: string;
  path: string;
  filePath?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface StorageInfo {
  quotaBytes: number;
  usedBytes: number;
  keys: string[];
}

export interface AppRuntimeContext {
  appletId: string;
  sessionId: string;
  platform: 'desktop' | 'android' | 'ios' | 'harmony' | 'web' | 'standalone';
  runtime: 'lynx' | 'lynx-web' | 'web-host' | 'standalone';
  sdkVersion: string;
  bridgeProtocol: 'peers-touch.applet.bridge';
  launchParams?: Record<string, unknown>;
}

export interface SystemInfo {
  platform: AppRuntimeContext['platform'];
  hostVersion?: string;
  locale?: string;
  theme?: 'light' | 'dark' | 'system';
  networkType?: 'wifi' | 'cellular' | 'ethernet' | 'offline' | 'unknown';
}

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WindowInfo {
  width: number;
  height: number;
  pixelRatio: number;
}

export interface FileEntry {
  path: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
}

export interface FileInfo {
  quotaBytes: number;
  usedBytes: number;
  entries: FileEntry[];
}
