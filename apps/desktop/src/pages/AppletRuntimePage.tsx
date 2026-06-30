import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Blocks, Pin, PinOff, X } from 'lucide-react';
import { Empty, Modal, Spin, message, theme } from 'antd';
import { Button, Tag } from '@lobehub/ui';
import { PageHeader } from '../components/PageHeader';
import LynxContainer from '../applet/LynxContainer';
import { useAppletsStore } from '../store/applets';
import { usePageContext } from '../kernel/usePageContext';
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
  const [navigationTitle, setNavigationTitle] = useState<string | null>(null);
  const loading = useAppletsStore((state) => state.loading);
  const applets = useAppletsStore((state) => state.applets);
  const catalogApplets = useAppletsStore((state) => state.catalogApplets);
  const refresh = useAppletsStore((state) => state.refresh);
  const loadApplet = useAppletsStore((state) => state.loadApplet);
  const unloadApplet = useAppletsStore((state) => state.unloadApplet);
  const runtimeApplet = useMemo(
    () => [...applets, ...catalogApplets].find((item) => item.manifest.id === appletId),
    [applets, catalogApplets, appletId],
  );
  const applet = runtimeApplet?.manifest;
  const appletStatus = runtimeApplet?.status;
  const allDiagnostics = useAppletsStore((state) => state.diagnostics);
  const diagnostics = useMemo(
    () => allDiagnostics
      .filter((diag) => diag.source === appletId)
      .flatMap((diag) => diag.issues),
    [allDiagnostics, appletId],
  );
  const handleNavigationRequest = useCallback((request: AppletHostNavigationRequest) => {
    const { action, params } = request;
    if (action === 'openApplet') {
      const targetAppletId = stringParam(params, 'appletId') || stringParam(params, 'id');
      if (targetAppletId) navigation.navigateTo(`applet:${targetAppletId}`);
      return;
    }
    if (action === 'closeApplet') {
      navigation.navigateTo('applets');
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
  }, [navigation]);

  const handleUiRequest = useCallback((request: AppletHostUiRequest): unknown | Promise<unknown> => {
    const { action, params } = request;
    const loadingKey = `applet:${appletId}:loading`;
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
  }, [appletId, t]);

  const handleDeviceRequest = useCallback((request: AppletHostDeviceRequest): unknown => {
    if (request.action === 'getWindowInfo' || request.action === 'get_window_info') {
      return currentWindowInfo();
    }
    if (request.action === 'getSafeArea' || request.action === 'get_safe_area') {
      return currentSafeArea();
    }
    return { ok: false, reason: 'unsupported' };
  }, []);

  const handleClose = useCallback(() => {
    void unloadApplet(appletId);
    navigation.navigateTo('applets');
  }, [appletId, navigation, unloadApplet]);

  const handleAppletLoaded = useCallback((readySource: string) => {
    api.appletsProductWindowReportRendered({ appletId, readySource }).catch((error) => {
      log.warn('applets', 'Failed to record product-window render evidence', {
        appletId,
        readySource,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [appletId]);

  useEffect(() => {
    void refresh();
  }, [appletId, refresh]);

  useEffect(() => {
    if (loading || !runtimeApplet || appletStatus === 'active' || appletStatus === 'revoked') return undefined;
    let cancelled = false;
    loadApplet(appletId).catch((error) => {
      if (cancelled) return;
      log.warn('applets', 'Failed to prepare applet runtime route', {
        appletId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [appletId, appletStatus, loadApplet, loading, runtimeApplet]);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  if (!applet) {
    return (
      <Flexbox style={{ height: '100%' }}>
        <PageHeader title={t('applet.runtime.title')} icon={<Blocks size={20} />} />
        <Flexbox align="center" justify="center" style={{ flex: 1, background: token.colorBgLayout }}>
          <Empty
            description={[
              t('applet.runtime.notFound', { id: appletId }),
              ...diagnostics.map((issue, index) => t('applet.runtime.diagnostic', { index: index + 1, issue })),
            ].join('\n')}
          />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        title={navigationTitle || applet?.name || appletId}
        subtitle={applet?.description || ''}
        icon={<Blocks size={20} />}
        actions={(
          <Flexbox horizontal align="center" gap={8}>
            {applet?.version && <Tag>v{applet.version}</Tag>}
            {onPin && (
              <Button
                size="small"
                onClick={onPin}
                icon={pinned ? <PinOff size={14} /> : <Pin size={14} />}
              >
                {pinned ? t('applet.runtime.unpin') : t('applet.runtime.pin')}
              </Button>
            )}
            <Button
              size="small"
              onClick={handleClose}
              icon={<X size={14} />}
            >
              {t('applet.runtime.close')}
            </Button>
          </Flexbox>
        )}
      />
      <Flexbox style={{ flex: 1, padding: 16, background: token.colorBgLayout }}>
        <LynxContainer
          appletId={appletId}
          height="100%"
          onLoad={handleAppletLoaded}
          onBack={handleClose}
          onNavigationRequest={handleNavigationRequest}
          onUiRequest={handleUiRequest}
          onDeviceRequest={handleDeviceRequest}
        />
      </Flexbox>
    </Flexbox>
  );
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
