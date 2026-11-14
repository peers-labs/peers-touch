import type { ReactNode } from 'react';
import { Button, Icon, IconButton, Spin, Text, TextArea, TextField } from '@peers-touch/ui';

import type {
  MomentsSurfaceFixtureId,
} from '../../acceptance/momentsSurfaceFixture';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';

const COMPOSER_SURFACES = new Set<MomentsSurfaceFixtureId>([
  'moments.composer',
  'moments.composer-audience',
  'moments.composer-media-uploading',
  'moments.composer-media-ready',
  'moments.composer-media-error',
  'moments.composer-pending',
  'moments.composer-rollback',
  'moments.composer-draft-restored',
  'moments.composer-draft-failed',
]);

const DETAIL_SURFACES = new Set<MomentsSurfaceFixtureId>([
  'moments.reaction-pending',
  'moments.reaction-rollback',
  'moments.detail-comments',
  'moments.detail-loading',
  'moments.detail-unavailable',
  'moments.detail-hidden',
  'moments.detail-deleted',
  'moments.comments-loading',
  'moments.comments-empty',
  'moments.comments-error',
  'moments.comments-loading-more',
  'moments.comments-pending',
  'moments.comments-failed',
]);

export function MomentsAcceptanceSurface({
  surfaceId,
}: {
  readonly surfaceId: MomentsSurfaceFixtureId;
}) {
  if (COMPOSER_SURFACES.has(surfaceId)) {
    return (
      <>
        <MomentsFixtureFeed background />
        <MomentsFixtureComposer surfaceId={surfaceId} />
      </>
    );
  }
  if (DETAIL_SURFACES.has(surfaceId)) {
    return <MomentsFixtureDetail surfaceId={surfaceId} />;
  }
  return <MomentsFixtureFeed surfaceId={surfaceId} />;
}

