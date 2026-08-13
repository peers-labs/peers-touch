import { useState } from 'react';
import type { ReactNode } from 'react';
import { theme } from 'antd';
import type { MessageArtifact } from '../../store/chat';

// --- Time formatting helpers ---

export function timeAgo(ts: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return t('chat.message.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('chat.message.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('chat.message.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('chat.message.daysAgo', { count: days });
  return new Date(ts).toLocaleDateString();
}

export function fullTime(ts: number): string {
  return new Date(ts).toLocaleString('sv-SE').replace('T', ' ');
}

// --- Attachment size formatting ---

export function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

// --- Code block helpers ---

export function codeFilename(language: string): string {
  const normalized = language.trim().toLowerCase() || 'txt';
  const extensionByLanguage: Record<string, string> = {
    bash: 'sh',
    csharp: 'cs',
    javascript: 'js',
    json: 'json',
    markdown: 'md',
    plaintext: 'txt',
    python: 'py',
    rust: 'rs',
    shell: 'sh',
    sh: 'sh',
    sql: 'sql',
    text: 'txt',
    typescript: 'ts',
    tsx: 'tsx',
    yaml: 'yml',
  };
  return `agent-code-block.${extensionByLanguage[normalized] || normalized.replace(/[^a-z0-9]+/g, '-') || 'txt'}`;
}

export function downloadCodeBlock(content: string, language: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = codeFilename(language);
  anchor.click();
  URL.revokeObjectURL(url);
}

// --- Artifact helpers ---

export function artifactFilename(artifact: MessageArtifact): string {
  const extensionByLanguage: Record<string, string> = {
    javascript: 'js',
    json: 'json',
    markdown: 'md',
    mermaid: 'mmd',
    plaintext: 'txt',
    python: 'py',
    rust: 'rs',
    shell: 'sh',
    sh: 'sh',
    typescript: 'ts',
    yaml: 'yml',
    yml: 'yml',
  };
  const language = artifact.language?.trim().toLowerCase() || 'text';
  const extension = extensionByLanguage[language] || language.replace(/[^a-z0-9]+/g, '-') || 'txt';
  return `agent-artifact-${artifact.messageId.slice(0, 8)}.${extension}`;
}

export function downloadArtifact(artifact: MessageArtifact) {
  const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifactFilename(artifact);
  anchor.click();
  URL.revokeObjectURL(url);
}

// --- Shared mini button component ---

export function MiniButton({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 6,
        cursor: 'pointer',
        background: hovered ? token.colorFillSecondary : 'transparent',
        color: token.colorTextTertiary,
        transition: 'all 0.15s',
      }}
    >
      {icon}
    </div>
  );
}

// --- Shared type for theme token ---

export type ThemeToken = ReturnType<typeof theme.useToken>['token'];
