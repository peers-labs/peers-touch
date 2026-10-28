package bootstrapblob

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

type fixture struct {
	store    *Store
	message  *peerpb.PublishBootstrapBlobRequest
	endpoint string
	locator  []byte
	now      time.Time
	node     crypto.PrivKey
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	root, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	node, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	relay, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	id, _ := peer.IDFromPrivateKey(relay)
	station, _ := peer.IDFromPrivateKey(root)
	now := time.Now().UTC().Truncate(time.Millisecond)
	authorization, err := peerpb.SignStationNodeAuthorization(root, node.GetPublic(), 7, []string{"station-route"}, now, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	locator := bytes.Repeat([]byte{3}, 32)
	digest := sha256.Sum256(locator)
	sealed := bytes.Repeat([]byte{8}, 200)
	blobDigest := sha256.Sum256(sealed)
	message, err := peerpb.SignBootstrapBlob(node, authorization, &peerpb.BootstrapBlobStatement{
		ProtocolVersion: 1, LocatorDigest: digest[:], BlobDigest: blobDigest[:],
		StationPeerId: station.String(), RetrievalEndpointIdentity: id.String(),
		IssuedAtUnixMs: now.UnixMilli(), ExpiresAtUnixMs: now.Add(time.Minute).UnixMilli(), MaxSources: 4,
	}, sealed, now)
	if err != nil {
		t.Fatal(err)
	}
	return fixture{NewStore(), message, id.String(), locator, now, node}
}

func (f fixture) request(t *testing.T, key crypto.PrivKey) *peerpb.RetrieveBootstrapBlobRequest {
	t.Helper()
	digest := sha256.Sum256(f.locator)
	proof, err := peerpb.SignAccessEndpointSourceProof(key, &peerpb.AccessEndpointSourceProofStatement{
		Challenge: bytes.Repeat([]byte{1}, 32), ConnectionGrantDigest: digest[:],
		RelayPeerId: f.endpoint, ClientProtocolVersion: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &peerpb.RetrieveBootstrapBlobRequest{Locator: f.locator, SourceProof: proof}
}

func current(_ context.Context, _ *peerpb.VerifiedBootstrapBlob, generation uint64) bool {
	return generation == 9
}

func TestConcurrentSourcesAreBoundedAndRetryKeepsSlot(t *testing.T) {
	f := newFixture(t)
	if _, err := f.store.Publish(f.message, f.endpoint, 9, f.now); err != nil {
		t.Fatal(err)
	}
	requests := make([]*peerpb.RetrieveBootstrapBlobRequest, 12)
	for i := range requests {
		key, _, _ := crypto.GenerateEd25519Key(rand.Reader)
		requests[i] = f.request(t, key)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	winners := []*peerpb.RetrieveBootstrapBlobRequest{}
	for _, request := range requests {
		wg.Add(1)
		go func(request *peerpb.RetrieveBootstrapBlobRequest) {
			defer wg.Done()
			_, err := f.store.Retrieve(context.Background(), request, f.endpoint, f.now, current)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				winners = append(winners, request)
			} else if !errors.Is(err, ErrSourceLimit) {
				t.Error(err)
			}
		}(request)
	}
	wg.Wait()
	if len(winners) != 4 {
		t.Fatalf("accepted %d sources", len(winners))
	}
	for _, request := range winners {
		response, err := f.store.Retrieve(context.Background(), request, f.endpoint, f.now, current)
		if err != nil || !bytes.Equal(response.GetSealedBlob(), f.message.GetSealedBlob()) {
			t.Fatalf("retry: %v", err)
		}
	}
}

func TestInvalidProofExpiryRevocationAndRestartFailClosed(t *testing.T) {
	f := newFixture(t)
	_, _ = f.store.Publish(f.message, f.endpoint, 9, f.now)
	source, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	request := f.request(t, source)
	forged := proto.Clone(request).(*peerpb.RetrieveBootstrapBlobRequest)
	forged.SourceProof.SourceSignature[0] ^= 1
	if _, err := f.store.Retrieve(context.Background(), forged, f.endpoint, f.now, current); err == nil {
		t.Fatal("forged source accepted")
	}
	if _, err := f.store.Retrieve(context.Background(), request, f.endpoint, f.now,
		func(context.Context, *peerpb.VerifiedBootstrapBlob, uint64) bool { return false }); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("revocation: %v", err)
	}
	if _, err := NewStore().Retrieve(context.Background(), request, f.endpoint, f.now, current); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("restart: %v", err)
	}
	if _, err := f.store.Retrieve(context.Background(), request, f.endpoint, f.now.Add(time.Minute), current); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expiry: %v", err)
	}
}

func TestPublicationIsImmutableAndBoundedPerNode(t *testing.T) {
	f := newFixture(t)
	if _, err := f.store.Publish(f.message, f.endpoint, 9, f.now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.Publish(f.message, f.endpoint, 9, f.now); err != nil {
		t.Fatal("idempotent publish", err)
	}
	if _, err := f.store.Publish(f.message, f.endpoint, 10, f.now); err == nil {
		t.Fatal("replacement generation reused locator")
	}
	tampered := proto.Clone(f.message).(*peerpb.PublishBootstrapBlobRequest)
	tampered.SealedBlob[0] ^= 1
	if _, err := f.store.Publish(tampered, f.endpoint, 9, f.now); err == nil {
		t.Fatal("ciphertext substitution accepted")
	}
	for i := 1; i <= maxNodeEntries; i++ {
		statement := &peerpb.BootstrapBlobStatement{}
		_ = proto.Unmarshal(f.message.GetStatementBytes(), statement)
		digest := sha256.Sum256([]byte{byte(i)})
		statement.LocatorDigest = digest[:]
		message, err := peerpb.SignBootstrapBlob(f.node, f.message.GetNodeAuthorization(), statement, f.message.GetSealedBlob(), f.now)
		if err != nil {
			t.Fatal(err)
		}
		_, err = f.store.Publish(message, f.endpoint, 9, f.now)
		if i < maxNodeEntries && err != nil {
			t.Fatal(err)
		}
		if i == maxNodeEntries && !errors.Is(err, ErrCapacity) {
			t.Fatalf("quota: %v", err)
		}
	}
}

func TestRetriesAreFiniteAndReturnedBuffersCannotMutateTruth(t *testing.T) {
	f := newFixture(t)
	_, _ = f.store.Publish(f.message, f.endpoint, 9, f.now)
	source, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	request := f.request(t, source)
	for i := 0; i < 16; i++ {
		response, err := f.store.Retrieve(context.Background(), request, f.endpoint, f.now, current)
		if err != nil {
			t.Fatal(err)
		}
		if response.SealedBlob[0] != 8 {
			t.Fatal("response mutated stored ciphertext")
		}
		response.SealedBlob[0] = 0
	}
	if _, err := f.store.Retrieve(context.Background(), request, f.endpoint, f.now, current); !errors.Is(err, ErrCapacity) {
		t.Fatalf("retry bound: %v", err)
	}
}
