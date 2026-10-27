import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const barSource = readFileSync(
  new URL('./TurnArtifactBar.tsx', import.meta.url),
  'utf8',
);
const assistantMessageSource = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('TurnArtifactBar ordinary-user artifact entry', () => {
  it('is mounted on every assistant message and scoped to the producing turn', () => {
    expect(assistantMessageSource).toContain(
      '<TurnArtifactBar turnId={message.turnId} />',
    );
  });

  it('projects Station-persisted artifacts from the chat artifact store, never message text', () => {
    expect(barSource).toContain('useChatArtifactStore');
    expect(barSource).toContain('state.byConversationId[conversationId]');
    expect(barSource).toContain('artifact.turnId === turnId');
    expect(barSource).not.toContain('extractMessageArtifacts');
  });

  it('opens the portal detail view with the real artifact record', () => {
    expect(barSource).toContain('usePortalStore.getState().openArtifact(artifact)');
  });

  it('renders stable ordinary-user anchors for journeys and per-artifact attribution', () => {
    expect(barSource).toContain('data-pt-agent-turn-artifacts={turnId}');
    expect(barSource).toContain('data-pt-agent-turn-artifact={artifact.id}');
    expect(barSource).toContain('data-turn-artifact-turn-id={artifact.turnId}');
    expect(barSource).toContain('data-pt-agent-turn-artifact-open={artifact.id}');
  });

  it('renders nothing without a turn id or turn artifacts', () => {
    expect(barSource).toContain(
      "if (!turnId || turnArtifacts.length === 0) return null;",
    );
  });

  it('uses locale keys for every user-visible label', () => {
    expect(barSource).toContain("useTranslation('agent')");
    expect(barSource).toContain('agent.turnArtifact.title');
    expect(barSource).toContain('agent.portal.artifact.onDevice');
    expect(barSource).toContain('agent.portal.artifact.stationCopy');
    expect(barSource).toContain('agent.portal.artifact.originalDevice');
    expect(barSource).toContain("title={t('agent.portal.artifact.open')}");
  });
});
