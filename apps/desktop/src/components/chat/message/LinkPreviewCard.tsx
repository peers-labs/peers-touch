import { memo } from 'react';
import { ExternalLink } from 'lucide-react';

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
}

/** Bubble-relative link chip: inherits text color so it works on both the
 *  viewer's ink bubble and the peer surface bubble (north-star grammar). */
export const LinkPreviewCard = memo(function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  const domain = domainFromUrl(url);

  return (
    <a
      className="sc-msg-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-link-preview
    >
      <span className="sc-msg-link__icon">
        <ExternalLink size={14} />
      </span>
      <span className="sc-msg-link__body">
        <strong className="sc-msg-link__domain">{domain}</strong>
        <span className="sc-msg-link__url">{url}</span>
      </span>
    </a>
  );
});
