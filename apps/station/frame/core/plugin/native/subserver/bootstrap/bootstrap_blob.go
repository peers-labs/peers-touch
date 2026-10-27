package bootstrap

import (
	"bytes"
	"context"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/bootstrapblob"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

// SignNetworkMaterial exposes only the delegated Node signer to business
// coordinators. It does not transfer the private key or grant root authority.
func (s *SubServer) SignNetworkMaterial(
	ctx context.Context, domain string, statement []byte,
) ([]byte, *peerpb.StationNodeAuthorization, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if domain != peerpb.BootstrapBlobDomain && domain != "peers-touch/device-link/offer/v1\x00" &&
		domain != "peers-touch/device-link/credential/v1\x00" {
		return nil, nil, peerpb.ErrBootstrapBlobInvalid
	}
	if s.host == nil || len(statement) == 0 || len(statement) > 64*1024 {
		return nil, nil, bootstrapblob.ErrUnavailable
	}
	authorization, err := s.currentNodeAuthorization(time.Now().UTC())
	if err != nil {
		return nil, nil, err
	}
	signature, err := s.host.Peerstore().PrivKey(s.host.ID()).Sign(append([]byte(domain), statement...))
	return signature, authorization, err
}

// PublishBootstrapBlob is an in-process Node Connectivity port, not a public
// Station upload API. Only this Node may publish to its local endpoint.
func (s *SubServer) PublishBootstrapBlob(
	ctx context.Context, request *peerpb.PublishBootstrapBlobRequest,
) (*peerpb.PublishBootstrapBlobResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	verified, err := peerpb.VerifyBootstrapBlob(request, now)
	if err != nil {
		return nil, err
	}
	current, err := s.currentNodeAuthorization(now)
	if err != nil {
		return nil, err
	}
	if s.host == nil || verified.Authorization.Statement.GetNodePeerId() != s.host.ID().String() ||
		!bytes.Equal(current.GetStationRootPublicKey(), request.GetNodeAuthorization().GetStationRootPublicKey()) ||
		!bytes.Equal(current.GetStatementBytes(), request.GetNodeAuthorization().GetStatementBytes()) {
		return nil, peerpb.ErrBootstrapBlobInvalid
	}
	return s.bootstrapBlobs.Publish(request, verified.Statement.GetStationPeerId(), verified.Authorization.Statement.GetAuthorizationEpoch(), now)
}

func (s *SubServer) RetrieveBootstrapBlob(
	ctx context.Context, request *peerpb.RetrieveBootstrapBlobRequest,
) (*peerpb.RetrieveBootstrapBlobResponse, error) {
	now := time.Now().UTC()
	current, err := s.currentNodeAuthorization(now)
	if err != nil {
		return nil, err
	}
	verified, err := peerpb.VerifyStationNodeAuthorization(current, now)
	if err != nil {
		return nil, err
	}
	return s.bootstrapBlobs.Retrieve(ctx, request, verified.Statement.GetStationPeerId(), now,
		func(_ context.Context, blob *peerpb.VerifiedBootstrapBlob, epoch uint64) bool {
			root, keyErr := crypto.MarshalPublicKey(blob.Authorization.StationRootPublicKey)
			return keyErr == nil && epoch == verified.Statement.GetAuthorizationEpoch() &&
				blob.Authorization.Statement.GetNodePeerId() == verified.Statement.GetNodePeerId() &&
				bytes.Equal(root, current.GetStationRootPublicKey())
		},
	)
}
