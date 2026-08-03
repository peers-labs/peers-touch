package follower

import (
	"context"
	"fmt"
	"sync"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type AuthorityEventFetcher interface {
	FetchAuthorityEvents(
		ctx context.Context,
		head Head,
		afterGroupSeq int64,
		limit int32,
	) ([]*chat.CommittedConversationEvent, error)
}

type ResyncManager struct {
	service  *Service
	fetcher  AuthorityEventFetcher
	interval time.Duration
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

func NewResyncManager(service *Service, fetcher AuthorityEventFetcher) *ResyncManager {
	return &ResyncManager{
		service:  service,
		fetcher:  fetcher,
		interval: time.Second,
	}
}

func (m *ResyncManager) Start(ctx context.Context) {
	runCtx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(m.interval)
		defer ticker.Stop()
		for {
			select {
			case <-runCtx.Done():
				return
			case <-ticker.C:
				_ = m.RunOnce(runCtx)
			}
		}
	}()
}

func (m *ResyncManager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
	m.wg.Wait()
}

func (m *ResyncManager) RunOnce(ctx context.Context) error {
	heads, err := m.service.ListResyncRequired(ctx, 32)
	if err != nil {
		return err
	}
	var firstErr error
	for _, head := range heads {
		events, fetchErr := m.fetcher.FetchAuthorityEvents(
			ctx,
			head,
			head.GroupSeq,
			maxBufferedEnvelopes,
		)
		if fetchErr != nil {
			_ = m.service.MarkResyncFailure(ctx, head.ConversationID, fetchErr)
			if firstErr == nil {
				firstErr = fetchErr
			}
			continue
		}
		for _, event := range events {
			env, buildErr := resyncEnvelope(head, event)
			if buildErr != nil {
				_ = m.service.MarkResyncFailure(ctx, head.ConversationID, buildErr)
				if firstErr == nil {
					firstErr = buildErr
				}
				break
			}
			_, _, applyErr := m.service.ApplyFederatedDelivery(
				ctx,
				env,
				head.AuthorityStationPeerID,
			)
			if applyErr != nil {
				_ = m.service.MarkResyncFailure(ctx, head.ConversationID, applyErr)
				if firstErr == nil {
					firstErr = applyErr
				}
				break
			}
		}
	}
	return firstErr
}

func resyncEnvelope(
	head Head,
	event *chat.CommittedConversationEvent,
) (*chat.StationEnvelope, error) {
	if event == nil {
		return nil, fmt.Errorf("conversation follower: nil resync event")
	}
	payload, err := proto.Marshal(event)
	if err != nil {
		return nil, err
	}
	env := &chat.StationEnvelope{
		EnvelopeId:             deterministicID("resync:" + event.EventId),
		IdempotencyKey:         "resync:" + event.EventId,
		ConversationId:         event.ConversationId,
		PayloadType:            chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT,
		PayloadBytes:           payload,
		PayloadSha256:          event.EventHash,
		GroupSeq:               event.GroupSeq,
		ToMembershipEpoch:      event.MembershipEpoch,
		AuthorityStationPeerId: head.AuthorityStationPeerID,
		FederationId:           head.FederationID,
		AuthorityEpoch:         head.AuthorityEpoch,
	}
	if transition := event.GetMembershipTransitionCommitted(); transition != nil {
		env.TransitionId = transition.TransitionId
		env.FromMembershipEpoch = transition.FromMembershipEpoch
		env.ToMembershipEpoch = transition.ToMembershipEpoch
		env.FromMlsEpoch = transition.FromMlsEpoch
		env.ToMlsEpoch = transition.ToMlsEpoch
	}
	return env, nil
}
