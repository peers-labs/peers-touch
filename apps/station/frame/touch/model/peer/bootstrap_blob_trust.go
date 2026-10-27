package peer

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	libp2ppeer "github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/protobuf/proto"
)

const (
	BootstrapBlobDomain      = "peers-touch/bootstrap-blob/v1\x00"
	MaxBootstrapBlobBytes    = 16 * 1024
	MaxBootstrapBlobLifetime = 5 * time.Minute
	MaxBootstrapBlobSources  = uint32(4)
)

var ErrBootstrapBlobInvalid = errors.New("bootstrap blob is invalid")

type VerifiedBootstrapBlob struct {
	Statement     *BootstrapBlobStatement
	Authorization *VerifiedStationNodeAuthorization
}

// SignBootstrapBlob authenticates opaque ciphertext, never a business payload.
func SignBootstrapBlob(
	key libp2pcrypto.PrivKey,
	authorization *StationNodeAuthorization,
	statement *BootstrapBlobStatement,
	sealed []byte,
	now time.Time,
) (*PublishBootstrapBlobRequest, error) {
	if key == nil || authorization == nil || statement == nil {
		return nil, ErrBootstrapBlobInvalid
	}
	raw, err := marshalDeterministicBounded(statement)
	if err != nil {
		return nil, ErrBootstrapBlobInvalid
	}
	signature, err := key.Sign(domainMessage(BootstrapBlobDomain, raw))
	if err != nil {
		return nil, ErrBootstrapBlobInvalid
	}
	request := &PublishBootstrapBlobRequest{
		StatementBytes: raw, SealedBlob: append([]byte(nil), sealed...),
		NodeSignature: signature, NodeAuthorization: proto.Clone(authorization).(*StationNodeAuthorization),
	}
	verified, err := VerifyBootstrapBlob(request, now)
	if err != nil {
		return nil, err
	}
	id, err := libp2ppeer.IDFromPrivateKey(key)
	if err != nil || id.String() != verified.Authorization.Statement.GetNodePeerId() {
		return nil, ErrBootstrapBlobInvalid
	}
	return request, nil
}

func VerifyBootstrapBlob(request *PublishBootstrapBlobRequest, now time.Time) (*VerifiedBootstrapBlob, error) {
	if request == nil || len(request.GetSealedBlob()) == 0 ||
		len(request.GetSealedBlob()) > MaxBootstrapBlobBytes ||
		len(request.ProtoReflect().GetUnknown()) != 0 {
		return nil, ErrBootstrapBlobInvalid
	}
	authorization, err := VerifyStationNodeAuthorization(request.GetNodeAuthorization(), now)
	if err != nil || len(request.GetNodeAuthorization().ProtoReflect().GetUnknown()) != 0 ||
		len(authorization.Statement.ProtoReflect().GetUnknown()) != 0 {
		return nil, ErrBootstrapBlobInvalid
	}
	statement := &BootstrapBlobStatement{}
	if err := unmarshalCanonicalBounded(request.GetStatementBytes(), statement); err != nil ||
		len(statement.ProtoReflect().GetUnknown()) != 0 {
		return nil, ErrBootstrapBlobInvalid
	}
	digest := sha256.Sum256(request.GetSealedBlob())
	issued, expires := time.UnixMilli(statement.GetIssuedAtUnixMs()), time.UnixMilli(statement.GetExpiresAtUnixMs())
	endpoint, err := libp2ppeer.Decode(statement.GetRetrievalEndpointIdentity())
	if err != nil || endpoint.String() != statement.GetRetrievalEndpointIdentity() ||
		statement.GetProtocolVersion() != 1 || len(statement.GetLocatorDigest()) != sha256.Size ||
		!bytes.Equal(statement.GetBlobDigest(), digest[:]) ||
		statement.GetStationPeerId() != authorization.Statement.GetStationPeerId() ||
		statement.GetMaxSources() == 0 || statement.GetMaxSources() > MaxBootstrapBlobSources ||
		issued.After(now.Add(stationTrustClockSkew)) || !expires.After(now) ||
		expires.Sub(issued) <= 0 || expires.Sub(issued) > MaxBootstrapBlobLifetime ||
		statement.GetExpiresAtUnixMs() > authorization.Statement.GetExpiresAtUnixMs() {
		return nil, ErrBootstrapBlobInvalid
	}
	valid, err := authorization.NodePublicKey.Verify(
		domainMessage(BootstrapBlobDomain, request.GetStatementBytes()), request.GetNodeSignature(),
	)
	if err != nil || !valid {
		return nil, ErrBootstrapBlobInvalid
	}
	return &VerifiedBootstrapBlob{Statement: statement, Authorization: authorization}, nil
}
