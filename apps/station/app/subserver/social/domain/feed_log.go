package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"math"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	PublicFeedChainID = "public/v1"
	FeedGenesisDomain = "peers-touch/social-feed/genesis/v1\x00"
	FeedGrantDomain   = "peers-touch/social-feed/writer-grant/v1\x00"
	FeedEventDomain   = "peers-touch/social-feed/event/v1\x00"
	FeedHashDomain    = "peers-touch/social-feed/event-hash/v1\x00"
)

var (
	ErrFeedInvalid        = errors.New("FEED_INVALID")
	ErrFeedSignature      = errors.New("FEED_SIGNATURE_INVALID")
	ErrFeedWriter         = errors.New("FEED_WRITER_NOT_AUTHORIZED")
	ErrFeedGap            = errors.New("FEED_GAP")
	ErrFeedFork           = errors.New("FEED_FORK_DETECTED")
	ErrFeedRollback       = errors.New("FEED_HEAD_ROLLBACK")
	ErrFeedSignedRequired = errors.New("FEED_SIGNED_EVENT_REQUIRED")
)

// VerifyFeedAuthorization requires an independently retained Actor root key.
// Accepting the root from the bundle alone would let a Station impersonate it.
func VerifyFeedAuthorization(
	genesis *model.FeedGenesis,
	grant *model.FeedWriterGrant,
	actorPTID string,
	trustedRoot []byte,
) error {
	if genesis == nil || grant == nil || genesis.Statement == nil || grant.Statement == nil ||
		actorPTID == "" || len(trustedRoot) != ed25519.PublicKeySize {
		return ErrFeedInvalid
	}
	g, w := genesis.Statement, grant.Statement
	if g.FormatVersion != 1 || w.FormatVersion != 1 ||
		g.ActorPtid != actorPTID || w.ActorPtid != actorPTID ||
		g.ChainId != PublicFeedChainID || w.ChainId != g.ChainId ||
		!bytes.Equal(g.ActorIdentityPublicKey, trustedRoot) ||
		!feedIdentifier(w.DeviceId) || !feedIdentifier(w.SigningKeyId) ||
		len(w.DevicePublicKey) != ed25519.PublicKeySize {
		return ErrFeedWriter
	}
	if err := signedlog.Verify(FeedGenesisDomain, g, trustedRoot, genesis.ActorSignature); err != nil {
		return ErrFeedSignature
	}
	genesisHash, err := signedlog.Hash(FeedGenesisDomain, genesis)
	if err != nil || !bytes.Equal(genesisHash, w.GenesisHash) {
		return ErrFeedInvalid
	}
	if err := signedlog.Verify(FeedGrantDomain, w, trustedRoot, grant.ActorSignature); err != nil {
		return ErrFeedSignature
	}
	return nil
}

func feedIdentifier(value string) bool {
	return len(value) > 0 && len(value) <= 512 &&
		strings.TrimSpace(value) == value && !strings.ContainsRune(value, '\x00')
}

// VerifyFeedEvent authenticates one event without claiming chain continuity.
// Non-follower interactions deliberately use this operation.
func VerifyFeedEvent(event *model.FeedEvent, grant *model.FeedWriterGrant) error {
	if event == nil || event.Statement == nil || grant == nil || grant.Statement == nil {
		return ErrFeedInvalid
	}
	statement, writer := event.Statement, grant.Statement
	if statement.FormatVersion != 1 || statement.Sequence == 0 || statement.Sequence > math.MaxInt64 ||
		statement.ActorPtid != writer.ActorPtid || statement.ChainId != writer.ChainId ||
		statement.CreatedAtUnixMs <= 0 || len(statement.PreviousHash) != sha256.Size ||
		len(event.Payload) == 0 || len(event.Payload) > signedlog.MaxMessageBytes ||
		statement.Kind < model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED ||
		statement.Kind > model.FeedEventKind_FEED_EVENT_KIND_POLL_BALLOT_SET {
		return ErrFeedInvalid
	}
	grantHash, err := signedlog.Hash(FeedGrantDomain, grant)
	if err != nil || !bytes.Equal(grantHash, statement.WriterGrantHash) {
		return ErrFeedWriter
	}
	payloadHash := sha256.Sum256(event.Payload)
	if !bytes.Equal(payloadHash[:], statement.PayloadHash) {
		return ErrFeedInvalid
	}
	if _, err := signedlog.Canonical(event); err != nil {
		return ErrFeedInvalid
	}
	if err := signedlog.Verify(FeedEventDomain, statement, writer.DevicePublicKey, event.DeviceSignature); err != nil {
		return ErrFeedSignature
	}
	payload := &model.FeedPayload{}
	if err := signedlog.Decode(event.Payload, payload); err != nil {
		return ErrFeedInvalid
	}
	if err := ValidateFeedPayload(statement.Kind, payload); err != nil {
		return err
	}
	if statement.Kind == model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED && payload.GetPost() != nil {
		request := &model.CreatePostRequest{}
		if err := signedlog.Decode(payload.GetPost().CreateRequest, request); err != nil {
			return ErrFeedInvalid
		}
		if request.GetPoll() != nil {
			_, err := FeedPollDefinitionFor(request.GetPoll(), statement.CreatedAtUnixMs)
			return err
		}
	}
	return nil
}

func FeedEventHash(event *model.FeedEvent) ([]byte, error) {
	return signedlog.Hash(FeedHashDomain, event)
}

// AdvanceFeedHead must run after authenticity verification. A sequence gap is
// retryable, not evidence of a fork. Historical duplicates are checked by the
// durable log owner before this function is called.
func AdvanceFeedHead(head *model.FeedHead, event *model.FeedEvent) (*model.FeedHead, error) {
	if head == nil || event == nil || event.Statement == nil {
		return nil, ErrFeedInvalid
	}
	s := event.Statement
	if s.ActorPtid != head.ActorPtid || s.ChainId != head.ChainId {
		return nil, ErrFeedInvalid
	}
	if s.Sequence <= head.Sequence {
		return nil, ErrFeedRollback
	}
	if s.Sequence != head.Sequence+1 {
		return nil, ErrFeedGap
	}
	if !bytes.Equal(s.PreviousHash, head.EventHash) {
		return nil, ErrFeedFork
	}
	hash, err := FeedEventHash(event)
	if err != nil {
		return nil, err
	}
	return &model.FeedHead{
		ActorPtid: s.ActorPtid, ChainId: s.ChainId,
		Sequence: s.Sequence, EventHash: hash,
	}, nil
}
