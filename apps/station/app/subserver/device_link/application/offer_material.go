package application

import (
	"bytes"
	"context"

	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func (s *Service) buildOffer(sc *scope, request *pb.CreateDeviceLinkRequest, bundle *NetworkBundle) error {
	nonce, err := link.Random(32)
	if err != nil {
		return err
	}
	scan := link.Capability(sc.key.Material, "scan", sc.offer.ID)
	statement := &pb.DeviceLinkOfferStatement{
		ProtocolVersion: 1, OfferId: sc.offer.ID, OfferNonce: nonce, StationPeerId: bundle.StationPeerID,
		StationRootPublicKey: bundle.Root, Actor: request.GetDesktopCertificate().GetDevice().GetActor(),
		DesktopDeviceId: sc.offer.DesktopDeviceID, ActorIdentityPublicKey: sc.identity.PublicKey,
		ActorIdentityKeyFingerprint: sc.identity.Fingerprint, DesktopHpkePublicKey: request.GetDesktopHpkePublicKey(),
		IssuedAtUnixMs: sc.now.UnixMilli(), ExpiresAtUnixMs: sc.offer.ExpiresAt.UnixMilli(),
		Connections: bundle.Connections, ScanCapability: scan, CryptoRevision: 1,
		DesktopCertificate: request.GetDesktopCertificate(), DesktopActorCrossSignature: request.GetDesktopActorCrossSignature(),
	}
	raw, err := link.Encode(statement)
	if err != nil {
		return err
	}
	signature, authority, err := s.Network.SignNetworkMaterial(sc.tx.Statement.Context, link.OfferDomain, raw)
	if err != nil {
		return err
	}
	verified, err := peerpb.VerifyStationNodeAuthorization(authority, sc.now)
	if err != nil || verified.Statement.GetStationPeerId() != bundle.StationPeerID ||
		!bytes.Equal(authority.GetStationRootPublicKey(), bundle.Root) ||
		verified.Statement.GetExpiresAtUnixMs() < sc.offer.ExpiresAt.UnixMilli() {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_STATION_ROOT_MISMATCH)
	}
	offer := &pb.SignedDeviceLinkOffer{StatementBytes: raw, NodeSignature: signature, NodeAuthorization: authority}
	signed, err := link.Encode(offer)
	if err != nil {
		return err
	}
	sc.offer.ScanCapabilityHash = link.Digest(scan)
	statement.ScanCapability = nil
	offer.StatementBytes, err = link.Encode(statement)
	if err != nil {
		return err
	}
	sc.offer.RedactedOffer, err = link.Encode(offer)
	if err != nil || bundle.Retrieval == nil {
		return err
	}
	key := link.Capability(sc.key.Material, "unseal", sc.offer.ID)
	sealed, err := infrastructure.SealOffer(key, signed)
	if err != nil {
		return err
	}
	locator := link.Capability(sc.key.Material, "locator", sc.offer.ID)
	template := &pb.DeviceLinkLocator{
		ProtocolVersion: 1, StationPeerId: bundle.StationPeerID, StationRootPublicKey: bundle.Root,
		OfferDigest: link.Digest(signed), RetrievalEndpoint: bundle.Retrieval,
		DesktopHpkePublicKey: request.GetDesktopHpkePublicKey(), ExpiresAtUnixMs: sc.offer.ExpiresAt.UnixMilli(),
	}
	sc.offer.LocatorTemplate, err = link.Encode(template)
	if err != nil {
		return err
	}
	blob := &peerpb.BootstrapBlobStatement{
		ProtocolVersion: 1, LocatorDigest: link.Digest(locator), BlobDigest: link.Digest(sealed),
		StationPeerId: bundle.StationPeerID, RetrievalEndpointIdentity: bundle.Retrieval.GetExpectedEndpointIdentity(),
		IssuedAtUnixMs: sc.now.UnixMilli(), ExpiresAtUnixMs: sc.offer.ExpiresAt.UnixMilli(), MaxSources: link.MaxClaims,
	}
	blobBytes, err := link.Encode(blob)
	if err != nil {
		return err
	}
	signature, authority, err = s.Network.SignNetworkMaterial(sc.tx.Statement.Context, peerpb.BootstrapBlobDomain, blobBytes)
	if err != nil {
		return err
	}
	sc.offer.BootstrapPublication, err = link.Encode(&peerpb.PublishBootstrapBlobRequest{
		StatementBytes: blobBytes, SealedBlob: sealed, NodeSignature: signature, NodeAuthorization: authority,
	})
	return err
}

func (s *Service) createResponse(sc *scope) (*pb.CreateDeviceLinkResponse, *peerpb.PublishBootstrapBlobRequest, error) {
	offer, err := s.signedOffer(sc)
	if err != nil {
		return nil, nil, err
	}
	response := &pb.CreateDeviceLinkResponse{Offer: offer, Revision: sc.offer.Revision}
	if len(sc.offer.LocatorTemplate) == 0 {
		return response, nil, nil
	}
	locator := &pb.DeviceLinkLocator{}
	if err := link.Decode(sc.offer.LocatorTemplate, locator); err != nil {
		return nil, nil, err
	}
	locator.Locator = link.Capability(sc.key.Material, "locator", sc.offer.ID)
	locator.UnsealingKey = link.Capability(sc.key.Material, "unseal", sc.offer.ID)
	response.Locator = locator
	publication := &peerpb.PublishBootstrapBlobRequest{}
	if err := link.Decode(sc.offer.BootstrapPublication, publication); err != nil {
		return nil, nil, err
	}
	return response, publication, nil
}

// Republish restores connectivity-only volatile hosting after a Node restart.
// The ciphertext and its publication identity remain byte-for-byte immutable.
func (s *Service) Republish(ctx context.Context) error {
	database, err := s.Database(ctx)
	if err != nil {
		return err
	}
	var publications [][]byte
	if err := database.WithContext(ctx).Model(&offerPublication{}).
		Where("live_actor IS NOT NULL AND expires_at > ? AND bootstrap_publication IS NOT NULL", s.Clock()).
		Limit(256).Pluck("bootstrap_publication", &publications).Error; err != nil {
		return err
	}
	for _, raw := range publications {
		request := &peerpb.PublishBootstrapBlobRequest{}
		if err := link.Decode(raw, request); err != nil {
			return err
		}
		if err := s.Network.Publish(ctx, request); err != nil {
			return err
		}
	}
	return nil
}

type offerPublication struct{}

func (offerPublication) TableName() string { return "device_link_offers" }
