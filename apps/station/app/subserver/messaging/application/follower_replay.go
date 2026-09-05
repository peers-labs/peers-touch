package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const MessagingFollowerReplayFormatVersion uint32 = 1

type FollowerReplayPolicy struct {
	MaxPageEvents uint32
	PageTTL       time.Duration
}

type FollowerReplayService struct {
	source         messaging.FollowerReplaySource
	signer         messaging.FollowerReplayPageSigner
	localStationID string
	policy         FollowerReplayPolicy
	clock          func() time.Time
}

func NewFollowerReplayService(
	source messaging.FollowerReplaySource,
	signer messaging.FollowerReplayPageSigner,
	localStationID string,
	policy FollowerReplayPolicy,
	clock func() time.Time,
) (*FollowerReplayService, error) {
	if source == nil ||
		signer == nil ||
		localStationID == "" ||
		policy.MaxPageEvents == 0 ||
		policy.PageTTL <= 0 ||
		clock == nil {
		return nil, fmt.Errorf("messaging: follower replay service dependencies are invalid")
	}
	return &FollowerReplayService{
		source:         source,
		signer:         signer,
		localStationID: localStationID,
		policy:         policy,
		clock:          clock,
	}, nil
}

func (s *FollowerReplayService) GetPage(
	ctx context.Context,
	requestingHomeStationID string,
	request *chat.GetMessagingFollowerEventsRequest,
) (*chat.MessagingFollowerEventsPage, error) {
	if request == nil ||
		request.FormatVersion != MessagingFollowerReplayFormatVersion ||
		request.AuthorityStationId != s.localStationID ||
		request.TargetHomeStationId != requestingHomeStationID ||
		request.ConversationId == "" ||
		request.AfterSequence < 0 ||
		len(request.RequestNonce) != sha256.Size ||
		request.PageLimit == 0 ||
		request.PageLimit > s.policy.MaxPageEvents {
		return nil, messaging.ErrFollowerReplayInvalid
	}
	granted, nextSequence, hasMore, err := s.source.ReadGrantedFollowerEvents(ctx, request)
	if err != nil {
		return nil, err
	}
	events := make([]*chat.ConversationEvent, 0, len(granted))
	grants := make([]*chat.MessagingEventProjectionGrant, 0, len(granted))
	for _, item := range granted {
		if item.Event == nil ||
			item.Grant.ConversationID != request.ConversationId ||
			item.Grant.EventID != item.Event.EventId ||
			item.Grant.TargetHomeStationID != requestingHomeStationID ||
			item.Grant.EntitlementReason == "" {
			return nil, messaging.ErrFollowerReplayUnavailable
		}
		events = append(events, item.Event)
		grants = append(grants, &chat.MessagingEventProjectionGrant{
			EventId:             item.Grant.EventID,
			TargetHomeStationId: item.Grant.TargetHomeStationID,
			EntitlementReason:   item.Grant.EntitlementReason,
		})
	}
	now := s.clock().UTC()
	page := &chat.MessagingFollowerEventsPage{
		FormatVersion:         MessagingFollowerReplayFormatVersion,
		AuthorityStationId:    s.localStationID,
		TargetHomeStationId:   requestingHomeStationID,
		ConversationId:        request.ConversationId,
		RequestNonce:          append([]byte(nil), request.RequestNonce...),
		ConversationEvents:    events,
		EventProjectionGrants: grants,
		NextSequence:          nextSequence,
		HasMore:               hasMore,
		GeneratedAt:           timestamppb.New(now),
		ExpiresAt:             timestamppb.New(now.Add(s.policy.PageTTL)),
	}
	if err := s.signer.SignFollowerEventsPage(ctx, request, page); err != nil {
		return nil, err
	}
	return page, nil
}

