package relay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/bootstrapblob"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

// Public TLS trust comes from the verified grant-registration connection.
// No operator invitation or enrollment credential is exported.
func targetBootstrapEndpoint(target Target, verifiedTLS *tls.ConnectionState, issued, expires time.Time) (*peerpb.PublicEndpointConnectionMaterial, error) {
	if !strings.HasPrefix(target.ControlOrigin, "https://") {
		return nil, nil // plaintext discovery cannot retrieve possession secrets
	}
	material := &peerpb.PublicEndpointConnectionMaterial{
		SchemaVersion: 1, CanonicalDiscoveryOrigin: target.ControlOrigin,
		ExpectedEndpointRole:     peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		ExpectedEndpointIdentity: target.RelayPeerID.String(),
		IssuedAtUnixMs:           issued.UnixMilli(), ExpiresAtUnixMs: expires.UnixMilli(),
	}
	if target.TLSCAFile != "" {
		if verifiedTLS == nil || !verifiedTLS.HandshakeComplete ||
			len(verifiedTLS.VerifiedChains) == 0 || len(verifiedTLS.PeerCertificates) == 0 {
			return nil, ErrConnectionMaterialUnavailable
		}
		digest := sha256.Sum256(verifiedTLS.PeerCertificates[0].RawSubjectPublicKeyInfo)
		material.EndpointTlsTrust = &peerpb.EndpointTlsTrust{
			Trust: &peerpb.EndpointTlsTrust_LeafSpkiSha256{LeafSpkiSha256: digest[:]},
		}
	}
	if _, err := peerpb.VerifyPublicEndpointConnectionMaterial(material, true, issued); err != nil {
		return nil, ErrConnectionMaterialUnavailable
	}
	return material, nil
}

func (c *StationControl) PublishBootstrapBlob(
	ctx context.Context, request *peerpb.PublishBootstrapBlobRequest,
) (*peerpb.PublishBootstrapBlobResponse, error) {
	if c == nil {
		return nil, bootstrapblob.ErrUnavailable
	}
	verified, err := peerpb.VerifyBootstrapBlob(request, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	relayID, err := peer.Decode(verified.Statement.GetRetrievalEndpointIdentity())
	if err != nil {
		return nil, bootstrapblob.ErrUnavailable
	}
	lock := c.targetOperationLock(relayID)
	lock.Lock()
	defer lock.Unlock()
	c.lock.Lock()
	target, exists := c.targets[relayID]
	c.lock.Unlock()
	if !exists || !strings.HasPrefix(target.ControlOrigin, "https://") {
		return nil, bootstrapblob.ErrUnavailable
	}
	credential, err := c.ensureCredentialLocked(ctx, target)
	if err != nil {
		return nil, err
	}
	if credential.StationPeerID != verified.Statement.GetStationPeerId() ||
		verified.Authorization.Statement.GetNodePeerId() != c.host.ID().String() {
		return nil, peerpb.ErrBootstrapBlobInvalid
	}
	response := &peerpb.PublishBootstrapBlobResponse{}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := c.postProtoLocked(bounded, target, bootstrapblob.PublishPath, credential.Token, request, response); err != nil {
		return nil, err
	}
	if !bytes.Equal(response.GetBlobDigest(), verified.Statement.GetBlobDigest()) ||
		response.GetExpiresAtUnixMs() != verified.Statement.GetExpiresAtUnixMs() {
		return nil, peerpb.ErrBootstrapBlobInvalid
	}
	return response, nil
}
