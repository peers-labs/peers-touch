package application

import (
	"context"
	"testing"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type manifestServiceRepository struct {
	cached []*chat.FederatedEndpointManifest
	err    error
}

func (r manifestServiceRepository) BuildLocalManifestSnapshot(
	context.Context,
	string,
	string,
	time.Time,
) (*chat.FederatedEndpointManifest, error) {
	return nil, messaging.ErrNotFound
}

func (r manifestServiceRepository) SaveVerifiedManifest(
	context.Context,
	*chat.FederatedEndpointManifest,
	[]byte,
	[]byte,
) error {
	return nil
}

func (r manifestServiceRepository) ListVerifiedManifests(
	context.Context,
	[]string,
	time.Time,
) ([]*chat.FederatedEndpointManifest, error) {
	return r.cached, r.err
}

func (r manifestServiceRepository) HomeStationForEndpoint(
	context.Context,
	*chat.CryptoEndpoint,
	time.Time,
) (string, error) {
	return "", messaging.ErrNotFound
}

type manifestServiceDevices struct {
	homeStationID string
}

func (d manifestServiceDevices) IsActive(
	context.Context,
	*chat.CryptoEndpoint,
) (bool, error) {
	return true, nil
}

func (d manifestServiceDevices) ActorIdentityPublicKey(
	context.Context,
	string,
) ([]byte, error) {
	return nil, nil
}

func (d manifestServiceDevices) ActorHomeStationID(
	context.Context,
	string,
) (string, error) {
	return d.homeStationID, nil
}

func (d manifestServiceDevices) HomeStationID(
	context.Context,
	*chat.CryptoEndpoint,
) (string, error) {
	return d.homeStationID, nil
}

func (d manifestServiceDevices) ListActiveEndpoints(
	context.Context,
	string,
) ([]*chat.CryptoEndpoint, error) {
	return nil, nil
}

type manifestServiceSigner struct{}

func (manifestServiceSigner) SignEndpointManifest(
	context.Context,
	*chat.FederatedEndpointManifest,
) error {
	return nil
}

type manifestServiceRemote struct {
	manifest *chat.FederatedEndpointManifest
	calls    int
}

func (r *manifestServiceRemote) FetchEndpointManifest(
	context.Context,
	string,
	string,
) (*chat.FederatedEndpointManifest, error) {
	r.calls++
	return r.manifest, nil
}

func TestEndpointManifestServiceUsesValidRemoteCacheWithoutNetwork(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	cached := &chat.FederatedEndpointManifest{
		ActorPtid:     "ptid:bob",
		HomeStationId: "station-b",
	}
	remote := &manifestServiceRemote{}
	service, err := NewEndpointManifestService(
		manifestServiceRepository{cached: []*chat.FederatedEndpointManifest{cached}},
		manifestServiceDevices{homeStationID: "station-b"},
		manifestServiceSigner{},
		remote,
		"station-a",
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}

	resolved, err := service.ResolveEndpointManifest(context.Background(), "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != cached || remote.calls != 0 {
		t.Fatalf("resolved=%p cached=%p remote_calls=%d", resolved, cached, remote.calls)
	}
}

func TestEndpointManifestServiceFetchesRemoteAfterCacheExpiry(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	fetched := &chat.FederatedEndpointManifest{
		ActorPtid:     "ptid:bob",
		HomeStationId: "station-b",
	}
	remote := &manifestServiceRemote{manifest: fetched}
	service, err := NewEndpointManifestService(
		manifestServiceRepository{err: messaging.ErrEndpointManifestExpired},
		manifestServiceDevices{homeStationID: "station-b"},
		manifestServiceSigner{},
		remote,
		"station-a",
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}

	resolved, err := service.ResolveEndpointManifest(context.Background(), "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != fetched || remote.calls != 1 {
		t.Fatalf("resolved=%p fetched=%p remote_calls=%d", resolved, fetched, remote.calls)
	}
}
