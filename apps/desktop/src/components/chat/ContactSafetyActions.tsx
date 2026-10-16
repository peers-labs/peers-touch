import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { Alert, Modal, Typography } from 'antd';
import { ShieldBan, UserRoundCheck } from 'lucide-react';
import { Flexbox } from 'react-layout-kit';

import { useIsPageActive } from '../../kernel/PageActivityContext';
import type { SocialRelationshipMutationInput } from '../../services/social_api';
import {
  useActiveChatRelationshipsSlice,
  useActiveChatSessionSlice,
} from './useActiveSocialChatStore';

interface BlockIntent {
  input: SocialRelationshipMutationInput;
  blocked: boolean;
  sessionEpoch: number;
}

export function ContactSafetyActions({ peerPtid, homeStationPeerId, displayName }: {
  peerPtid: string;
  homeStationPeerId: string;
  displayName: string;
}) {
  const { t } = useTranslation('chat');
  const active = useIsPageActive();
  const sessionEpoch = useActiveChatSessionSlice((state) => state.sessionEpoch);
  const { policy, loading, loadError, mutating, load, setBlocked } = useActiveChatRelationshipsSlice((state) => ({
    policy: state.relationshipPolicies[peerPtid],
    loading: state.relationshipPolicyLoading[peerPtid],
    loadError: state.relationshipPolicyErrors[peerPtid],
    mutating: state.blockedActorMutatingPtid !== null,
    load: state.loadRelationshipPolicy,
    setBlocked: state.setActorBlocked,
  }));
  const [intent, setIntent] = useState<BlockIntent | null>(null);
  const [actionError, setActionError] = useState(false);

  // The runtime reconciles every observed policy. This starts the lazy observation.
  useEffect(() => {
    if (active) void load(peerPtid).catch(() => undefined);
    else setIntent(null);
  }, [active, load, peerPtid]);

  const blocked = policy?.blockedByViewer === true;
  const revision = policy ? Number(policy.revision) : NaN;
  // Initial revision-zero status has no directional block edge yet. The
  // contact identity supplies its Station; conflicting identities fail closed.
  const targetHomeStationPeerId = policy?.targetHomeStationPeerId || homeStationPeerId;
  const available = Boolean(
    policy && targetHomeStationPeerId
    && (!policy.targetHomeStationPeerId || !homeStationPeerId || policy.targetHomeStationPeerId === homeStationPeerId)
    && Number.isSafeInteger(revision) && revision >= 0
    && !loadError,
  );

  return (
    <Flexbox gap={8} data-chat-contact-safety={peerPtid} data-chat-contact-blocked={policy ? String(blocked) : 'unknown'}>
      {blocked ? (
        <Typography.Text type="secondary" role="status">
          {t('chat.social.safety.blocked')}
        </Typography.Text>
      ) : policy?.interactionAllowed === false ? (
        <Typography.Text type="secondary" role="status">
          {t('chat.social.safety.interactionUnavailable')}
        </Typography.Text>
      ) : null}
      {loadError || actionError ? (
        <Alert
          type="warning"
          showIcon
          message={t('chat.social.safety.actionFailed')}
          action={<Button size="small" onClick={() => {
            setActionError(false);
            void load(peerPtid, true).catch(() => undefined);
          }}>{t('chat.social.safety.refresh')}</Button>}
        />
      ) : null}
      <Button
        block
        danger={!blocked}
        icon={blocked ? <UserRoundCheck size={16} /> : <ShieldBan size={16} />}
        disabled={!available || mutating}
        loading={loading || mutating}
        data-chat-contact-block-action={blocked ? 'unblock' : 'block'}
        onClick={() => {
          if (!policy || !available) return;
          setActionError(false);
          setIntent({
            input: {
              targetActorPtid: peerPtid,
              targetHomeStationPeerId,
              observedRevision: revision,
            },
            blocked: !blocked,
            sessionEpoch,
          });
        }}
      >
        {t(blocked ? 'chat.social.safety.unblock' : 'chat.social.safety.block')}
      </Button>
      {!available && !loadError && !loading ? (
        <Typography.Text type="secondary" role="status">
          {t('chat.social.safety.unavailable')}
        </Typography.Text>
      ) : null}
      {intent && active && intent.sessionEpoch === sessionEpoch ? (
        <Modal
          open
          title={t(intent.blocked ? 'chat.social.safety.blockTitle' : 'chat.social.safety.unblockTitle', { name: displayName })}
          okText={t(intent.blocked ? 'chat.social.safety.block' : 'chat.social.safety.unblock')}
          cancelText={t('chat.social.safety.cancel')}
          okButtonProps={{ danger: intent.blocked, disabled: mutating }}
          confirmLoading={mutating}
          onCancel={() => setIntent(null)}
          onOk={async () => {
            try {
              await setBlocked(intent.input, intent.blocked, intent.sessionEpoch);
              setIntent(null);
            } catch {
              setIntent(null);
              setActionError(true);
            }
          }}
        >
          {t(intent.blocked ? 'chat.social.safety.blockBody' : 'chat.social.safety.unblockBody')}
        </Modal>
      ) : null}
    </Flexbox>
  );
}
