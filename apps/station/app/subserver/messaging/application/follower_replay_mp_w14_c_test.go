package application_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type mpW14CReplaySource struct {
	granted      []messaging.GrantedFollowerEvent
	nextSequence int64
	hasMore      bool
	err          error
}

func (s mpW14CReplaySource) ReadGrantedFollowerEvents(
	context.Context,
	*chat.GetMessagingFollowerEventsRequest,
) ([]messaging.GrantedFollowerEvent, int64, bool, error) {
	return s.granted, s.nextSequence, s.hasMore, s.err
}

type mpW14CReplaySigner struct {
	keyID      string
	privateKey ed25519.PrivateKey
}

func (s mpW14CReplaySigner) SignFollowerEventsPage(
	_ context.Context,
	request *chat.GetMessagingFollowerEventsRequest,
	page *chat.MessagingFollowerEventsPage,
) error {
	return application.SignFollowerEventsPage(
		request,
		page,
		s.keyID,
		s.privateKey,
	)
}

func TestFollowerReplayPageVerification(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	otherPublicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	event := mpW14CCreatedEvent(t, now)
	request := &chat.GetMessagingFollowerEventsRequest{
		FormatVersion:       application.MessagingFollowerReplayFormatVersion,
		ConversationId:      event.ConversationId,
		AuthorityStationId:  mpW14CAuthorityStation,
		TargetHomeStationId: mpW14CLocalStation,
		RequestNonce:        make([]byte, sha256.Size),
		PageLimit:           32,
	}
	page := &chat.MessagingFollowerEventsPage{
		FormatVersion:       application.MessagingFollowerReplayFormatVersion,
		AuthorityStationId:  mpW14CAuthorityStation,
		TargetHomeStationId: mpW14CLocalStation,
		ConversationId:      event.ConversationId,
		RequestNonce:        append([]byte(nil), request.RequestNonce...),
		ConversationEvents:  []*chat.ConversationEvent{event},
		EventProjectionGrants: []*chat.MessagingEventProjectionGrant{
			{
				EventId:             event.EventId,
				TargetHomeStationId: mpW14CLocalStation,
				EntitlementReason:   "conversation_create",
			},
		},
		NextSequence: event.Sequence,
		GeneratedAt:  timestamppb.New(now),
		ExpiresAt:    timestamppb.New(now.Add(time.Minute)),
	}
	if err := application.SignFollowerEventsPage(
		request,
		page,
		mpW14CAuthorityKey,
		privateKey,
	); err != nil {
		t.Fatal(err)
	}
	if err := application.VerifyFollowerEventsPage(
		request,
		page,
		mpW14CAuthorityStation,
		mpW14CLocalStation,
		mpW14CAuthorityKey,
		publicKey,
		now,
	); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name                 string
		mutate               func(*chat.MessagingFollowerEventsPage)
		expectedSigningKeyID string
		publicKey            ed25519.PublicKey
	}{
		{
			name: "signature",
			mutate: func(candidate *chat.MessagingFollowerEventsPage) {
				candidate.AuthoritySignature[0] ^= 1
			},
			expectedSigningKeyID: mpW14CAuthorityKey,
			publicKey:            publicKey,
		},
		{
			name: "nonce",
			mutate: func(candidate *chat.MessagingFollowerEventsPage) {
				candidate.RequestNonce[0] ^= 1
			},
			expectedSigningKeyID: mpW14CAuthorityKey,
			publicKey:            publicKey,
		},
		{
			name:                 "pinned signing key",
			mutate:               func(*chat.MessagingFollowerEventsPage) {},
			expectedSigningKeyID: "authority-key:other",
			publicKey:            publicKey,
		},
		{
			name: "public key",
			mutate: func(*chat.MessagingFollowerEventsPage) {
			},
			expectedSigningKeyID: mpW14CAuthorityKey,
			publicKey:            otherPublicKey,
		},
		{
			name: "expiry",
			mutate: func(candidate *chat.MessagingFollowerEventsPage) {
				candidate.ExpiresAt = timestamppb.New(now.Add(-time.Second))
			},
			expectedSigningKeyID: mpW14CAuthorityKey,
			publicKey:            publicKey,
		},
		{
			name: "grant target",
			mutate: func(candidate *chat.MessagingFollowerEventsPage) {
				candidate.EventProjectionGrants[0].TargetHomeStationId = "station:other"
			},
			expectedSigningKeyID: mpW14CAuthorityKey,
			publicKey:            publicKey,
		},
		{
			name: "grant event",
			mutate: func(candidate *chat.MessagingFollowerEventsPage) {
				candidate.EventProjectionGrants[0].EventId = "event:other"
			},
			expectedSigningKeyID: mpW14CAuthorityKey,
			publicKey:            publicKey,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := proto.Clone(page).(*chat.MessagingFollowerEventsPage)
			test.mutate(candidate)
			err := application.VerifyFollowerEventsPage(
				request,
				candidate,
				mpW14CAuthorityStation,
				mpW14CLocalStation,
				test.expectedSigningKeyID,
				test.publicKey,
				now,
			)
			if !errors.Is(err, messaging.ErrFollowerReplayInvalid) {
				t.Fatalf("verification error = %v", err)
			}
		})
	}
}

func TestFollowerReplayServiceGetPage(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	event := mpW14CCreatedEvent(t, now)
	request := &chat.GetMessagingFollowerEventsRequest{
		FormatVersion:       application.MessagingFollowerReplayFormatVersion,
		ConversationId:      event.ConversationId,
		AuthorityStationId:  mpW14CAuthorityStation,
		TargetHomeStationId: mpW14CLocalStation,
		RequestNonce:        make([]byte, sha256.Size),
		PageLimit:           32,
	}
	signer := mpW14CReplaySigner{
		keyID:      mpW14CAuthorityKey,
		privateKey: privateKey,
	}

	t.Run("grant mismatch is unavailable", func(t *testing.T) {
		service, err := application.NewFollowerReplayService(
			mpW14CReplaySource{
				granted: []messaging.GrantedFollowerEvent{
					{
						Event: event,
						Grant: messaging.EventProjectionGrant{
							ConversationID:      event.ConversationId,
							EventID:             event.EventId,
							TargetHomeStationID: "station:other",
							EntitlementReason:   "conversation_create",
						},
					},
				},
				nextSequence: event.Sequence,
			},
			signer,
			mpW14CAuthorityStation,
			application.FollowerReplayPolicy{
				MaxPageEvents: 128,
				PageTTL:       time.Minute,
			},
			func() time.Time { return now },
		)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.GetPage(
			context.Background(),
			mpW14CLocalStation,
			request,
		); !errors.Is(err, messaging.ErrFollowerReplayUnavailable) {
			t.Fatalf("grant mismatch error = %v", err)
		}
	})

	t.Run("source unavailable is preserved", func(t *testing.T) {
		service, err := application.NewFollowerReplayService(
			mpW14CReplaySource{err: messaging.ErrFollowerReplayUnavailable},
			signer,
			mpW14CAuthorityStation,
			application.FollowerReplayPolicy{
				MaxPageEvents: 128,
				PageTTL:       time.Minute,
			},
			func() time.Time { return now },
		)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.GetPage(
			context.Background(),
			mpW14CLocalStation,
			request,
		); !errors.Is(err, messaging.ErrFollowerReplayUnavailable) {
			t.Fatalf("source unavailable error = %v", err)
		}
	})
}