function MomentsFixtureFeed({
  surfaceId = 'moments.feed',
  background = false,
}: {
  readonly surfaceId?: MomentsSurfaceFixtureId;
  readonly background?: boolean;
}) {
  const { t } = useMobileI18n();
  const loading = surfaceId === 'moments.feed-loading';
  const failed = surfaceId === 'moments.feed-error';
  const empty = surfaceId === 'moments.feed-empty';
  const filtered = surfaceId === 'moments.filtered-empty';
  const unavailable = surfaceId === 'moments.unavailable';
  const loadingMore = surfaceId === 'moments.feed-loading-more';
  const retainedError = surfaceId === 'moments.feed-retained-error';
  const policyHidden = surfaceId === 'moments.policy-hidden';
  const showFeed = !loading && !failed && !empty && !filtered && !unavailable;

  return (
    <div
      className="page-container moments-page moments-acceptance-fixture"
      data-product-surface={background ? undefined : surfaceId}
      aria-hidden={background || undefined}
    >
      <header className="page-header">
        <h1 className="header-title">{t('mobile.moments.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.moments.feed.refresh')}
        >
          <Icon iconId="refresh-cw" size={20} />
        </button>
        <button
          type="button"
          className="header-action"
          data-moments-fixture-new-post
          aria-label={t('mobile.moments.newPost')}
        >
          <Icon iconId="image-plus" size={20} />
        </button>
      </header>
      <section className="moments-fixture-feed">
        {loading ? (
          <FixtureState
            icon={<Spin />}
            title={t('mobile.moments.feed.loading')}
          />
        ) : failed ? (
          <FixtureState
            icon={<Icon iconId="warning" size={34} />}
            title={t('mobile.moments.feed.error')}
            action={t('mobile.moments.feed.retry')}
          />
        ) : empty ? (
          <FixtureState
            icon={<Icon iconId="inbox" size={38} />}
            title={t('mobile.moments.feed.empty')}
            description={t('mobile.moments.feed.emptyHint')}
            action={t('mobile.moments.newPost')}
          />
        ) : filtered ? (
          <FixtureState
            icon={<Icon iconId="shield-alert" size={38} />}
            title={t('mobile.moments.policy.violation')}
            description={t('mobile.moments.policy.violationHint')}
          />
        ) : unavailable ? (
          <FixtureState
            icon={<Icon iconId="warning" size={38} />}
            title={t('mobile.moments.unavailable.title')}
            description={t('mobile.moments.unavailable.description')}
            action={t('mobile.moments.unavailable.retry')}
          />
        ) : null}

        {showFeed ? (
          <>
            {retainedError ? (
              <MobileNotice>
                {t('mobile.moments.feed.error')}
                <Button
                  actionId="moments.fixture.retry-feed"
                  leading={<Icon iconId="rotate-ccw" size={15} />}
                >
                  {t('mobile.moments.feed.retry')}
                </Button>
              </MobileNotice>
            ) : null}
            <FixtureMomentCard
              comments={2}
              policyHidden={policyHidden}
            />
            {!policyHidden ? (
              <FixtureMomentCard
                author="Morgan Lee"
                body="The accessibility review is complete. I left notes beside each launch check."
                comments={1}
              />
            ) : null}
            {loadingMore ? (
              <div
                className="moments-fixture-pagination"
                data-moments-fixture-load-more
                role="status"
              >
                <Spin size="small" />
                <Text>{t('mobile.moments.feed.loadingMore')}</Text>
              </div>
            ) : (
              <Button
                actionId="moments.fixture.load-more"
                emphasis="quiet"
                fullWidth
                className="moments-fixture-load-more"
                data-moments-fixture-load-more
              >
                {t('mobile.moments.feed.loadMore')}
              </Button>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

function FixtureState({
  icon,
  title,
  description,
  action,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: string;
}) {
  return (
    <div className="moments-fixture-state" role="status">
      {icon}
      <Text strong>{title}</Text>
      {description ? <Text tone="secondary">{description}</Text> : null}
      {action ? <Button actionId="moments.fixture.state-action">{action}</Button> : null}
    </div>
  );
}

function FixtureMomentCard({
  author = 'Alexandria Montgomery-Santos',
  body = 'The launch checklist is ready. Design, engineering, and support can review one shared source.',
  comments,
  policyHidden = false,
  reactionState,
}: {
  readonly author?: string;
  readonly body?: string;
  readonly comments: number;
  readonly policyHidden?: boolean;
  readonly reactionState?: 'pending' | 'rollback';
}) {
  const { t } = useMobileI18n();
  if (policyHidden) {
    return (
      <article className="moments-fixture-card moments-fixture-card--policy">
        <Icon iconId="shield-alert" size={28} />
        <Text strong>{t('mobile.moments.policy.violation')}</Text>
        <Text tone="secondary">{t('mobile.moments.policy.violationHint')}</Text>
      </article>
    );
  }

  return (
    <article className="moments-fixture-card">
      <header className="moments-fixture-author">
        <span className="moments-fixture-avatar">{author.slice(0, 1)}</span>
        <span className="moments-fixture-author-copy">
          <Text strong>{author}</Text>
          <Text tone="secondary">{t('mobile.moments.time.minutesAgo', { count: 12 })}</Text>
        </span>
      </header>
      <p className="moments-fixture-body">{body}</p>
      <div className="moments-fixture-media" aria-label={t('mobile.moments.imageReady')}>
        <Icon iconId="image-plus" size={28} />
        <span>{t('mobile.moments.imageReady')}</span>
      </div>
      <div className="moments-fixture-reactions">
        <span>👍 8</span>
        <span>❤️ 3</span>
      </div>
      <div className="moments-fixture-actions">
        <button type="button" data-moments-fixture-react aria-label={t('mobile.moments.reaction.like')}>
          <Icon iconId="heart" size={18} /> 11
        </button>
        <button type="button" data-moments-fixture-comments aria-label={t('mobile.moments.comment.title')}>
          <Icon iconId="message-circle" size={18} /> {comments}
        </button>
      </div>
      {reactionState ? (
        <MobileNotice tone={reactionState === 'pending' ? 'info' : 'error'}>
          {t(reactionState === 'pending'
            ? 'mobile.moments.reaction.pending'
            : 'mobile.moments.reaction.rolledBack')}
          {reactionState === 'rollback' ? (
            <Button
              actionId="moments.fixture.retry-reaction"
              leading={<Icon iconId="rotate-ccw" size={15} />}
            >
              {t('common.action.retry')}
            </Button>
          ) : null}
        </MobileNotice>
      ) : null}
    </article>
  );
}

function MomentsFixtureComposer({
  surfaceId,
}: {
  readonly surfaceId: MomentsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const audience = surfaceId === 'moments.composer-audience';
  const uploading = surfaceId === 'moments.composer-media-uploading';
  const mediaReady = surfaceId === 'moments.composer-media-ready';
  const mediaError = surfaceId === 'moments.composer-media-error';
  const pending = surfaceId === 'moments.composer-pending';
  const rollback = surfaceId === 'moments.composer-rollback';
  const restored = surfaceId === 'moments.composer-draft-restored';
  const draftFailed = surfaceId === 'moments.composer-draft-failed';
  const hasMedia = uploading || mediaReady || mediaError || restored;
  const hasChosenAudience = surfaceId !== 'moments.composer';

  return (
    <div className="moments-fixture-backdrop">
      <section
        className="moments-fixture-composer"
        data-product-surface={surfaceId}
        role="dialog"
        aria-modal="true"
        aria-labelledby="moments-composer-title"
      >
        <header className="moments-fixture-sheet-header">
          <h2 id="moments-composer-title">{t('mobile.moments.newPost')}</h2>
          <IconButton
            actionId="moments.fixture.close-composer"
            iconId="close"
            iconSize={20}
            label={t('common.action.close')}
            emphasis="quiet"
          />
        </header>
        {restored ? (
          <MobileNotice tone="info">
            <Icon iconId="save" size={16} />
            {t('mobile.moments.composer.draftRestored')}
          </MobileNotice>
        ) : null}
        {draftFailed ? (
          <MobileNotice>
            {t('common.state.error')}: {t('mobile.moments.imageReadbackFailed')}
            <Button
              actionId="moments.fixture.retry-draft"
              leading={<Icon iconId="rotate-ccw" size={15} />}
            >
              {t('common.action.retry')}
            </Button>
          </MobileNotice>
        ) : null}
        {pending ? (
          <MobileNotice tone="info">
            <Spin size="small" />
            {t('mobile.recovery.command.state.pending')}
          </MobileNotice>
        ) : null}
        <div className="moments-fixture-audience">
          <Text strong>{t('mobile.moments.audience.label')}</Text>
          <button
            type="button"
            data-moments-fixture-audience
            aria-expanded={audience}
          >
            {t(hasChosenAudience
              ? 'mobile.moments.audience.followers'
              : 'mobile.moments.audience.select')}
          </button>
          {audience ? (
            <div className="moments-fixture-audience-options">
              <button type="button"><Icon iconId="check" size={14} />{t('mobile.moments.audience.followers')}</button>
              <button type="button">{t('mobile.moments.audience.self')}</button>
            </div>
          ) : null}
        </div>
        <TextArea
          data-moments-fixture-composer
          value="The launch checklist is ready for a final review."
          readOnly
          disabled={pending}
          aria-label={t('mobile.moments.placeholder')}
          minimumRows={4}
          maximumRows={5}
        />
        {hasMedia ? (
          <div className={`moments-fixture-media-tile ${uploading ? 'uploading' : mediaError ? 'error' : 'ready'}`}>
            <Icon iconId="image-plus" size={30} />
            <Text strong>
              {t(uploading
                ? 'mobile.moments.imageUploadingShort'
                : mediaError
                  ? 'mobile.moments.imageFailed'
                  : 'mobile.moments.imageReady')}
            </Text>
            {mediaError ? (
              <Button
                actionId="moments.fixture.retry-image"
                leading={<Icon iconId="rotate-ccw" size={15} />}
              >
                {t('mobile.moments.retryImage')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {rollback ? (
          <section className="moments-fixture-rollback" role="alertdialog">
            <Text strong>{t('mobile.moments.composer.rollbackConfirm')}</Text>
            <Text tone="secondary">{t('mobile.moments.imageReadbackFailed')}</Text>
            <div className="moments-fixture-sheet-actions">
              <Button actionId="moments.fixture.rollback-no" fullWidth>
                {t('mobile.moments.composer.rollbackNo')}
              </Button>
              <Button actionId="moments.fixture.rollback-yes" tone="danger" fullWidth data-moments-fixture-discard>
                {t('mobile.moments.composer.rollbackYes')}
              </Button>
            </div>
          </section>
        ) : (
          <div className="moments-fixture-sheet-actions">
            <Button
              actionId="moments.fixture.attach-image"
              leading={<Icon iconId="image-plus" size={16} />}
              data-moments-fixture-attach
              availability={pending
                ? { kind: 'disabled', reason: t('mobile.recovery.command.state.pending') }
                : undefined}
            >
              {t('mobile.moments.attachImage', { count: hasMedia ? 1 : 0, max: 9 })}
            </Button>
            <Button
              actionId="moments.fixture.publish"
              emphasis="primary"
              leading={<Icon iconId="send" size={16} />}
              execution={pending ? 'pending' : 'idle'}
            >
              {t('mobile.moments.publish')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function MomentsFixtureDetail({
  surfaceId,
}: {
  readonly surfaceId: MomentsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const detailLoading = surfaceId === 'moments.detail-loading';
  const detailUnavailable = surfaceId === 'moments.detail-unavailable';
  const detailHidden = surfaceId === 'moments.detail-hidden';
  const detailDeleted = surfaceId === 'moments.detail-deleted';
  const commentsLoading = surfaceId === 'moments.comments-loading';
  const commentsEmpty = surfaceId === 'moments.comments-empty';
  const commentsError = surfaceId === 'moments.comments-error';
  const commentsLoadingMore = surfaceId === 'moments.comments-loading-more';
  const commentsPending = surfaceId === 'moments.comments-pending';
  const commentsFailed = surfaceId === 'moments.comments-failed';
  const reactionState = surfaceId === 'moments.reaction-pending'
    ? 'pending'
    : surfaceId === 'moments.reaction-rollback'
      ? 'rollback'
      : undefined;
  const detailReady = !detailLoading
    && !detailUnavailable
    && !detailHidden
    && !detailDeleted;

  return (
    <div
      className="page-container moments-page mobile-detail-page moments-acceptance-fixture"
      data-product-surface={surfaceId}
    >
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.moments.detail.back')}
        >
          <Icon iconId="arrow-left" size={20} />
        </button>
        <h1 className="header-title compact">{t('mobile.moments.detail.title')}</h1>
      </header>
      <section
        className="moments-fixture-thread"
        data-moments-fixture-comments={
          surfaceId === 'moments.detail-comments' || undefined
        }
      >
        {detailLoading ? (
          <FixtureState icon={<Spin />} title={t('mobile.moments.feed.loading')} />
        ) : detailUnavailable ? (
          <FixtureState
            icon={<Icon iconId="warning" size={34} />}
            title={t('mobile.moments.unavailable.title')}
            description={t('mobile.moments.unavailable.description')}
            action={t('common.action.retry')}
          />
        ) : detailHidden ? (
          <FixtureState
            icon={<Icon iconId="shield-alert" size={34} />}
            title={t('mobile.moments.policy.violation')}
            description={t('mobile.moments.policy.violationHint')}
          />
        ) : detailDeleted ? (
          <FixtureState
            icon={<Icon iconId="delete" size={34} />}
            title={t('mobile.moments.detail.deleted')}
          />
        ) : null}
        {detailReady ? (
          <>
            <FixtureMomentCard
              comments={2}
              reactionState={reactionState}
            />
            <section className="moments-fixture-comments">
              <h2>{t('mobile.moments.comment.title')}</h2>
              {commentsLoading ? (
                <div className="moments-fixture-comment-state" role="status">
                  <Spin size="small" />
                  <Text>{t('mobile.moments.comment.loading')}</Text>
                </div>
              ) : commentsEmpty ? (
                <div className="moments-fixture-comment-state">
                  <Icon iconId="message-circle" size={28} />
                  <Text strong>{t('mobile.moments.comment.empty')}</Text>
                  <Text tone="secondary">{t('mobile.moments.comment.emptyHint')}</Text>
                </div>
              ) : commentsError ? (
                <MobileNotice>
                  {t('mobile.moments.comment.error')}
                  <Button
                    actionId="moments.fixture.retry-comments"
                    leading={<Icon iconId="rotate-ccw" size={15} />}
                  >
                    {t('common.action.retry')}
                  </Button>
                </MobileNotice>
              ) : (
                <>
                  <FixtureComment
                    author="Jordan Kim"
                    body="I reviewed the interaction states and they are ready."
                  />
                  <FixtureComment
                    author="Morgan Lee"
                    body="The recovery copy now stays with the composer."
                  />
                  {commentsLoadingMore ? (
                    <div
                      className="moments-fixture-comment-state"
                      data-moments-fixture-load-more-comments
                      role="status"
                    >
                      <Spin size="small" />
                      <Text>{t('mobile.moments.feed.loadingMore')}</Text>
                    </div>
                  ) : (
                    <Button
                      actionId="moments.fixture.load-more-comments"
                      emphasis="quiet"
                      fullWidth
                      data-moments-fixture-load-more-comments
                    >
                      {t('mobile.moments.comment.loadMore')}
                    </Button>
                  )}
                </>
              )}
            </section>
          </>
        ) : null}
      </section>
      {detailReady ? (
        <div className="moments-fixture-comment-composer">
          {commentsFailed ? (
            <MobileNotice>
              {t('mobile.moments.comment.sendError')}
              <Button
                actionId="moments.fixture.retry-comment-send"
                leading={<Icon iconId="rotate-ccw" size={15} />}
              >
                {t('common.action.retry')}
              </Button>
            </MobileNotice>
          ) : null}
          <div className="moments-fixture-comment-field" aria-busy={commentsPending}>
            <TextField
              data-moments-fixture-comment
              value={commentsPending || commentsFailed
                ? 'Still here.'
                : ''}
              readOnly
              disabled={commentsPending}
              aria-label={t('mobile.moments.comment.title')}
              placeholder={t('mobile.moments.comment.placeholder')}
            />
            <IconButton
              actionId="moments.fixture.send-comment"
              iconId="send"
              iconSize={15}
              label={t('mobile.moments.comment.send')}
              emphasis="primary"
              execution={commentsPending ? 'pending' : 'idle'}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FixtureComment({
  author,
  body,
}: {
  readonly author: string;
  readonly body: string;
}) {
  return (
    <article className="moments-fixture-comment">
      <span className="moments-fixture-comment-avatar">{author.slice(0, 1)}</span>
      <span className="moments-fixture-comment-copy">
        <Text strong>{author}</Text>
        <Text>{body}</Text>
      </span>
    </article>
  );
}
