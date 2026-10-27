package application

import (
	"bytes"
	"context"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func (s *Service) PublishBootstrapBlob(
	ctx context.Context, identity domain.NodeIdentity, request *peerpb.PublishBootstrapBlobRequest,
) (*peerpb.PublishBootstrapBlobResponse, error) {
	// Serialize enrollment/revocation with publication and retrieval. A stale
	// generation cannot publish after the replacement becomes authoritative.
	s.enrollmentMu.Lock()
	defer s.enrollmentMu.Unlock()
	enrollment, err := s.authenticateNodeIdentity(ctx, identity)
	if err != nil {
		return nil, err
	}
	verified, err := peerpb.VerifyBootstrapBlob(request, s.now())
	if err != nil {
		return nil, err
	}
	auth := verified.Authorization.Statement
	if auth.GetStationPeerId() != identity.StationPeerID || auth.GetNodePeerId() != identity.NodePeerID ||
		!bytes.Equal(request.GetNodeAuthorization().GetStationRootPublicKey(), enrollment.StationRootPublicKey) ||
		auth.GetAuthorizationEpoch() != enrollment.NodeAuthorizationEpoch {
		return nil, ErrStationMismatch
	}
	return s.bootstrapBlobs.Publish(request, s.authority.RelayPeerID(), enrollment.Generation, s.now())
}

func (s *Service) RetrieveBootstrapBlob(
	ctx context.Context, request *peerpb.RetrieveBootstrapBlobRequest,
) (*peerpb.RetrieveBootstrapBlobResponse, error) {
	s.enrollmentMu.Lock()
	defer s.enrollmentMu.Unlock()
	return s.bootstrapBlobs.Retrieve(ctx, request, s.authority.RelayPeerID(), s.now(),
		func(ctx context.Context, blob *peerpb.VerifiedBootstrapBlob, generation uint64) bool {
			auth := blob.Authorization.Statement
			enrollment, err := s.repo.GetEnrollment(ctx, auth.GetStationPeerId(), auth.GetNodePeerId())
			root, keyErr := libp2pcrypto.MarshalPublicKey(blob.Authorization.StationRootPublicKey)
			return err == nil && keyErr == nil && enrollment.Status != domain.EnrollmentStatusRevoked &&
				enrollment.Generation == generation && enrollment.NodeAuthorizationUntil.After(s.now()) &&
				enrollment.NodeAuthorizationEpoch == auth.GetAuthorizationEpoch() &&
				bytes.Equal(enrollment.StationRootPublicKey, root)
		},
	)
}

func (s *Service) ClearBootstrapBlobs() { s.bootstrapBlobs.Clear() }
