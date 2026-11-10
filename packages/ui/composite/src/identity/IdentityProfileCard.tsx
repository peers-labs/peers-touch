import type { CSSProperties } from 'react';
import type {
  IdentityProfileCardProps, IdentityRegionKey, IdentityProfileModel,
} from './identity.types';
import './identity.css';

/** Only http(s) links are rendered; everything else is dropped silently. */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function pillTone(tone: string | undefined): string {
  if (tone === 'success' || tone === 'warning' || tone === 'processing') return tone;
  return 'default';
}

function handleText(handle: IdentityProfileModel['handle']): string | null {
  if (!handle?.localPart) return null;
  const local = handle.localPart.trim();
  if (!local) return null;
  const home = handle.home?.trim();
  return home ? `@${local}@${home}` : `@${local}`;
}

/** Merge optional host-injected class names onto a composite region. */
function regionClass(base: string, hooks: IdentityProfileCardProps['hooks'], key: IdentityRegionKey): string {
  const host = hooks?.classNames?.[key];
  return host ? `${base} ${host}` : base;
}

function regionData(
  hooks: IdentityProfileCardProps['hooks'],
  key: IdentityRegionKey,
): Record<string, string | boolean | undefined> | undefined {
  return hooks?.dataAttributes?.[key];
}

export function IdentityProfileCard({ variant, profile, actionsSlot, intents, t, hooks }: IdentityProfileCardProps) {
  const handle = handleText(profile.handle);
  const links = (profile.links ?? []).filter(link => link.url && safeUrl(link.url));
  const identityLines = (profile.stationLines ?? []).filter(Boolean);
  const moments = (profile.moments ?? []).slice(0, 3);

  const rootData = {
    'data-chat-profile-card': true,
    'data-chat-avatar-ptid': profile.avatarPtid ?? '',
    'data-chat-avatar-src': profile.avatarSrc ?? '',
    ...(regionData(hooks, 'card') ?? {}),
  } as Record<string, string | boolean | undefined>;

  const avatar = (
    <div className={regionClass('ptc-profile-avatar', hooks, 'avatar')} {...regionData(hooks, 'avatar')}>
      {profile.avatarSlot}
    </div>
  );

  const handleNode = handle ? (
    <span className={regionClass('ptc-profile-handle', hooks, 'handle')} title={handle} {...regionData(hooks, 'handle')}>
      {handle}
    </span>
  ) : null;

  const bio = profile.bio ? (
    <p className={regionClass('ptc-profile-bio', hooks, 'bio')} title={profile.bio} {...regionData(hooks, 'bio')}>
      {profile.bio}
    </p>
  ) : null;

  const relationPill = profile.relation ? (
    <div className={regionClass('ptc-profile-pills', hooks, 'relation')}>
      <span
        className="ptc-profile-pill"
        data-chat-profile-relation={profile.relation.label}
        data-tone={pillTone(profile.relation.tone)}
      >
        {profile.relation.label}
      </span>
    </div>
  ) : null;

  const badgePills = profile.badges && profile.badges.length > 0 ? (
    <div className="ptc-profile-pills">
      {profile.badges.map(badge => (
        <span key={badge.label} className="ptc-profile-pill" data-tone={pillTone(badge.tone)}>
          {badge.label}
        </span>
      ))}
    </div>
  ) : null;

  const statBlock = profile.stats && profile.stats.length > 0 ? (
    <div className={`ptc-profile-stats ptc-profile-stats--${variant}`} {...regionData(hooks, 'stats')}>
      {profile.stats.map(stat => (
        <span key={stat.label} className="ptc-profile-stat">
          <strong>{stat.value}</strong>
          {stat.label}
        </span>
      ))}
    </div>
  ) : null;

  const metaLine = (profile.joined || profile.region) ? (
    <div className="ptc-profile-meta-line">
      {profile.joined ? <span>{profile.joined}</span> : null}
      {profile.region ? <span>{profile.region}</span> : null}
    </div>
  ) : null;

  const tagPills = profile.tags && profile.tags.length > 0 ? (
    <div className="ptc-profile-pills">
      {profile.tags.map(tag => <span key={tag} className="ptc-profile-pill">{tag}</span>)}
    </div>
  ) : null;

  const linkBlock = links.length > 0 ? (
    <div className={regionClass('ptc-profile-links', hooks, 'links')} {...regionData(hooks, 'links')}>
      {links.map((link, index) => {
        const href = safeUrl(link.url);
        if (!href) return null;
        return (
          <a key={`${href}-${index}`} className="ptc-profile-link" href={href} target="_blank" rel="noreferrer">
            <span>{link.label?.trim() || href}</span>
          </a>
        );
      })}
    </div>
  ) : null;

  const actionBlock = actionsSlot ? (
    <div className={regionClass('ptc-profile-actions', hooks, 'actions')} {...regionData(hooks, 'actions')}>
      {actionsSlot}
    </div>
  ) : null;

  const momentStrip = moments.length > 0 ? (
    <section className={regionClass('ptc-profile-moments', hooks, 'moments')} data-author-moments={moments.length}
      {...regionData(hooks, 'moments')}>
      <span className="ptc-profile-moments-title">{t('identity.moments.recent')}</span>
      <div className="ptc-profile-moment-strip">
        {moments.map(moment => (
          <button
            key={moment.id}
            type="button"
            className={regionClass('ptc-profile-moment-tile', hooks, 'momentTile')}
            data-author-moment={moment.id}
            aria-label={t('identity.moments.tileAria', { name: profile.displayName, text: moment.text.slice(0, 20) })}
            onClick={() => intents.onOpenMoment?.(moment.id)}
          >
            {moment.image
              ? <span className="ptc-profile-moment-thumb" style={{ backgroundImage: `url("${moment.image}")` } as CSSProperties} />
              : <span className="ptc-profile-moment-text">{moment.text}</span>}
          </button>
        ))}
      </div>
    </section>
  ) : null;

  const technicalDetails = profile.technicalDetails && profile.technicalDetails.length > 0 ? (
    <details
      className={regionClass('ptc-profile-details', hooks, 'technicalDetails')}
      data-chat-profile-technical-details
      {...regionData(hooks, 'technicalDetails')}
    >
      <summary>{profile.technicalDetailsLabel}</summary>
      <div className="ptc-profile-details__rows">
        {profile.technicalDetails.map(detail => (
          <div
            key={detail.id}
            className={regionClass('ptc-profile-details__row', hooks, 'technicalDetail')}
            data-chat-profile-technical-detail={detail.id}
            {...regionData(hooks, 'technicalDetail')}
          >
            <span className="ptc-profile-details__label">{detail.label}</span>
            <span className="ptc-profile-details__value" title={detail.value}>{detail.value}</span>
            <button
              type="button"
              className={regionClass('ptc-profile-copy', hooks, 'copyButton')}
              aria-label={detail.copyLabel}
              data-chat-profile-copy={detail.id}
              onClick={() => intents.onCopyTechnical?.(detail.id)}
            >
              <span className="ptc-profile-visuallyhidden">{detail.copyLabel}</span>
            </button>
          </div>
        ))}
      </div>
    </details>
  ) : null;

  if (variant === 'self') {
    const bannerStyle: CSSProperties | undefined = profile.headerImage
      ? { backgroundImage: `url("${profile.headerImage}")` }
      : undefined;
    return (
      <div className={regionClass('ptc-profile-card ptc-profile-card--self', hooks, 'card')} {...rootData}>
        <div
          className={regionClass('ptc-profile-self-banner', hooks, 'banner')}
          data-chat-profile-banner={profile.headerImage ? 'image' : 'gradient'}
          style={bannerStyle}
          {...regionData(hooks, 'banner')}
        />
        <div className="ptc-profile-self-body">
          <div className="ptc-profile-self-avatar">{avatar}</div>
          <div className="ptc-profile-self-name" title={profile.displayName}>{profile.displayName}</div>
          {handleNode}
          {identityLines.length > 0 && (
            <div className="ptc-profile-self-identity">
              {identityLines.map(value => <span key={value} className="ptc-profile-station" title={value}>{value}</span>)}
            </div>
          )}
          {statBlock}
          {metaLine ? <div className="ptc-profile-self-joined">{metaLine}</div> : null}
          {bio}
          {relationPill}
          {badgePills}
          {tagPills}
          {linkBlock}
          {actionBlock}
          {technicalDetails}
        </div>
      </div>
    );
  }

  if (variant === 'sheet') {
    return (
      <div className={regionClass('ptc-profile-card ptc-profile-card--sheet', hooks, 'card')} {...rootData}>
        <section className="ptc-profile-sheet-hero" data-profile-identity>
          <div className="ptc-profile-sheet-avatar">{avatar}</div>
          <strong className="ptc-profile-sheet-name">{profile.displayName}</strong>
          <div className="ptc-profile-sheet-sub">
            {identityLines.map(value => <span key={value}>{value}</span>)}
            {handleNode}
          </div>
        </section>
        <div className="ptc-profile-sheet-body">
          {bio}
          {relationPill}
          {badgePills}
          {statBlock}
          {metaLine}
          {tagPills}
          {linkBlock}
          {actionBlock}
          {technicalDetails}
        </div>
      </div>
    );
  }

  return (
    <div className={regionClass('ptc-profile-card ptc-profile-card--author', hooks, 'card')} {...rootData}>
      <header className="ptc-profile-author-head">
        {avatar}
        <div className="ptc-profile-author-idcol">
          <strong className="ptc-profile-author-name" title={profile.displayName}>{profile.displayName}</strong>
          {handleNode}
          {identityLines.map(value => (
            <span key={value} className="ptc-profile-station" title={value}>{value}</span>
          ))}
        </div>
      </header>
      {bio}
      {relationPill}
      {badgePills}
      {statBlock}
      {metaLine}
      {tagPills}
      {linkBlock}
      {momentStrip}
      {actionBlock}
      {technicalDetails}
    </div>
  );
}