func SignFollowerEventsPage(
	request *chat.GetMessagingFollowerEventsRequest,
	page *chat.MessagingFollowerEventsPage,
	signingKeyID string,
	privateKey ed25519.PrivateKey,
) error {
	if request == nil ||
		page == nil ||
		signingKeyID == "" ||
		len(privateKey) != ed25519.PrivateKeySize {
		return messaging.ErrFollowerReplayInvalid
	}
	page.SigningKeyId = signingKeyID
	signingInput, err := followerEventsPageSigningInput(request, page)
	if err != nil {
		return err
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(signingInput)
	if err != nil {
		return err
	}
	page.AuthoritySignature = ed25519.Sign(privateKey, signingBytes)
	return nil
}

func VerifyFollowerEventsPage(
	request *chat.GetMessagingFollowerEventsRequest,
	page *chat.MessagingFollowerEventsPage,
	expectedAuthorityStationID string,
	expectedTargetHomeStationID string,
	expectedSigningKeyID string,
	publicKey ed25519.PublicKey,
	now time.Time,
) error {
	if request == nil ||
		page == nil ||
		expectedAuthorityStationID == "" ||
		expectedTargetHomeStationID == "" ||
		expectedSigningKeyID == "" ||
		len(publicKey) != ed25519.PublicKeySize ||
		len(page.AuthoritySignature) != ed25519.SignatureSize ||
		page.FormatVersion != MessagingFollowerReplayFormatVersion ||
		page.AuthorityStationId != expectedAuthorityStationID ||
		page.TargetHomeStationId != expectedTargetHomeStationID ||
		page.ConversationId != request.ConversationId ||
		!bytes.Equal(page.RequestNonce, request.RequestNonce) ||
		page.SigningKeyId != expectedSigningKeyID ||
		page.GeneratedAt == nil ||
		page.ExpiresAt == nil ||
		!page.ExpiresAt.AsTime().After(page.GeneratedAt.AsTime()) ||
		page.ExpiresAt.AsTime().Before(now) ||
		page.GeneratedAt.AsTime().After(now.Add(messaging.FederationClockSkewBudget)) ||
		len(page.ConversationEvents) != len(page.EventProjectionGrants) {
		return messaging.ErrFollowerReplayInvalid
	}
	previousSequence := request.AfterSequence
	for index, event := range page.ConversationEvents {
		grant := page.EventProjectionGrants[index]
		if event == nil ||
			grant == nil ||
			event.ConversationId != request.ConversationId ||
			event.AuthorityStationId != expectedAuthorityStationID ||
			event.Sequence <= previousSequence ||
			grant.EventId != event.EventId ||
			grant.TargetHomeStationId != expectedTargetHomeStationID ||
			grant.EntitlementReason == "" {
			return messaging.ErrFollowerReplayInvalid
		}
		previousSequence = event.Sequence
	}
	if page.NextSequence != previousSequence {
		return messaging.ErrFollowerReplayInvalid
	}
	signingInput, err := followerEventsPageSigningInput(request, page)
	if err != nil {
		return err
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(signingInput)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, signingBytes, page.AuthoritySignature) {
		return messaging.ErrFollowerReplayInvalid
	}
	return nil
}

func FollowerReplayRequestSHA256(
	request *chat.GetMessagingFollowerEventsRequest,
) ([]byte, error) {
	if request == nil {
		return nil, messaging.ErrFollowerReplayInvalid
	}
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(requestBytes)
	return digest[:], nil
}

func followerEventsPageSigningInput(
	request *chat.GetMessagingFollowerEventsRequest,
	page *chat.MessagingFollowerEventsPage,
) (*chat.MessagingFollowerEventsPageSigningInput, error) {
	eventsDigest, err := orderedProtoDigest(page.ConversationEvents)
	if err != nil {
		return nil, err
	}
	grantsDigest, err := orderedProtoDigest(page.EventProjectionGrants)
	if err != nil {
		return nil, err
	}
	return &chat.MessagingFollowerEventsPageSigningInput{
		FormatVersion:               page.FormatVersion,
		AuthorityStationId:          page.AuthorityStationId,
		TargetHomeStationId:         page.TargetHomeStationId,
		ConversationId:              page.ConversationId,
		RequestNonce:                append([]byte(nil), page.RequestNonce...),
		AfterSequence:               request.AfterSequence,
		AfterEventHash:              append([]byte(nil), request.AfterEventHash...),
		EventsSha256:                eventsDigest,
		EventProjectionGrantsSha256: grantsDigest,
		NextSequence:                page.NextSequence,
		HasMore:                     page.HasMore,
		GeneratedAt:                 page.GeneratedAt,
		ExpiresAt:                   page.ExpiresAt,
		SigningKeyId:                page.SigningKeyId,
	}, nil
}

func orderedProtoDigest[T proto.Message](messages []T) ([]byte, error) {
	var input bytes.Buffer
	for _, message := range messages {
		messageBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
		if err != nil {
			return nil, err
		}
		if len(messageBytes) > int(^uint32(0)) {
			return nil, messaging.ErrFollowerReplayInvalid
		}
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(messageBytes)))
		input.Write(length[:])
		input.Write(messageBytes)
	}
	digest := sha256.Sum256(input.Bytes())
	return digest[:], nil
}
