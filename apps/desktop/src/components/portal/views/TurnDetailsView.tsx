import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Spin, Tag, Typography, theme } from 'antd';
import { Download, RefreshCw } from 'lucide-react';
import { Flexbox } from 'react-layout-kit';
import { useTranslation } from 'react-i18next';

import type { ExportTurnDiagnosticsResponse } from '../../../gen/proto/domain/agent/agent_pb';
import { loadAgentTurnDiagnostics } from '../../../diagnostics/agentTurnEvidence';

function diagnosticJson(value: ExportTurnDiagnosticsResponse): string {
  return JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ), 2);
}

export function acceptTurnDiagnostics(
  expectedTurnId: string,
  response: ExportTurnDiagnosticsResponse,
): ExportTurnDiagnosticsResponse {
  if (response.replay?.turnId !== expectedTurnId) {
    throw new Error('agent.error.turnDiagnosticsIdentityMismatch');
  }
  return response;
}

export function turnDiagnosticsExportFilename(
  diagnostics: ExportTurnDiagnosticsResponse,
): string {
  const turnId = diagnostics.replay?.turnId;
  if (!turnId) {
    throw new Error('agent.error.turnDiagnosticsIdentityMissing');
  }
  return `turn-${turnId}-diagnostics.json`;
}

export function TurnDetailsView({ turnId }: { turnId: string }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [diagnostics, setDiagnostics] = useState<ExportTurnDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(false);
    try {
      const response = await loadAgentTurnDiagnostics(turnId);
      if (requestId !== loadRequestRef.current) return;
      setDiagnostics(acceptTurnDiagnostics(turnId, response));
    } catch {
      if (requestId !== loadRequestRef.current) return;
      setDiagnostics(null);
      setError(true);
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [turnId]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [load]);

  const sources = useMemo(() => {
    const values = new Map<string, { id: string; type: number }>();
    for (const ledger of diagnostics?.replay?.contextLedgers ?? []) {
      for (const segment of ledger.segments) {
        for (const sourceRef of segment.sourceRefs) {
          values.set(`${segment.type}:${sourceRef}`, { id: sourceRef, type: segment.type });
        }
      }
    }
    return [...values.values()];
  }, [diagnostics]);

  const exportDiagnostics = useCallback(() => {
    if (!diagnostics) return;
    const blob = new Blob([diagnosticJson(diagnostics)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = turnDiagnosticsExportFilename(diagnostics);
    anchor.click();
    URL.revokeObjectURL(href);
  }, [diagnostics]);

  if (loading) {
    return <Spin data-turn-details-state="loading" />;
  }

  if (error || !diagnostics?.replay) {
    return (
      <Flexbox data-turn-details data-turn-details-state="error" gap={12} align="center">
        <Empty description={t('chat.message.turnDetails.loadFailed')} />
        <Button icon={<RefreshCw size={14} />} onClick={() => void load()}>
          {t('chat.message.turnDetails.retry')}
        </Button>
      </Flexbox>
    );
  }

  const replay = diagnostics.replay;
  const usage = replay.attempts[replay.attempts.length - 1]?.usage;

  return (
    <Flexbox data-turn-details data-turn-details-state="ready" gap={16}>
      <Flexbox horizontal align="center" justify="space-between" gap={12}>
        <Typography.Text type="secondary">
          {t('chat.message.turnDetails.turnId', { id: replay.turnId })}
        </Typography.Text>
        <Button
          data-turn-diagnostics-export
          icon={<Download size={14} />}
          onClick={exportDiagnostics}
        >
          {t('chat.message.turnDetails.export')}
        </Button>
      </Flexbox>

      <Flexbox gap={8}>
        <Typography.Text strong>{t('chat.message.turnDetails.usage')}</Typography.Text>
        <Flexbox
          gap={6}
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: 12,
          }}
        >
          <Typography.Text>{t('chat.message.turnDetails.inputTokens', { count: Number(usage?.inputTokens ?? 0n) })}</Typography.Text>
          <Typography.Text>{t('chat.message.turnDetails.outputTokens', { count: Number(usage?.outputTokens ?? 0n) })}</Typography.Text>
          <Typography.Text>{t('chat.message.turnDetails.toolCalls', { count: replay.toolCalls.length })}</Typography.Text>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={8}>
        <Typography.Text strong>{t('chat.message.turnDetails.sources')}</Typography.Text>
        {sources.length === 0 ? (
          <Typography.Text type="secondary">{t('chat.message.diagnostics.none')}</Typography.Text>
        ) : (
          <Flexbox data-turn-details-sources horizontal gap={6} wrap="wrap">
            {sources.map((source) => (
              <Tag data-source-badge="context" data-source-id={source.id} key={`${source.type}:${source.id}`}>
                {source.id}
              </Tag>
            ))}
          </Flexbox>
        )}
      </Flexbox>

      {replay.terminalReason && (
        <Flexbox gap={4}>
          <Typography.Text strong>{t('chat.message.turnDetails.terminalReason')}</Typography.Text>
          <Typography.Text type="secondary">{replay.terminalReason}</Typography.Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}
