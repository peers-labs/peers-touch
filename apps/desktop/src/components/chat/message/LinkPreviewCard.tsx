import { memo } from 'react';
import { theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ExternalLink } from 'lucide-react';

const { Text } = Typography;

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

export function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) ?? [];
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface LinkPreviewCardProps {
  url: string;
  isOwn: boolean;
}

export const LinkPreviewCard = memo(function LinkPreviewCard({ url, isOwn }: LinkPreviewCardProps) {
  const { token } = theme.useToken();
  const domain = domainFromUrl(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: 'none', maxWidth: '100%', display: 'block' }}
    >
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{
          padding: '8px 10px',
          marginTop: 6,
          borderRadius: 8,
          background: isOwn ? 'rgba(255,255,255,0.12)' : token.colorFillTertiary,
          border: `1px solid ${isOwn ? 'rgba(255,255,255,0.15)' : token.colorBorderSecondary}`,
          maxWidth: '100%',
          cursor: 'pointer',
          transition: 'background 0.12s',
        }}
      >
        <ExternalLink
          size={14}
          style={{ color: isOwn ? 'rgba(255,255,255,0.7)' : token.colorTextTertiary, flexShrink: 0 }}
        />
        <Flexbox style={{ minWidth: 0 }}>
          <Text
            ellipsis
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: isOwn ? 'rgba(255,255,255,0.9)' : token.colorText,
              maxWidth: 240,
            }}
          >
            {domain}
          </Text>
          <Text
            ellipsis
            style={{
              fontSize: 11,
              color: isOwn ? 'rgba(255,255,255,0.6)' : token.colorTextTertiary,
              maxWidth: 240,
            }}
          >
            {url}
          </Text>
        </Flexbox>
      </Flexbox>
    </a>
  );
});
