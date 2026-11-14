package domain

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

func feedVector(t *testing.T) (*model.FeedBundle, []byte, string) {
	t.Helper()
	wire, err := os.ReadFile("../../../../../../model/domain/social/testdata/feed_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Root   string `json:"root_public_key"`
		Bundle string `json:"bundle"`
		Hash   string `json:"event_hash"`
	}
	if err := json.Unmarshal(wire, &vector); err != nil {
		t.Fatal(err)
	}
	root, err := hex.DecodeString(vector.Root)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := hex.DecodeString(vector.Bundle)
	if err != nil {
		t.Fatal(err)
	}
	bundle := &model.FeedBundle{}
	if err := signedlog.Decode(encoded, bundle); err != nil {
		t.Fatal(err)
	}
	return bundle, root, vector.Hash
}

func TestFeedIndependentConformanceVector(t *testing.T) {
	bundle, root, expected := feedVector(t)
	if err := VerifyFeedAuthorization(bundle.Genesis, bundle.WriterGrant, "ptid:test:alice", root); err != nil {
		t.Fatal(err)
	}
	if err := VerifyFeedEvent(bundle.Events[0], bundle.WriterGrant); err != nil {
		t.Fatal(err)
	}
	hash, err := FeedEventHash(bundle.Events[0])
	if err != nil || hex.EncodeToString(hash) != expected {
		t.Fatalf("hash %x: %v", hash, err)
	}
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{2}, 32))
	input, err := signedlog.SigningBytes(FeedEventDomain, bundle.Events[0].Statement)
	if err != nil || !bytes.Equal(ed25519.Sign(key, input), bundle.Events[0].DeviceSignature) {
		t.Fatal("independent signature vector mismatch")
	}
}

func TestFeedTrustTamperAndNamespace(t *testing.T) {
	bundle, root, _ := feedVector(t)
	if err := VerifyFeedAuthorization(bundle.Genesis, bundle.WriterGrant, "another-actor", root); !errors.Is(err, ErrFeedWriter) {
		t.Fatal(err)
	}
	wrongRoot := append([]byte(nil), root...)
	wrongRoot[0] ^= 1
	if err := VerifyFeedAuthorization(bundle.Genesis, bundle.WriterGrant, "ptid:test:alice", wrongRoot); !errors.Is(err, ErrFeedWriter) {
		t.Fatal(err)
	}
	changed := proto.Clone(bundle).(*model.FeedBundle)
	changed.Genesis.Statement.ChainId = "private/v1"
	if err := VerifyFeedAuthorization(changed.Genesis, changed.WriterGrant, "ptid:test:alice", root); !errors.Is(err, ErrFeedWriter) {
		t.Fatal(err)
	}
	changed = proto.Clone(bundle).(*model.FeedBundle)
	changed.Events[0].Payload[0] ^= 1
	if err := VerifyFeedEvent(changed.Events[0], changed.WriterGrant); !errors.Is(err, ErrFeedInvalid) {
		t.Fatal(err)
	}
	changed = proto.Clone(bundle).(*model.FeedBundle)
	changed.Events[0].DeviceSignature[0] ^= 1
	if err := VerifyFeedEvent(changed.Events[0], changed.WriterGrant); !errors.Is(err, ErrFeedSignature) {
		t.Fatal(err)
	}
}

func TestFeedGapForkAndRollbackAreDistinct(t *testing.T) {
	bundle, _, _ := feedVector(t)
	genesisHash, err := signedlog.Hash(FeedGenesisDomain, bundle.Genesis)
	if err != nil {
		t.Fatal(err)
	}
	head := &model.FeedHead{ActorPtid: "ptid:test:alice", ChainId: PublicFeedChainID, EventHash: genesisHash}
	next, err := AdvanceFeedHead(head, bundle.Events[0])
	if err != nil || next.Sequence != 1 {
		t.Fatal(next, err)
	}
	if _, err := AdvanceFeedHead(next, bundle.Events[0]); !errors.Is(err, ErrFeedRollback) {
		t.Fatal(err)
	}
	gap := proto.Clone(bundle.Events[0]).(*model.FeedEvent)
	gap.Statement.Sequence = 3
	if _, err := AdvanceFeedHead(head, gap); !errors.Is(err, ErrFeedGap) {
		t.Fatal(err)
	}
	fork := proto.Clone(bundle.Events[0]).(*model.FeedEvent)
	fork.Statement.PreviousHash[0] ^= 1
	if _, err := AdvanceFeedHead(head, fork); !errors.Is(err, ErrFeedFork) {
		t.Fatal(err)
	}
}

func TestFeedCanonicalRejectsNestedUnknownAndDuplicate(t *testing.T) {
	bundle, _, _ := feedVector(t)
	bundle.Genesis.Statement.ProtoReflect().SetUnknown([]byte{0x28, 1})
	if _, err := signedlog.Canonical(bundle); err == nil {
		t.Fatal("nested unknown field accepted")
	}
	bundle, _, _ = feedVector(t)
	wire, err := signedlog.Canonical(bundle)
	if err != nil {
		t.Fatal(err)
	}
	duplicateGenesis, err := signedlog.Canonical(bundle.Genesis)
	if err != nil {
		t.Fatal(err)
	}
	// Existing genesis is 132 bytes, encoded as a length-delimited field.
	wire = append(wire, 0x0a, 0x84, 0x01)
	wire = append(wire, duplicateGenesis...)
	if err := signedlog.Decode(wire, &model.FeedBundle{}); err == nil {
		t.Fatal("duplicate singular field accepted")
	}
}
