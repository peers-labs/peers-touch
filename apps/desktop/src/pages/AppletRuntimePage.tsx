import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Blocks } from 'lucide-react';
import { Empty, Modal, Spin, message, theme } from 'antd';
import { Button } from '@lobehub/ui';
import { PageHeader } from '../components/PageHeader';
import { AppletContainerShell } from '../applet/AppletContainerShell';
import LynxContainer from '../applet/LynxContainer';
import { LynxDebugPanel, createLynxDebugEvent, type LynxDebugEvent } from '../applet/LynxDebugPanel';
import { handleAtelierArtifactPreviewHostUiRequest } from '../applet/AtelierArtifactPreviewHost';
import { getAppletProductWindowLaunchContext } from '../applet/productWindowE2E';
import { requestPageRuntimeRelease } from '../kernel/pageRuntimeLease';
import { markRouteVisible } from '../kernel/frontendRuntimeProfiler';
import { usePageContext } from '../kernel/usePageContext';
import { useActiveAppletsSlice } from './useActiveAppletsStore';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import type { AppletHostDeviceRequest, AppletHostNavigationRequest, AppletHostUiRequest } from '../applet/lynx-host-element';
import type { Page } from '../types/navigation';

interface Props {
  appletId: string;
  onPin?: () => void;
  pinned?: boolean;
}

