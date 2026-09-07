package conversation

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

const (
	productionFollowerResyncInterval = 5 * time.Second
	productionFollowerResyncBatch    = 32
	productionFollowerResyncPages    = 32
)

func (s *subServer) runFollowerResync(ctx context.Context) {
	ticker := time.NewTicker(productionFollowerResyncInterval)
	defer ticker.Stop()

	for {
		if err := s.resyncFollowersOnce(ctx); err != nil && ctx.Err() == nil {
			logger.Errorf(ctx, "Conversation follower resync failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *subServer) resyncFollowersOnce(ctx context.Context) error {
	candidates, err := s.followerResyncCandidates(ctx)
	if err != nil {
		return err
	}
	var failures []error
	for _, candidate := range candidates {
		if err := s.resyncFollower(ctx, candidate); err != nil {
			failures = append(
				failures,
				fmt.Errorf(
					"conversation %s: %w",
					candidate.Conversation.ID,
					err,
				),
			)
		}
	}

	return errors.Join(failures...)
}

func (s *subServer) followerResyncCandidates(
	ctx context.Context,
) ([]repository.FollowerProjection, error) {
	var candidates []repository.FollowerProjection
	err := s.composition.UnitOfWork.Execute(
		ctx,
		func(transaction ports.Transaction) error {
			var listErr error
			candidates, listErr = transaction.Repositories.Followers.ListByStatus(
				ctx,
				repository.FollowerStatusResyncRequired,
				productionFollowerResyncBatch,
			)

			return listErr
		},
	)

	return candidates, err
}

func (s *subServer) resyncFollower(
	ctx context.Context,
	candidate repository.FollowerProjection,
) error {
	runtime, err := s.composition.FederationRuntime()
	if err != nil {
		return err
	}
	afterSequence := candidate.Head.Sequence
	afterHash := candidate.Head.EventHash.Bytes()
	for pageIndex := 0; pageIndex < productionFollowerResyncPages; pageIndex++ {
		request, err := newFollowerResyncRequest(
			candidate,
			s.localStation,
			afterSequence,
			afterHash,
		)
		if err != nil {
			return err
		}
		requestBytes, err := deterministicProductionProto(request)
		if err != nil {
			return err
		}
		page := &chatmodel.ConversationFollowerEventsPage{}
		err = runtime.CallPeer(ctx, federationruntime.PeerCall{
			TargetStationPeerID: string(
				candidate.Conversation.AuthorityStation,
			),
			Route: federationruntime.
				PeerRouteConversationFollowerEvents,
			Subject: string(s.localStation),
			Claims: map[string]string{
				federationruntime.ClaimConversationID: string(
					candidate.Conversation.ID,
				),
				federationruntime.ClaimFollowerRequestSHA256: hex.EncodeToString(
					valueobject.HashBytes(requestBytes).Bytes(),
				),
				federationruntime.ClaimSourceStationPeerID: string(
					s.localStation,
				),
				federationruntime.ClaimTargetStationPeerID: string(
					candidate.Conversation.AuthorityStation,
				),
			},
			Request:  request,
			Response: page,
		})
		if err != nil {
			return err
		}
		if err := s.verifyFollowerResyncPage(
			ctx,
			runtime,
			request,
			page,
		); err != nil {
			_ = s.setFollowerStatus(
				ctx,
				candidate.Conversation.ID,
				repository.FollowerStatusReadOnly,
			)
			return err
		}
		if len(page.GetConversationEvents()) == 0 {
			if page.GetHasMore() {
				return fmt.Errorf(
					"empty follower page cannot declare more events",
				)
			}
			return nil
		}
		for _, event := range page.GetConversationEvents() {
			record, err := productionRecordFromWire(event)
			if err != nil {
				return err
			}
			if err := s.composition.CommandService.ApplyFollowerEvent(
				ctx,
				record,
			); err != nil {
				return err
			}
			afterSequence = record.Sequence
			afterHash = record.Hash.Bytes()
		}
		if !page.GetHasMore() {
			return nil
		}
	}

	return fmt.Errorf(
		"follower resync exceeded %d pages",
		productionFollowerResyncPages,
	)
}

func newFollowerResyncRequest(
	candidate repository.FollowerProjection,
	localStation valueobject.StationID,
	afterSequence valueobject.Sequence,
	afterHash []byte,
) (*chatmodel.GetConversationFollowerEventsRequest, error) {
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate follower resync nonce: %w", err)
	}

	return &chatmodel.GetConversationFollowerEventsRequest{
		FormatVersion:          productionFollowerReplayFormatVersion,
		ConversationId:         string(candidate.Conversation.ID),
		AuthorityStationPeerId: string(candidate.Conversation.AuthorityStation),
		TargetHomeStationPeerId: string(
			localStation,
		),
		AfterSequence: int64(afterSequence),
		AfterEventHash: append(
			[]byte(nil),
			afterHash...,
		),
		RequestNonce: nonce,
		PageLimit:    productionFollowerReplayLimit,
	}, nil
}

func (s *subServer) verifyFollowerResyncPage(
	ctx context.Context,
	runtime ProductionFederationRuntime,
	request *chatmodel.GetConversationFollowerEventsRequest,
	page *chatmodel.ConversationFollowerEventsPage,
) error {
	if page == nil ||
		page.GetFormatVersion() != request.GetFormatVersion() ||
		page.GetAuthorityStationPeerId() != request.GetAuthorityStationPeerId() ||
		page.GetTargetHomeStationPeerId() != request.GetTargetHomeStationPeerId() ||
		page.GetConversationId() != request.GetConversationId() ||
		!bytes.Equal(page.GetRequestNonce(), request.GetRequestNonce()) ||
		page.GetGeneratedAt() == nil ||
		page.GetExpiresAt() == nil ||
		!page.GetExpiresAt().AsTime().After(s.composition.clock.Now()) ||
		len(page.GetConversationEvents()) != len(page.GetEventProjectionGrants()) {
		return fmt.Errorf("follower resync page binding is invalid")
	}
	for index, event := range page.GetConversationEvents() {
		grant := page.GetEventProjectionGrants()[index]
		if event == nil ||
			grant == nil ||
			grant.GetEventId() != event.GetEventId() ||
			grant.GetTargetHomeStationPeerId() != string(s.localStation) ||
			grant.GetEntitlementReason() == "" {
			return fmt.Errorf("follower resync event grant is invalid")
		}
	}
	signingInput, err := productionFollowerPageSigningInput(request, page)
	if err != nil {
		return err
	}
	signingBytes, err := deterministicProductionProto(signingInput)
	if err != nil {
		return err
	}

	return runtime.VerifyPeerSignature(
		ctx,
		page.GetAuthorityStationPeerId(),
		page.GetSigningKeyId(),
		signingBytes,
		page.GetAuthoritySignature(),
	)
}

func (s *subServer) setFollowerStatus(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	status repository.FollowerStatus,
) error {
	return s.composition.UnitOfWork.Execute(
		ctx,
		func(transaction ports.Transaction) error {
			return transaction.Repositories.Followers.SetStatus(
				ctx,
				conversationID,
				status,
			)
		},
	)
}
