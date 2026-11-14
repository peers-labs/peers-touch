import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Drawer } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import { reconcilePrivateMoments } from '../../runtimes/privateMomentsRuntime';
import {
  collectMobileDebugSnapshot,
  type MobileDebugSection,
  type MobileDebugSnapshot,
} from './collectMobileDebugSnapshot';
import './mobileDebugPanel.css';

type ReconcileOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'inactive' }
  | { readonly kind: 'error'; readonly message: string };

type CopyState = 'idle' | 'copied' | 'failed';

type DebugRow = readonly [string, unknown];

function flattenDebugRows(
  value: unknown,
  prefix: string,
  accumulator: DebugRow[],
): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flattenDebugRows(nested, `${prefix}.${key}`, accumulator);
    }
    return;
  }
  accumulator.push([prefix, value]);
}

function sectionRows(
  section: MobileDebugSection<unknown>,
  prefix: string,
): DebugRow[] {
  if (section.status === 'error' || !section.data) return [];
  const rows: DebugRow[] = [];
  flattenDebugRows(section.data, prefix, rows);
  return rows;
}

async function copyDebugPayload(payload: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = payload;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function MobileDebugPanelDrawer() {
  const { t } = useMobileI18n();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<MobileDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconcile, setReconcile] = useState<ReconcileOutcome>({ kind: 'idle' });
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await collectMobileDebugSnapshot());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const runReconcile = useCallback(async () => {
    setReconcile({ kind: 'running' });
    try {
      const report = await reconcilePrivateMoments();
      setReconcile(report === null ? { kind: 'inactive' } : { kind: 'idle' });
      await refresh();
    } catch (error) {
      setReconcile({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [refresh]);

  const copySnapshot = useCallback(async () => {
    if (!snapshot) return;
    try {
      await copyDebugPayload(JSON.stringify(snapshot, null, 2));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [snapshot]);

  const sections = useMemo(() => {
    if (!snapshot) return [];
    return [
      {
        key: 'stationRoute',
        title: t('mobile.debug.section.stationRoute'),
        section: snapshot.stationRoute,
      },
      {
        key: 'messaging',
        title: t('mobile.debug.section.messaging'),
        section: snapshot.messaging,
      },
      {
        key: 'privateSocial',
        title: t('mobile.debug.section.privateSocial'),
        section: snapshot.privateSocial,
      },
      {
        key: 'privateMoments',
        title: t('mobile.debug.section.privateMoments'),
        section: snapshot.privateMoments,
      },
    ] as const;
  }, [snapshot, t]);

  function formatValue(value: unknown): string {
    if (value === null || value === undefined) return t('mobile.debug.none');
    if (typeof value === 'boolean') {
      return value ? t('mobile.debug.yes') : t('mobile.debug.no');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function translateMessage(message: string): string {
    const translated = t(message);
    return translated !== message ? translated : message;
  }

  const copyLabel = copyState === 'copied'
    ? t('mobile.debug.copied')
    : copyState === 'failed'
      ? t('mobile.debug.copyFailed')
      : t('mobile.debug.copy');

  return (
    <>
      <Button
        actionId="mobile.debug.toggle"
        density="comfortable"
        className="mobile-debug-toggle"
        data-acceptance-debug-toggle="true"
        aria-expanded={open}
        onActivate={() => setOpen((current) => !current)}
      >
        {t('mobile.debug.toggle')}
      </Button>
      <Drawer
        open={open}
        side="bottom"
        width="100%"
        className="mobile-debug-drawer"
        title={t('mobile.debug.title')}
        closeLabel={t('mobile.debug.close')}
        onDismiss={() => setOpen(false)}
        style={{
          height: '85dvh',
          maxHeight: 'calc(100dvh - var(--safe-area-top, 0px) - 12px)',
        }}
        contentStyle={{ overscrollBehavior: 'contain', touchAction: 'pan-y' }}
        footer={
          <div className="mobile-debug-footer">
            <Button
              actionId="mobile.debug.close"
              density="comfortable"
              data-acceptance-debug-close="true"
              onActivate={() => setOpen(false)}
            >
              {t('mobile.debug.close')}
            </Button>
          </div>
        }
      >
        <section data-acceptance-debug-panel="true">
          <div className="mobile-debug-actions">
            <Button
              actionId="mobile.debug.refresh"
              density="comfortable"
              data-acceptance-debug-refresh="true"
              execution={loading ? 'pending' : 'idle'}
              availability={loading ? { kind: 'disabled', reason: t('mobile.debug.refresh') } : undefined}
              onActivate={() => void refresh()}
            >
              {t('mobile.debug.refresh')}
            </Button>
            <Button
              actionId="mobile.debug.reconcile"
              density="comfortable"
              data-acceptance-debug-reconcile="true"
              execution={reconcile.kind === 'running' ? 'pending' : 'idle'}
              availability={reconcile.kind === 'running'
                ? { kind: 'disabled', reason: t('mobile.debug.reconciling') } : undefined}
              onActivate={() => void runReconcile()}
            >
              {reconcile.kind === 'running'
                ? t('mobile.debug.reconciling')
                : t('mobile.debug.reconcile')}
            </Button>
            <Button
              actionId="mobile.debug.copy"
              density="comfortable"
              data-acceptance-debug-copy="true"
              availability={!snapshot ? { kind: 'disabled', reason: t('mobile.debug.none') } : undefined}
              onActivate={() => void copySnapshot()}
            >
              {copyLabel}
            </Button>
          </div>
          {reconcile.kind === 'inactive' && (
            <p className="mobile-debug-notice" data-acceptance-debug-reconcile-outcome="inactive">
              {t('mobile.debug.reconcileInactive')}
            </p>
          )}
          {reconcile.kind === 'error' && (
            <p
              className="mobile-debug-notice error"
              data-acceptance-debug-reconcile-outcome="error"
            >
              {translateMessage(reconcile.message)}
            </p>
          )}
          {snapshot && (
            <p className="mobile-debug-timestamp" data-acceptance-debug-timestamp={snapshot.capturedAtMillis}>
              {t('mobile.debug.lastUpdated')}: {new Date(snapshot.capturedAtMillis).toISOString()}
            </p>
          )}
          <div className="mobile-debug-sections">
            {sections.map(({ key, title, section }) => (
              <section key={key} className="mobile-debug-section">
                <h5>
                  {title}
                  <span className={`mobile-debug-badge ${section.status}`}>
                    {t(`mobile.debug.status.${section.status}`)}
                  </span>
                </h5>
                {section.status === 'error' && (
                  <p
                    className="mobile-debug-error"
                    data-acceptance-debug-field={`${key}.error`}
                  >
                    {translateMessage(section.error ?? '')}
                  </p>
                )}
                {section.status === 'empty' && (
                  <p
                    className="mobile-debug-empty"
                    data-acceptance-debug-field={`${key}.empty`}
                  >
                    {t('mobile.debug.none')}
                  </p>
                )}
                <dl>
                  {sectionRows(section, key).map(([field, value]) => (
                    <div
                      key={field}
                      className="mobile-debug-row"
                      data-acceptance-debug-field={field}
                    >
                      <dt>{field}</dt>
                      <dd>{formatValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </section>
      </Drawer>
    </>
  );
}
