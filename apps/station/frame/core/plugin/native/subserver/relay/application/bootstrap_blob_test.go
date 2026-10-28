package application

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/bootstrapblob"
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func TestBootstrapRetrievalNeedsCurrentEnrollmentAndDoesNotRedeemGrant(t *testing.T) {
	root, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	node, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	source, _, _ := crypto.GenerateEd25519Key(rand.Reader)
	stationID, _ := peer.IDFromPrivateKey(root)
	nodeID, _ := peer.IDFromPrivateKey(node)
	rootPublic, _ := crypto.MarshalPublicKey(root.GetPublic())
	now := time.Now().UTC().Truncate(time.Millisecond)
	authority, err := NewCredentialAuthority(bytes.Repeat([]byte{0x61}, 32))
	if err != nil {
		t.Fatal(err)
	}
	repository := &discoveryTestRepository{enrollment: domain.Enrollment{
		ID: 19, StationPeerID: stationID.String(), NodePeerID: nodeID.String(),
		StationRootPublicKey: rootPublic, NodeAuthorizationEpoch: 7,
		NodeAuthorizationUntil: now.Add(time.Hour), CredentialJTI: "current",
		Generation: 9, Status: domain.EnrollmentStatusOnline,
	}}
	service := NewService(repository, authority, nativeRelay.NewAdmission())
	service.now = func() time.Time { return now }
	authorization, err := peerpb.SignStationNodeAuthorization(root, node.GetPublic(), 7, []string{"station-route"}, now, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	locator := bytes.Repeat([]byte{0x15}, 32)
	locatorDigest := sha256.Sum256(locator)
	ciphertext := bytes.Repeat([]byte{0x41}, 200)
	blobDigest := sha256.Sum256(ciphertext)
	message, err := peerpb.SignBootstrapBlob(node, authorization, &peerpb.BootstrapBlobStatement{
		ProtocolVersion: 1, LocatorDigest: locatorDigest[:], BlobDigest: blobDigest[:],
		StationPeerId: stationID.String(), RetrievalEndpointIdentity: authority.RelayPeerID(),
		IssuedAtUnixMs: now.UnixMilli(), ExpiresAtUnixMs: now.Add(time.Minute).UnixMilli(), MaxSources: 4,
	}, ciphertext, now)
	if err != nil {
		t.Fatal(err)
	}
	identity := domain.NodeIdentity{
		StationPeerID: stationID.String(), NodePeerID: nodeID.String(), RelayPeerID: authority.RelayPeerID(),
		EnrollmentID: 19, Generation: 9, JTI: "current", ExpiresAt: now.Add(time.Hour),
	}
	if _, err := service.PublishBootstrapBlob(context.Background(), identity, message); err != nil {
		t.Fatal(err)
	}
	proof, err := peerpb.SignAccessEndpointSourceProof(source, &peerpb.AccessEndpointSourceProofStatement{
		Challenge: bytes.Repeat([]byte{0x52}, 32), ConnectionGrantDigest: locatorDigest[:],
		RelayPeerId: authority.RelayPeerID(), ClientProtocolVersion: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := &peerpb.RetrieveBootstrapBlobRequest{Locator: locator, SourceProof: proof}
	if response, err := service.RetrieveBootstrapBlob(context.Background(), request); err != nil ||
		!bytes.Equal(response.GetSealedBlob(), ciphertext) {
		t.Fatalf("pre-grant retrieve: %v", err)
	}
	if len(service.grants) != 0 || len(service.redemptions) != 0 {
		t.Fatal("blob retrieval modified grants")
	}
	if _, _, permits := service.admission.Counts(); permits != 0 {
		t.Fatal("blob retrieval issued a Circuit permit")
	}
	repository.enrollment.Generation++
	if _, err := service.RetrieveBootstrapBlob(context.Background(), request); !errors.Is(err, bootstrapblob.ErrUnavailable) {
		t.Fatalf("stale generation: %v", err)
	}
	if _, err := service.PublishBootstrapBlob(context.Background(), identity, message); !errors.Is(err, ErrCredentialInvalid) {
		t.Fatalf("stale publication: %v", err)
	}
	repository.enrollment.Generation = 9
	repository.enrollment.Status = domain.EnrollmentStatusRevoked
	if _, err := service.RetrieveBootstrapBlob(context.Background(), request); !errors.Is(err, bootstrapblob.ErrUnavailable) {
		t.Fatalf("revoked: %v", err)
	}
}