export function AppletRuntimePage({ appletId, onPin, pinned = false }: Props) {
  const { t } = useTranslation('applet');
  const { navigation } = usePageContext();
  const { token } = theme.useToken();
  const pageId = `applet:${appletId}`;
  const [navigationTitle, setNavigationTitle] = useState<string | null>(null);
  const [debugEvents, setDebugEvents] = useState<LynxDebugEvent[]>([]);
  const [immersive, setImmersive] = useState(() => isStandaloneAppletShell());
  const [controlsVisible, setControlsVisible] = useState(true);
  const productWindowCloseAfterRenderRef = useRef(false);
  const {
    loading,
    applets,
    catalogApplets,
    runtimeErrorDetail,
    runtimeErrorKey,
    allDiagnostics,
  } = useActiveAppletsSlice((state) => ({
    loading: state.loading,
    applets: state.applets,
    catalogApplets: state.catalogApplets,
    runtimeErrorDetail: state.runtimeErrorDetailById[appletId],
    runtimeErrorKey: state.runtimeErrorKeyById[appletId],
    allDiagnostics: state.diagnostics,
  }));
  const runtimeApplet = useMemo(
    () => [...applets, ...catalogApplets].find((item) => item.manifest.id === appletId),
    [applets, catalogApplets, appletId],
  );
  const applet = runtimeApplet?.manifest;
  const appletStatus = runtimeApplet?.status;
  const diagnostics = useMemo(
    () => allDiagnostics
      .filter((diag) => diag.source === appletId)
      .flatMap((diag) => diag.issues),
    [allDiagnostics, appletId],
  );

  const handleClose = useCallback(() => {
    if (isStandaloneAppletShell()) {
      void closeStandaloneAppletWindow().then((closed) => {
        if (!closed) {
          navigation.navigateTo('applets');
          requestPageRuntimeRelease(pageId, 'explicit-close');
        }
      });
      return;
    }
    navigation.navigateTo('applets');
    requestPageRuntimeRelease(pageId, 'explicit-close');
  }, [navigation, pageId]);

  const handleOpenStandalone = useCallback(() => {
    void openStandaloneAppletWindow(appletId, navigationTitle || applet?.name || appletId).catch((error) => {
      log.warn('applets', 'Failed to open standalone applet window', {
        appletId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [applet?.name, appletId, navigationTitle]);

  const handleEnterImmersive = useCallback(() => {
    setImmersive(true);
    setControlsVisible(true);
  }, []);

  const handleExitImmersive = useCallback(() => {
    setImmersive(false);
    setControlsVisible(true);
  }, []);

  const appendDebugEvent = useCallback((event: LynxDebugEvent) => {
    if (!import.meta.env.DEV) return;
    setDebugEvents((current) => [...current.slice(-119), event]);
  }, []);

  const recordDebugStage = useCallback((
    stage: string,
    options?: {
      data?: Record<string, unknown>;
      level?: LynxDebugEvent['level'];
      sessionId?: string;
    },
  ) => {
    appendDebugEvent(createLynxDebugEvent(appletId, stage, options));
  }, [appletId, appendDebugEvent]);

  useEffect(() => {
    setDebugEvents([createLynxDebugEvent(appletId, 'runtime.page.open', {
      data: { pageId },
    })]);
  }, [appletId, pageId]);

  useEffect(() => {
    recordDebugStage('runtime.status', {
      data: {
        loading,
        runtimeErrorDetail,
        runtimeErrorKey,
        status: appletStatus ?? 'missing',
        diagnostics,
      },
      level: runtimeErrorKey ? 'error' : showStatusWarning(appletStatus, loading) ? 'warn' : 'info',
    });
  }, [appletStatus, diagnostics, loading, recordDebugStage, runtimeErrorDetail, runtimeErrorKey]);

  const handleNavigationRequest = useCallback((request: AppletHostNavigationRequest) => {
    const { action, params } = request;
    recordDebugStage('host.navigation.request', { data: { action }, level: 'debug' });
    if (action === 'openApplet') {
      const targetAppletId = stringParam(params, 'appletId') || stringParam(params, 'id');
      if (targetAppletId) navigation.navigateTo(`applet:${targetAppletId}`);
      return;
    }
    if (action === 'closeApplet') {
      handleClose();
      return;
    }
    if (action === 'navigateTo' || action === 'navigate_to' || action === 'redirectTo' || action === 'redirect_to') {
      const page = normalizeAppletNavigationPage(stringParam(params, 'page') || stringParam(params, 'target'));
      if (page) navigation.navigateTo(page);
      return;
    }
    if (action === 'back') {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        navigation.navigateTo('applets');
      }
    }
  }, [handleClose, navigation, recordDebugStage]);

  const handleUiRequest = useCallback((request: AppletHostUiRequest): unknown | Promise<unknown> => {
    const { action, params } = request;
    recordDebugStage('host.ui.request', { data: { action }, level: 'debug' });
    const loadingKey = `applet:${appletId}:loading`;
    const atelierPreviewResult = handleAtelierArtifactPreviewHostUiRequest(request);
    if (atelierPreviewResult) {
      recordDebugStage('host.ui.atelierPreview', {
        data: {
          ok: atelierPreviewResult.ok,
          reason: atelierPreviewResult.reason,
          rendererSessionId: atelierPreviewResult.session?.rendererSessionId,
        },
        level: atelierPreviewResult.ok ? 'info' : 'warn',
      });
      return atelierPreviewResult;
    }
    if (action === 'setNavigationBar' || action === 'set_navigation_bar') {
      const title = stringParam(params, 'title');
      setNavigationTitle(title ?? null);
      return { ok: true };
    }
    if (action === 'showToast') {
      void message.open({
        type: messageTypeParam(params, 'type'),
        content: displayTextParam(params) ?? t('applet.runtime.ui.defaultMessage'),
        duration: numberParam(params, 'durationMs', 2500) / 1000,
      });
      return { ok: true };
    }
    if (action === 'showLoading') {
      void message.loading({
        key: loadingKey,
        content: displayTextParam(params) ?? t('applet.runtime.ui.loading'),
        duration: 0,
      });
      return { ok: true };
    }
    if (action === 'hideLoading') {
      message.destroy(loadingKey);
      return { ok: true };
    }
    if (action === 'showModal') {
      return showAppletModal(params, t);
    }
    if (action === 'showActionSheet') {
      return showAppletActionSheet(params, t);
    }
    return { ok: false, reason: 'unsupported' };
  }, [appletId, recordDebugStage, t]);

  const handleDeviceRequest = useCallback((request: AppletHostDeviceRequest): unknown => {
    recordDebugStage('host.device.request', { data: { action: request.action }, level: 'debug' });
    if (request.action === 'getWindowInfo' || request.action === 'get_window_info') {
      return currentWindowInfo();
    }
    if (request.action === 'getSafeArea' || request.action === 'get_safe_area') {
      return currentSafeArea();
    }
    return { ok: false, reason: 'unsupported' };
  }, [recordDebugStage]);

  const handleAppletLoaded = useCallback((readySource: string) => {
    recordDebugStage('product.rendered.report', { data: { readySource } });
    markRouteVisible(pageId, { readySource, surface: 'applet-runtime' });
    api.appletsProductWindowReportRendered({ appletId, readySource }).catch((error) => {
      log.warn('applets', 'Failed to record product-window render evidence', {
        appletId,
        readySource,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    const productWindowContext = getAppletProductWindowLaunchContext();
    if (
      productWindowContext?.enabled
      && productWindowContext.closeAfterRender
      && productWindowContext.appletId === appletId
      && !productWindowCloseAfterRenderRef.current
    ) {
      productWindowCloseAfterRenderRef.current = true;
      const delayMs = Number.isFinite(productWindowContext.closeAfterRenderDelayMs)
        ? Math.max(0, Number(productWindowContext.closeAfterRenderDelayMs))
        : 3000;
      window.setTimeout(() => {
        log.info('applets', 'product-window E2E closing applet after render', { appletId, delayMs });
        handleClose();
      }, delayMs);
    }
  }, [appletId, handleClose, pageId, recordDebugStage]);

  if (loading && !runtimeApplet) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  if (!applet) {
    return (
      <Flexbox style={{ height: '100%', position: 'relative' }}>
        <PageHeader title={t('applet.runtime.title')} icon={<Blocks size={20} />} />
        <Flexbox align="center" justify="center" style={{ flex: 1, background: token.colorBgLayout }}>
          <Empty
            description={[
              t('applet.runtime.notFound', { id: appletId }),
              ...diagnostics.map((issue, index) => t('applet.runtime.diagnostic', { index: index + 1, issue })),
            ].join('\n')}
          />
        </Flexbox>
        <LynxDebugPanel appletId={appletId} events={debugEvents} onClear={() => setDebugEvents([])} />
      </Flexbox>
    );
  }

  if (appletStatus === 'revoked') {
    return (
      <Flexbox style={{ height: '100%', position: 'relative' }}>
        <PageHeader title={t('applet.runtime.title')} icon={<Blocks size={20} />} />
        <Flexbox align="center" justify="center" style={{ flex: 1, background: token.colorBgLayout }}>
          <Empty description={t('applet.runtime.loadFailed')} />
        </Flexbox>
        <LynxDebugPanel appletId={appletId} events={debugEvents} onClear={() => setDebugEvents([])} />
      </Flexbox>
    );
  }

  const showPreparing = Boolean(runtimeApplet && appletStatus !== 'active');

  const runtimeContent = runtimeErrorKey ? (
    <Flexbox align="center" justify="center" style={{ height: '100%' }}>
      <Empty description={t(runtimeErrorKey)} />
    </Flexbox>
  ) : showPreparing ? (
    <Flexbox align="center" gap={12} justify="center" style={{ height: '100%' }}>
      <Spin size="large" />
      <span style={{ color: token.colorTextSecondary }}>{t('applet.runtime.preparing')}</span>
    </Flexbox>
  ) : (
    <LynxContainer
      appletId={appletId}
      height="100%"
      onLoad={handleAppletLoaded}
      onDebugEvent={appendDebugEvent}
      onBack={handleClose}
      onNavigationRequest={handleNavigationRequest}
      onUiRequest={handleUiRequest}
      onDeviceRequest={handleDeviceRequest}
    />
  );

  return (
    <AppletContainerShell
      appletId={appletId}
      appletName={navigationTitle || applet?.name || appletId}
      controlsVisible={controlsVisible}
      debugEvents={debugEvents}
      immersive={immersive}
      pinned={pinned}
      runtimeContent={runtimeContent}
      subtitle={applet?.description || t('applet.runtime.shellHint')}
      version={applet?.version}
      onClearDebugEvents={() => setDebugEvents([])}
      onClose={handleClose}
      onEnterImmersive={handleEnterImmersive}
      onExitImmersive={handleExitImmersive}
      onHideControls={() => setControlsVisible(false)}
      onOpenStandalone={handleOpenStandalone}
      onPin={onPin}
      onShowControls={() => setControlsVisible(true)}
    />
  );
}

function isStandaloneAppletShell(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('appletStandalone') === '1';
}

function standaloneAppletUrl(appletId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('appletStandalone', '1');
  url.hash = `#/applet:${appletId}`;
  return url.toString();
}

function standaloneAppletWindowLabel(appletId: string): string {
  return `applet_${appletId.replace(/[^a-zA-Z0-9-/:_]/g, '_')}`;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openStandaloneAppletWindow(appletId: string, title: string): Promise<void> {
  const url = standaloneAppletUrl(appletId);
  const label = standaloneAppletWindowLabel(appletId);

  if (isTauriRuntime()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    new WebviewWindow(label, {
      center: true,
      focus: true,
      height: 820,
      minHeight: 640,
      minWidth: 360,
      resizable: true,
      title,
      url,
      width: 430,
    });
    return;
  }

  window.open(url, label, 'popup=yes,width=430,height=820,resizable=yes');
}

async function closeStandaloneAppletWindow(): Promise<boolean> {
  if (isTauriRuntime()) {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWebviewWindow().close();
    return true;
  }
  window.close();
  return window.closed;
}

function showStatusWarning(status: string | undefined, loading: boolean): boolean {
  return loading || status !== 'active';
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeAppletNavigationPage(page?: string): Page | undefined {
  if (!page) return undefined;
  if (page.startsWith('applet:')) return page as Page;
  if (['applets', 'search', 'chat', 'agent', 'notes', 'settings'].includes(page)) {
    return page as Page;
  }
  return undefined;
}

function displayTextParam(params: Record<string, unknown>): string | undefined {
  return stringParam(params, 'message')
    || stringParam(params, 'content')
    || stringParam(params, 'title');
}

function numberParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function messageTypeParam(params: Record<string, unknown>, key: string): 'success' | 'info' | 'warning' | 'error' | 'loading' {
  const value = params[key];
  if (value === 'success' || value === 'warning' || value === 'error' || value === 'loading') return value;
  return 'info';
}

function showAppletModal(
  params: Record<string, unknown>,
  t: (key: string) => string,
): Promise<{ confirmed: boolean; cancelled: boolean }> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: stringParam(params, 'title') ?? t('applet.runtime.ui.modalTitle'),
      content: stringParam(params, 'content') ?? stringParam(params, 'message') ?? '',
      okText: stringParam(params, 'confirmText') ?? t('applet.runtime.ui.confirm'),
      cancelText: stringParam(params, 'cancelText') ?? t('applet.runtime.ui.cancel'),
      onOk: () => {
        resolve({ confirmed: true, cancelled: false });
      },
      onCancel: () => {
        resolve({ confirmed: false, cancelled: true });
      },
    });
  });
}

function showAppletActionSheet(
  params: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string,
): Promise<{ selectedIndex: number; selectedItem: unknown; cancelled: boolean }> {
  return new Promise((resolve) => {
    const items = actionSheetItems(params);
    let modal: ReturnType<typeof Modal.info> | undefined;
    const select = (item: unknown, index: number) => {
      modal?.destroy();
      resolve({ selectedIndex: index, selectedItem: item, cancelled: false });
    };
    modal = Modal.info({
      title: stringParam(params, 'title') ?? t('applet.runtime.ui.actionSheetTitle'),
      content: (
        <Flexbox gap={8} style={{ marginTop: 12 }}>
          {items.map((item, index) => (
            <Button
              key={`${index}:${actionSheetItemLabel(item, index, t)}`}
              onClick={() => select(item, index)}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              {actionSheetItemLabel(item, index, t)}
            </Button>
          ))}
        </Flexbox>
      ),
      okButtonProps: { style: { display: 'none' } },
      onCancel: () => {
        resolve({ selectedIndex: -1, selectedItem: null, cancelled: true });
      },
    });
  });
}

function actionSheetItems(params: Record<string, unknown>): unknown[] {
  const items = params.itemList ?? params.items;
  return Array.isArray(items) && items.length > 0 ? items : [];
}

function actionSheetItemLabel(
  item: unknown,
  index: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (typeof item === 'string' && item.trim().length > 0) return item.trim();
  if (item && typeof item === 'object') {
    const label = (item as Record<string, unknown>).label ?? (item as Record<string, unknown>).title;
    if (typeof label === 'string' && label.trim().length > 0) return label.trim();
  }
  return t('applet.runtime.ui.actionSheetItem', { index: index + 1 });
}

function currentWindowInfo(): { width: number; height: number; pixelRatio: number } {
  const viewport = window.visualViewport;
  return {
    width: Math.max(0, Math.round(viewport?.width ?? window.innerWidth ?? 0)),
    height: Math.max(0, Math.round(viewport?.height ?? window.innerHeight ?? 0)),
    pixelRatio: Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1,
  };
}

function currentSafeArea(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.inset = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
  probe.style.paddingRight = 'env(safe-area-inset-right, 0px)';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
  probe.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
  document.body.appendChild(probe);
  const style = window.getComputedStyle(probe);
  const safeArea = {
    top: cssPixels(style.paddingTop),
    right: cssPixels(style.paddingRight),
    bottom: cssPixels(style.paddingBottom),
    left: cssPixels(style.paddingLeft),
  };
  probe.remove();
  return safeArea;
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
