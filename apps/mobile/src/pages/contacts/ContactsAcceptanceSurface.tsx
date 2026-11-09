import { Button, Checkbox, Empty, Icon, IconButton, Spin, Text, TextArea, TextField } from '@peers-touch/ui';

import type {
  ContactsSurfaceFixtureId,
} from '../../acceptance/contactsSurfaceFixture';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';

const FIXTURE_CONTACTS = {
  alexandria: {
    avatar: 'A',
    handle: '@alexandria@design.peers',
    name: 'Alexandria Montgomery-Santos',
    note: 'Product design, accessibility, and launch readiness.',
  },
  jordan: {
    avatar: 'J',
    name: 'Jordan Kim',
  },
  morgan: {
    avatar: 'M',
    handle: '@morgan@design.peers',
    name: 'Morgan Lee',
  },
} as const;

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
          <Icon iconId="users" size={20} />
        </button>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.contacts.findPeople')}
        >
          <Icon iconId="user-plus" size={20} />
        </button>
      </header>
      <div className="chat-search-bar">
        <TextField
          className="contact-search-field"
          data-contacts-fixture-search
          leading={<Icon iconId="search" size={16} className="chat-search-leading" />}
          placeholder={t('mobile.contacts.searchPlaceholder')}
          value={query}
          readOnly
        />
      </div>
      {surfaceId === 'contacts.list-error' ? (
        <MobileNotice>
          {t('mobile.social.runtimeUnavailable')}
          <Button
            actionId="contacts.fixture.retry-list"
            leading={<Icon iconId="rotate-ccw" size={15} />}
          >
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
          <Button
            actionId="contacts.fixture.retry-request"
            leading={<Icon iconId="rotate-ccw" size={15} />}
          >
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
            description={(
              <div className="empty-copy">
                <Text strong>{t('mobile.contacts.emptyTitle')}</Text>
                <Text tone="secondary">{t('mobile.contacts.emptySubtitle')}</Text>
                <Button
                  actionId="contacts.fixture.find-people-empty"
                  emphasis="primary"
                  leading={<Icon iconId="user-plus" size={16} />}
                >
                  {t('mobile.contacts.findPeople')}
                </Button>
              </div>
            )}
          />
        ) : surfaceId === 'contacts.local-search-empty' ? (
          <Empty
            description={(
              <div className="empty-copy">
                <Text>{t('mobile.contacts.noSearchResults')}</Text>
                <Button actionId="contacts.fixture.find-people-search-empty">
                  {t('mobile.contacts.findPeople')}
                </Button>
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
                  name={FIXTURE_CONTACTS.alexandria.name}
                  status={t('mobile.social.online')}
                />
                {surfaceId !== 'contacts.local-search' ? (
                  <FixtureContact
                    name={FIXTURE_CONTACTS.morgan.name}
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
      <span className="contacts-fixture-avatar">{FIXTURE_CONTACTS.jordan.avatar}</span>
      <span className="contacts-fixture-copy">
        <Text strong>{FIXTURE_CONTACTS.jordan.name}</Text>
        <Text tone="secondary">{t('mobile.contacts.defaultRequestMessage')}</Text>
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
          <IconButton
            actionId="contacts.fixture.accept-request"
            iconId="check"
            iconSize={15}
            label={t('mobile.contacts.acceptRequest')}
            emphasis="primary"
          />
          <IconButton
            actionId="contacts.fixture.reject-request"
            iconId="close"
            iconSize={15}
            label={t('mobile.contacts.rejectRequest')}
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
        <Text tone="secondary">{status}</Text>
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
            <Icon iconId="arrow-left" size={20} />
          </button>
          <h1 className="header-title compact">
            {unavailable
              ? t('mobile.contacts.profile')
              : FIXTURE_CONTACTS.alexandria.name}
          </h1>
        </header>
        <section className="contacts-fixture-profile">
          {unavailable ? (
            <Empty
              description={(
                <div className="empty-copy">
                  <Text>{t('mobile.contacts.unavailable')}</Text>
                  <Button
                    actionId="contacts.fixture.retry-profile"
                    leading={<Icon iconId="rotate-ccw" size={15} />}
                  >
                    {t('common.action.retry')}
                  </Button>
                </div>
              )}
            />
          ) : (
            <>
              <span className="contacts-fixture-profile-avatar">
                {FIXTURE_CONTACTS.alexandria.avatar}
              </span>
              <div className="contact-profile-copy">
                <Text strong className="contact-profile-name">
                  {FIXTURE_CONTACTS.alexandria.name}
                </Text>
                <Text tone="secondary">{FIXTURE_CONTACTS.alexandria.handle}</Text>
                <Text className="contact-profile-note">
                  {FIXTURE_CONTACTS.alexandria.note}
                </Text>
                <span className="contacts-fixture-trust">
                  <Icon iconId="shield-check" size={15} />
                  {t('mobile.contacts.verified')}
                </span>
              </div>
              <div className="contacts-fixture-profile-actions">
                <Button actionId="contacts.fixture.open-chat" emphasis="primary" fullWidth>
                  {t('mobile.contacts.openChat')}
                </Button>
                <Button
                  actionId="contacts.fixture.block"
                  tone="danger"
                  fullWidth
                  leading={<Icon iconId="ban" size={15} />}
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
              <Button actionId="contacts.fixture.block-cancel" fullWidth>
                {t('common.action.cancel')}
              </Button>
              <Button actionId="contacts.fixture.block-confirm" emphasis="primary" tone="danger" fullWidth>
                {t('mobile.contacts.block')}
              </Button>
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
          <IconButton
            actionId="contacts.fixture.close-people"
            iconId="close"
            iconSize={20}
            label={t('common.action.close')}
            emphasis="quiet"
          />
        </header>
        <TextField
          className="people-search-field"
          data-contacts-fixture-people-search
          aria-label={t('mobile.contacts.findPeoplePlaceholder')}
          placeholder={t('mobile.contacts.findPeoplePlaceholder')}
          value={surfaceId === 'contacts.add-friend'
            ? ''
            : 'Alexandria'}
          readOnly
          leading={<Icon iconId="search" size={16} />}
          trailing={(
            <Button
              actionId="contacts.fixture.people-search"
              emphasis="quiet"
              density="compact"
              tabIndex={-1}
              className="people-search-button"
            >
              {t('mobile.contacts.search')}
            </Button>
          )}
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
            description={(
              <div className="empty-copy">
                <Text>{t('mobile.contacts.noPeopleResults')}</Text>
                <Button actionId="contacts.fixture.people-search-again">
                  {t('common.action.search')}
                </Button>
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
            <Button
              actionId="contacts.fixture.retry-people"
              leading={<Icon iconId="rotate-ccw" size={15} />}
            >
              {t('common.action.retry')}
            </Button>
          </MobileNotice>
        ) : surfaceId === 'contacts.add-friend' ? (
          <Text tone="secondary">{t('mobile.contacts.findPeopleHint')}</Text>
        ) : showResult ? (
          <div className="contacts-fixture-person">
            <span className="contacts-fixture-avatar">
              {FIXTURE_CONTACTS.alexandria.avatar}
            </span>
            <span className="contacts-fixture-copy">
              <Text strong>{FIXTURE_CONTACTS.alexandria.name}</Text>
              <Text tone="secondary">{FIXTURE_CONTACTS.alexandria.handle}</Text>
            </span>
            <Button
              actionId="contacts.fixture.send-request"
              emphasis="primary"
              execution={pending ? 'pending' : 'idle'}
              availability={duplicate || pending
                ? { kind: 'disabled', reason: t(duplicate
                  ? 'mobile.contacts.alreadyFriend'
                  : 'mobile.contacts.requestPending') }
                : undefined}
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
          <IconButton
            actionId="contacts.fixture.close-group"
            iconId="close"
            iconSize={20}
            label={t('common.action.close')}
            emphasis="quiet"
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
              <Button
                actionId="contacts.fixture.retry-group"
                leading={<Icon iconId="rotate-ccw" size={15} />}
              >
                {t('common.action.retry')}
              </Button>
            ) : null}
          </MobileNotice>
        ) : null}
        <TextField
          value="Launch Readiness"
          readOnly
          disabled={pending || denied}
          aria-label={t('mobile.group.namePlaceholder')}
        />
        <TextArea
          value="Coordinate launch checks across design, engineering, and support."
          readOnly
          disabled={pending || denied}
          aria-label={t('mobile.group.descriptionPlaceholder')}
          minimumRows={2}
          maximumRows={3}
        />
        <div className="social-section-title">
          <Text strong>{t('mobile.group.initialMembers')}</Text>
          <Text tone="secondary">2</Text>
        </div>
        <div className="contacts-fixture-member">
          <span className="contacts-fixture-avatar">
            {FIXTURE_CONTACTS.alexandria.avatar}
          </span>
          <span className="contacts-fixture-copy">
            <Text strong>{FIXTURE_CONTACTS.alexandria.name}</Text>
            <Text tone="secondary">{FIXTURE_CONTACTS.alexandria.handle}</Text>
          </span>
          <Checkbox checked disabled={pending || denied} />
        </div>
        <div className="contacts-fixture-member">
          <span className="contacts-fixture-avatar">{FIXTURE_CONTACTS.morgan.avatar}</span>
          <span className="contacts-fixture-copy">
            <Text strong>{FIXTURE_CONTACTS.morgan.name}</Text>
            <Text tone="secondary">{FIXTURE_CONTACTS.morgan.handle}</Text>
          </span>
          <Checkbox checked disabled={pending || denied} />
        </div>
        <div className="contacts-fixture-sheet-actions">
          <Button actionId="contacts.fixture.group-cancel" fullWidth>
            {t('common.action.cancel')}
          </Button>
          <Button
            actionId="contacts.fixture.group-create"
            emphasis="primary"
            fullWidth
            execution={pending ? 'pending' : 'idle'}
            availability={denied
              ? { kind: 'disabled', reason: t('mobile.group.roleDenied') }
              : undefined}
          >
            {t('mobile.group.create')}
          </Button>
        </div>
      </section>
    </div>
  );
}
