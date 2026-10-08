import { Button, Checkbox, Empty, Input, Spin, Typography } from 'antd';
import {
  ArrowLeft,
  Ban,
  Check,
  RotateCcw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

import type {
  ContactsSurfaceFixtureId,
} from '../../acceptance/contactsSurfaceFixture';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';

const { Text } = Typography;

const LIST_SURFACES = new Set<ContactsSurfaceFixtureId>([
  'contacts.list',
  'contacts.list-loading',
  'contacts.list-empty',
  'contacts.list-error',
  'contacts.local-search',
  'contacts.local-search-empty',
  'contacts.requests',
  'contacts.request-pending',
  'contacts.request-unknown',
  'contacts.request-failed',
]);

const PROFILE_SURFACES = new Set<ContactsSurfaceFixtureId>([
  'contacts.profile',
  'contacts.profile-unavailable',
  'contacts.block-confirm',
]);

export function ContactsAcceptanceSurface({
  surfaceId,
}: {
  readonly surfaceId: ContactsSurfaceFixtureId;
}) {
  if (LIST_SURFACES.has(surfaceId)) {
    return <ContactsFixtureList surfaceId={surfaceId} />;
  }
  if (PROFILE_SURFACES.has(surfaceId)) {
    return <ContactsFixtureProfile surfaceId={surfaceId} />;
  }
  return (
    <>
      <ContactsFixtureList background />
      {surfaceId === 'contacts.create-group'
        || surfaceId.startsWith('contacts.group-') ? (
          <ContactsFixtureGroup surfaceId={surfaceId} />
        ) : (
          <ContactsFixturePeople surfaceId={surfaceId} />
        )}
    </>
  );
}

function ContactsFixtureList({
  surfaceId = 'contacts.list',
  background = false,
}: {
  readonly surfaceId?: ContactsSurfaceFixtureId;
  readonly background?: boolean;
}) {
  const { t } = useMobileI18n();
  const query = surfaceId === 'contacts.local-search'
    ? 'Alexandria'
    : surfaceId === 'contacts.local-search-empty'
      ? 'Unknown teammate'
      : '';
  const requestState = surfaceId === 'contacts.request-pending'
    ? 'pending'
    : surfaceId === 'contacts.request-unknown'
      ? 'unknown'
      : surfaceId === 'contacts.request-failed'
        ? 'failed'
        : null;
  const showRequests = surfaceId === 'contacts.requests' || requestState !== null;
  const showContacts = ![
    'contacts.list-loading',
    'contacts.list-empty',
    'contacts.local-search-empty',
  ].includes(surfaceId);

  return (
    <div
      className="page-container contacts-acceptance-fixture"
      data-product-surface={background ? undefined : surfaceId}
    >
      <header className="page-header">
        <h1 className="header-title">{t('mobile.contacts.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.group.create')}
        >
          <Users size={20} />
        </button>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.contacts.findPeople')}
        >
          <UserPlus size={20} />
        </button>
      </header>
      <div className="chat-search-bar">
        <Input
          data-contacts-fixture-search
          prefix={<Search size={16} />}
          placeholder={t('mobile.contacts.searchPlaceholder')}
          value={query}
          readOnly
        />
      </div>
      {surfaceId === 'contacts.list-error' ? (
        <MobileNotice>
          {t('mobile.social.runtimeUnavailable')}
          <Button icon={<RotateCcw size={15} />}>
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      {requestState === 'unknown' ? (
        <MobileNotice>{t('mobile.contacts.requestUnconfirmed')}</MobileNotice>
      ) : null}
      {requestState === 'failed' ? (
        <MobileNotice>
          {t('mobile.contacts.requestFailed')}
          <Button icon={<RotateCcw size={15} />}>
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      <section className="contacts-fixture-content">
        {surfaceId === 'contacts.list-loading' ? (
          <div className="contacts-fixture-state" role="status">
            <Spin />
            <Text>{t('common.state.loading')}</Text>
          </div>
        ) : surfaceId === 'contacts.list-empty' ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <div className="empty-copy">
                <Text strong>{t('mobile.contacts.emptyTitle')}</Text>
                <Text type="secondary">{t('mobile.contacts.emptySubtitle')}</Text>
                <Button icon={<UserPlus size={16} />}>
                  {t('mobile.contacts.findPeople')}
                </Button>
              </div>
            )}
          />
        ) : surfaceId === 'contacts.local-search-empty' ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <div className="empty-copy">
                <Text>{t('mobile.contacts.noSearchResults')}</Text>
                <Button>{t('mobile.contacts.findPeople')}</Button>
              </div>
            )}
          />
        ) : (
          <>
            {showRequests ? (
              <section className="contact-section">
                <div className="section-header">
                  <span>{t('mobile.contacts.friendRequests')}</span>
                </div>
                <FixtureRequest state={requestState} />
              </section>
            ) : null}
            {showContacts ? (
              <section className="contact-section">
                <div className="section-header">
                  <span>{t('mobile.contacts.friends')}</span>
                </div>
                <FixtureContact
                  name="Alexandria Montgomery-Santos"
                  status={t('mobile.social.online')}
                />
                {surfaceId !== 'contacts.local-search' ? (
                  <FixtureContact
                    name="Morgan Lee"
                    status={t('mobile.social.offline')}
                  />
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function FixtureRequest({
  state,
}: {
  readonly state: 'pending' | 'unknown' | 'failed' | null;
}) {
  const { t } = useMobileI18n();
  return (
    <div className="contacts-fixture-request" aria-busy={state === 'pending'}>
      <span className="contacts-fixture-avatar">J</span>
      <span className="contacts-fixture-copy">
        <Text strong>Jordan Kim</Text>
        <Text type="secondary">{t('mobile.contacts.defaultRequestMessage')}</Text>
      </span>
      {state === 'pending' ? (
        <span className="contacts-fixture-request-state">
          <Spin size="small" />
          <Text>{t('mobile.recovery.command.state.pending')}</Text>
        </span>
      ) : state === 'unknown' ? (
        <Text>{t('mobile.recovery.command.state.unknown-outcome')}</Text>
      ) : (
        <span className="contacts-fixture-request-actions">
          <Button
            type="primary"
            icon={<Check size={15} />}
            aria-label={t('mobile.contacts.acceptRequest')}
          />
          <Button
            icon={<X size={15} />}
            aria-label={t('mobile.contacts.rejectRequest')}
          />
        </span>
      )}
    </div>
  );
}

function FixtureContact({
  name,
  status,
}: {
  readonly name: string;
  readonly status: string;
}) {
  return (
    <button
      type="button"
      className="contact-item-row contacts-fixture-contact"
      data-contacts-fixture-contact
    >
      <span className="contacts-fixture-avatar">{name.slice(0, 1)}</span>
      <span className="contact-info">
        <Text strong>{name}</Text>
        <Text type="secondary">{status}</Text>
      </span>
    </button>
  );
}

function ContactsFixtureProfile({
  surfaceId,
}: {
  readonly surfaceId: ContactsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const unavailable = surfaceId === 'contacts.profile-unavailable';
  const profileSurface = surfaceId === 'contacts.block-confirm'
    ? undefined
    : surfaceId;

  return (
    <>
      <div
        className="page-container mobile-detail-page contacts-acceptance-fixture"
        data-product-surface={profileSurface}
      >
        <header className="page-header">
          <button
            className="header-action"
            type="button"
            aria-label={t('common.action.back')}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="header-title compact">
            {unavailable
              ? t('mobile.contacts.profile')
              : 'Alexandria Montgomery-Santos'}
          </h1>
        </header>
        <section className="contacts-fixture-profile">
          {unavailable ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={(
                <div className="empty-copy">
                  <Text>{t('mobile.contacts.unavailable')}</Text>
                  <Button icon={<RotateCcw size={15} />}>
                    {t('common.action.retry')}
                  </Button>
                </div>
              )}
            />
          ) : (
            <>
              <span className="contacts-fixture-profile-avatar">A</span>
              <div className="contact-profile-copy">
                <Text strong className="contact-profile-name">
                  Alexandria Montgomery-Santos
                </Text>
                <Text type="secondary">@alexandria@design.peers</Text>
                <Text className="contact-profile-note">
                  Product design, accessibility, and launch readiness.
                </Text>
                <span className="contacts-fixture-trust">
                  <ShieldCheck size={15} />
                  {t('mobile.contacts.verified')}
                </span>
              </div>
              <div className="contacts-fixture-profile-actions">
                <Button type="primary">{t('mobile.contacts.openChat')}</Button>
                <Button
                  danger
                  icon={<Ban size={15} />}
                  data-contacts-fixture-block
                >
                  {t('mobile.contacts.block')}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
      {surfaceId === 'contacts.block-confirm' ? (
        <div className="contacts-fixture-backdrop">
          <section
            className="contacts-fixture-sheet contacts-fixture-confirm"
            data-product-surface="contacts.block-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contacts-block-title"
          >
            <h2 id="contacts-block-title">{t('mobile.contacts.blockConfirmTitle')}</h2>
            <Text>{t('mobile.contacts.blockConfirmBody')}</Text>
            <div className="contacts-fixture-sheet-actions">
              <Button>{t('common.action.cancel')}</Button>
              <Button danger type="primary">{t('mobile.contacts.block')}</Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ContactsFixturePeople({
  surfaceId,
}: {
  readonly surfaceId: ContactsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const empty = surfaceId === 'contacts.add-friend-empty';
  const loading = surfaceId === 'contacts.search-loading';
  const duplicate = surfaceId === 'contacts.search-duplicate';
  const pending = surfaceId === 'contacts.search-pending';
  const failed = surfaceId === 'contacts.search-failed';
  const unavailable = surfaceId === 'contacts.search-unavailable';
  const denied = surfaceId === 'contacts.search-permission-denied';
  const showResult = !empty && !loading && !failed && !unavailable && !denied;

  return (
    <div className="contacts-fixture-backdrop">
      <section
        className="contacts-fixture-sheet contacts-fixture-people"
        data-product-surface={surfaceId}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contacts-people-title"
      >
        <header className="contacts-fixture-sheet-header">
          <h2 id="contacts-people-title">{t('mobile.contacts.findPeople')}</h2>
          <Button
            type="text"
            icon={<X size={20} />}
            aria-label={t('common.action.close')}
          />
        </header>
        <Input.Search
          data-contacts-fixture-people-search
          aria-label={t('mobile.contacts.findPeoplePlaceholder')}
          placeholder={t('mobile.contacts.findPeoplePlaceholder')}
          value={surfaceId === 'contacts.add-friend'
            ? ''
            : '@alexandria@design.peers'}
          readOnly
          enterButton={t('mobile.contacts.search')}
        />
        <fieldset className="contacts-fixture-federation">
          <legend>{t('mobile.contacts.federation')}</legend>
          <button
            type="button"
            className="contacts-fixture-federation-choice"
            aria-pressed="true"
          >
            Product Federation
          </button>
        </fieldset>
        {loading ? (
          <div className="contacts-fixture-state" role="status">
            <Spin />
            <Text>{t('mobile.contacts.resolving')}</Text>
          </div>
        ) : empty ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <div className="empty-copy">
                <Text>{t('mobile.contacts.noPeopleResults')}</Text>
                <Button>{t('common.action.search')}</Button>
              </div>
            )}
          />
        ) : unavailable || failed || denied ? (
          <MobileNotice>
            {t(unavailable
              ? 'common.stationPicker.status.offline'
              : denied
                ? 'mobile.contacts.roleDenied'
                : 'mobile.contacts.searchFailed')}
            <Button icon={<RotateCcw size={15} />}>
              {t('common.action.retry')}
            </Button>
          </MobileNotice>
        ) : surfaceId === 'contacts.add-friend' ? (
          <Text type="secondary">{t('mobile.contacts.findPeopleHint')}</Text>
        ) : showResult ? (
          <div className="contacts-fixture-person">
            <span className="contacts-fixture-avatar">A</span>
            <span className="contacts-fixture-copy">
              <Text strong>Alexandria Montgomery-Santos</Text>
              <Text type="secondary">@alexandria@design.peers</Text>
            </span>
            <Button
              type="primary"
              loading={pending}
              disabled={duplicate || pending}
            >
              {duplicate
                ? t('mobile.contacts.alreadyFriend')
                : pending
                  ? t('mobile.contacts.requestPending')
                  : t('mobile.contacts.sendRequest')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ContactsFixtureGroup({
  surfaceId,
}: {
  readonly surfaceId: ContactsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const pending = surfaceId === 'contacts.group-pending';
  const failed = surfaceId === 'contacts.group-failed';
  const denied = surfaceId === 'contacts.group-role-denied';

  return (
    <div className="contacts-fixture-backdrop">
      <section
        className="contacts-fixture-sheet contacts-fixture-group"
        data-acceptance-id="create-group"
        data-product-surface={surfaceId}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contacts-group-title"
      >
        <header className="contacts-fixture-sheet-header">
          <h2 id="contacts-group-title">{t('mobile.group.create')}</h2>
          <Button
            type="text"
            icon={<X size={20} />}
            aria-label={t('common.action.close')}
          />
        </header>
        {pending ? (
          <MobileNotice tone="info">
            <Spin size="small" />
            {t('mobile.recovery.command.state.pending')}
          </MobileNotice>
        ) : null}
        {failed || denied ? (
          <MobileNotice>
            {t(denied
              ? 'mobile.group.roleDenied'
              : 'mobile.group.operationCreateFailed')}
            {!denied ? (
              <Button icon={<RotateCcw size={15} />}>
                {t('common.action.retry')}
              </Button>
            ) : null}
          </MobileNotice>
        ) : null}
        <Input
          value="Launch Readiness"
          readOnly
          disabled={pending || denied}
          aria-label={t('mobile.group.namePlaceholder')}
        />
        <Input.TextArea
          value="Coordinate launch checks across design, engineering, and support."
          readOnly
          disabled={pending || denied}
          aria-label={t('mobile.group.descriptionPlaceholder')}
          autoSize={{ minRows: 2, maxRows: 3 }}
        />
        <div className="social-section-title">
          <Text strong>{t('mobile.group.initialMembers')}</Text>
          <Text type="secondary">2</Text>
        </div>
        <label className="contacts-fixture-member">
          <span className="contacts-fixture-avatar">A</span>
          <span className="contacts-fixture-copy">
            <Text strong>Alexandria Montgomery-Santos</Text>
            <Text type="secondary">@alexandria@design.peers</Text>
          </span>
          <Checkbox checked disabled={pending || denied} />
        </label>
        <label className="contacts-fixture-member">
          <span className="contacts-fixture-avatar">M</span>
          <span className="contacts-fixture-copy">
            <Text strong>Morgan Lee</Text>
            <Text type="secondary">@morgan@design.peers</Text>
          </span>
          <Checkbox checked disabled={pending || denied} />
        </label>
        <div className="contacts-fixture-sheet-actions">
          <Button>{t('common.action.cancel')}</Button>
          <Button type="primary" loading={pending} disabled={denied}>
            {t('mobile.group.create')}
          </Button>
        </div>
      </section>
    </div>
  );
}
