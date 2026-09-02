import type { ChatMessage } from '../store/chat';

// Serializes one or more agent messages into a Markdown transcript for
// forwarding into another agent conversation (R9). Mirrors LobeHub's
// buildForwardedContent: a header + role-labelled blocks separated by rules.
// Agent-scoped only — no Social chat coupling.
export function buildForwardedContent(messages: ChatMessage[], header?: string): string {
  const blocks = messages
    .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => {
      const roleLabel = m.role === 'user' ? 'User' : 'Assistant';
      return `**${roleLabel}**\n\n${m.content}`;
    });
  const body = blocks.join('\n\n---\n\n');
  return header ? `${header}\n\n---\n\n${body}` : body;
}
