package conversation

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"testing"
	"time"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type proposalKeyResolver struct {
	key *actormodel.VerifiedActorDeviceSigningKey
	err error
}

func (r proposalKeyResolver) ResolveSigningKey(
	context.Context,
	string,
	string,
	string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	return r.key, r.err
}

type proposalFederationResolver struct {
	active bool
	err    error
}

func (r proposalFederationResolver) IsActiveStation(
	context.Context,
	string,
	string,
) (bool, error) {
	return r.active, r.err
}

type proposalHydratingKeyResolver struct {
	key      *actormodel.VerifiedActorDeviceSigningKey
	hydrated *bool
}

func (r proposalHydratingKeyResolver) ResolveSigningKey(
	context.Context,
	string,
	string,
	string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	if !*r.hydrated {
		return nil, errors.New("key unavailable")
	}
	return r.key, nil
}

type proposalKeyHydrator struct {
	hydrated *bool
}

func (h proposalKeyHydrator) Hydrate(
	context.Context,
	string,
	string,
	string,
) error {
	*h.hydrated = true
	return nil
}

func TestConversationCommandProposalMatchesLocalAuthorityResult(t *testing.T) {
	fixture := newProposalFixture(t)
	result, err := fixture.proposals.VerifyAndSubmit(
		fixture.ctx,
		fixture.proposal,
		fixture.claims,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Accepted || result.CommittedEvent == nil {
		t.Fatalf("remote proposal rejected: %+v", result)
	}

	localReplay, err := fixture.authority.SubmitCommand(fixture.ctx, fixture.proposal.Command)
	if err != nil {
		t.Fatalf("local replay: %v", err)
	}
	if localReplay.EventId != result.CommittedEvent.EventId ||
		!bytesEqual(localReplay.EventHash, result.CommittedEvent.EventHash) {
		t.Fatal("local and remote paths did not resolve to the same committed event")
	}
}

func TestConversationCommandProposalHydratesVerifiedActorKeyOnMiss(t *testing.T) {
	fixture := newProposalFixture(t)
	hydrated := false
	fixture.proposals.actorKeys = proposalHydratingKeyResolver{
		key:      fixture.key,
		hydrated: &hydrated,
	}
	fixture.proposals.keyHydrator = proposalKeyHydrator{hydrated: &hydrated}

	result, err := fixture.proposals.VerifyAndSubmit(
		fixture.ctx,
		fixture.proposal,
		fixture.claims,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !hydrated || !result.Accepted {
		t.Fatalf("verified actor key was not hydrated: %+v", result)
	}
}

func TestConversationCommandProposalRejectsBeforeAuthorityWrite(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*proposalFixture)
		code   chat.ConversationCommandRejectCode
	}{
		{
			name: "command hash mismatch",
			mutate: func(f *proposalFixture) {
				f.proposal.CommandSha256[0] ^= 0xff
				f.claims.CommandHash = hex.EncodeToString(f.proposal.CommandSha256)
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_HASH_MISMATCH,
		},
		{
			name: "claim mismatch",
			mutate: func(f *proposalFixture) {
				f.claims.Command = "forged-command"
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		},
		{
			name: "invalid actor signature",
			mutate: func(f *proposalFixture) {
				f.proposal.ActorSignature[0] ^= 0xff
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_ACTOR_SIGNATURE,
		},
		{
			name: "missing actor key",
			mutate: func(f *proposalFixture) {
				f.proposals.actorKeys = proposalKeyResolver{err: errors.New("missing")}
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_UNAVAILABLE,
		},
		{
			name: "wrong key home station",
			mutate: func(f *proposalFixture) {
				key := proto.Clone(f.key).(*actormodel.VerifiedActorDeviceSigningKey)
				key.HomeStationPeerId = "station-forged"
				f.proposals.actorKeys = proposalKeyResolver{key: key}
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		},
		{
			name: "inactive federation station",
			mutate: func(f *proposalFixture) {
				f.proposals.federation = proposalFederationResolver{active: false}
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INACTIVE_FEDERATION_STATION,
		},
		{
			name: "revoked actor key",
			mutate: func(f *proposalFixture) {
				key := proto.Clone(f.key).(*actormodel.VerifiedActorDeviceSigningKey)
				key.RevokedAtUnixMs = f.now.Add(-time.Minute).UnixMilli()
				f.proposals.actorKeys = proposalKeyResolver{key: key}
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_REVOKED,
		},
		{
			name: "wrong authority station",
			mutate: func(f *proposalFixture) {
				f.proposal.AuthorityStationPeerId = "station-forged"
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_NOT_AUTHORITY,
		},
		{
			name: "wrong command kind claim",
			mutate: func(f *proposalFixture) {
				f.claims.CommandKind = "1"
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		},
		{
			name: "unsupported typing command",
			mutate: func(f *proposalFixture) {
				f.proposal.Command.Payload = &chat.ConversationCommand_Typing{
					Typing: &chat.TypingCommand{IsTyping: true},
				}
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSUPPORTED_COMMAND,
		},
		{
			name: "expired command",
			mutate: func(f *proposalFixture) {
				f.proposal.ExpiresAtUnixMs = f.now.Add(-time.Second).UnixMilli()
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_EXPIRED,
		},
		{
			name: "unknown proposal version",
			mutate: func(f *proposalFixture) {
				f.proposal.Version++
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		},
		{
			name: "stale proposal",
			mutate: func(f *proposalFixture) {
				f.proposal.CreatedAtUnixMs = f.now.Add(-6 * time.Minute).UnixMilli()
			},
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newProposalFixture(t)
			test.mutate(fixture)
			result, err := fixture.proposals.VerifyAndSubmit(
				fixture.ctx,
				fixture.proposal,
				fixture.claims,
			)
			if err != nil {
				t.Fatal(err)
			}
			if result.Accepted || result.RejectCode != test.code {
				t.Fatalf("result = %+v, want reject %v", result, test.code)
			}
			persisted, err := fixture.repo.GetConversation(
				fixture.ctx,
				fixture.conversation.ConversationId,
			)
			if err != nil {
				t.Fatal(err)
			}
			if persisted.MembershipEpoch != 1 || persisted.MlsEpoch != 1 {
				t.Fatalf(
					"rejected proposal advanced epochs to (%d,%d)",
					persisted.MembershipEpoch,
					persisted.MlsEpoch,
				)
			}
			if _, err := fixture.repo.GetMember(
				fixture.ctx,
				fixture.conversation.ConversationId,
				"bob",
			); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("rejected proposal wrote bob membership: %v", err)
			}
		})
	}
}

type proposalFixture struct {
	ctx          context.Context
	now          time.Time
	repo         *postgresConversationRepo
	authority    *DefaultService
	proposals    *ConversationCommandProposalService
	conversation *chat.Conversation
	proposal     *chat.ConversationCommandProposal
	claims       ConversationCommandStationClaims
	key          *actormodel.VerifiedActorDeviceSigningKey
}

func newProposalFixture(t *testing.T) *proposalFixture {
	t.Helper()
	ctx := context.Background()
	now := time.Unix(1_800_000_000, 0)
	db := newTransitionTestDB(t)
	repo := newPostgresConversationRepo(db)
	authority := NewConversationService(
		repo,
		nil,
		"station-a",
		NewPostgresTransitionUnitOfWork(db),
	)
	authority.clock = func() time.Time { return now }
	genesis := testTransition(
		"proposal-genesis",
		0,
		[]*chat.MembershipTransitionChange{{
			Ptid:                   "alice",
			ActorHomeStationPeerId: "station-b",
			Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
			Role:                   chat.MemberRole_MEMBER_ROLE_OWNER,
		}},
	)
	conversation, _, err := authority.CreateGroup(
		ctx,
		"family",
		"alice",
		"station-b",
		"alice-device",
		"federation-family",
		"",
		genesis,
	)
	if err != nil {
		t.Fatal(err)
	}

	command := &chat.ConversationCommand{
		CommandId:      "command-add-bob",
		ConversationId: conversation.ConversationId,
		SenderPtid:     "alice",
		SenderDeviceId: "alice-device",
		Payload: &chat.ConversationCommand_MembershipTransition{
			MembershipTransition: testTransition(
				"proposal-add-bob",
				1,
				[]*chat.MembershipTransitionChange{{
					Ptid:                   "bob",
					ActorHomeStationPeerId: "station-c",
					Action:                 chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD,
					Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
				}},
				testWelcome("bob", "bob-device", "station-c", "welcome-bob"),
			),
		},
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	commandHash := sha256.Sum256(commandBytes)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	proposal := &chat.ConversationCommandProposal{
		Version:                conversationCommandProposalVersion,
		FederationId:           "federation-family",
		AuthorityStationPeerId: "station-a",
		HomeStationPeerId:      "station-b",
		ActorPtid:              "alice",
		ActorDeviceId:          "alice-device",
		ActorSigningKeyId:      "alice-device-key",
		AuthorityEpoch:         1,
		Command:                command,
		CommandSha256:          commandHash[:],
		CreatedAtUnixMs:        now.UnixMilli(),
		ExpiresAtUnixMs:        now.Add(2 * time.Minute).UnixMilli(),
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		proposalSigningInput(
			proposal,
			chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBERSHIP_TRANSITION,
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	proposal.ActorSignature = ed25519.Sign(privateKey, signingBytes)
	key := &actormodel.VerifiedActorDeviceSigningKey{
		ActorPtid:          "alice",
		ActorDeviceId:      "alice-device",
		HomeStationPeerId:  "station-b",
		SigningKeyId:       "alice-device-key",
		Ed25519PublicKey:   publicKey,
		ProfileVersion:     1,
		VerificationSource: actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
	}
	proposals := NewConversationCommandProposalService(
		authority,
		proposalKeyResolver{key: key},
		proposalFederationResolver{active: true},
		"station-a",
	)
	proposals.clock = func() time.Time { return now }
	claims := ConversationCommandStationClaims{
		Scope:          conversationCommandProposalScope,
		Issuer:         "station-b",
		Audience:       "station-a",
		Subject:        "alice",
		Federation:     "federation-family",
		Conversation:   conversation.ConversationId,
		Command:        command.CommandId,
		CommandKind:    "8",
		Device:         "alice-device",
		SigningKey:     "alice-device-key",
		CommandHash:    hex.EncodeToString(commandHash[:]),
		AuthorityEpoch: "1",
		ExpiresAt:      strconv.FormatInt(proposal.ExpiresAtUnixMs, 10),
	}
	return &proposalFixture{
		ctx:          ctx,
		now:          now,
		repo:         repo,
		authority:    authority,
		proposals:    proposals,
		conversation: conversation,
		proposal:     proposal,
		claims:       claims,
		key:          key,
	}
}
