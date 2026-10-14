package peer

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	libp2ppeer "github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/protobuf/proto"
)

const (
	StationNodeAuthorizationDomain  = "peers-touch/station-node-authorization/v1\x00"
	StationIdentityDomain           = "peers-touch/station-identity/v1\x00"
	StationRouteDomain              = "peers-touch/station-route/v1\x00"
	ConnectionGrantDomain           = "peers-touch/station-connection-grant/v1\x00"
	AccessEndpointSourceProofDomain = "peers-touch/access-endpoint-source-proof/v1\x00"

	StationIdentityChallengeSize    = 32
	MaxSignedControlBytes           = 1 << 20
	MaxStationIdentityLifetime      = 5 * time.Minute
	MaxNodeAuthorizationLifetime    = 24 * time.Hour
	MaxRouteAttestationLifetime     = 5 * time.Minute
	MaxConnectionGrantLifetime      = 15 * time.Minute
	MaxConnectionGrantUses          = uint32(32)
	stationTrustClockSkew           = time.Minute
	maxStationCapabilityCount       = 64
	maxStationCapabilityLength      = 128
	stationIdentityResponseLifetime = time.Minute
	defaultNodeAuthorizationEpoch   = uint64(1)
)

var (
	ErrStationNodeAuthorizationInvalid  = errors.New("Station node authorization is invalid")
	ErrStationIdentityInvalid           = errors.New("Station identity is invalid")
	ErrStationRouteAttestationInvalid   = errors.New("Station route attestation is invalid")
	ErrStationConnectionGrantInvalid    = errors.New("Station connection grant is invalid")
	ErrAccessEndpointSourceProofInvalid = errors.New("access endpoint source proof is invalid")
)

type VerifiedStationNodeAuthorization struct {
	Statement            *StationNodeAuthorizationStatement
	StationRootPublicKey libp2pcrypto.PubKey
	NodePublicKey        libp2pcrypto.PubKey
	Digest               [sha256.Size]byte
}

type VerifiedStationIdentity struct {
	Statement     *StationIdentityStatement
	Authorization *VerifiedStationNodeAuthorization
}

func CanonicalStationCapabilities(values []string) ([]string, error) {
	if len(values) == 0 || len(values) > maxStationCapabilityCount {
		return nil, fmt.Errorf("Station capability count is invalid")
	}
	canonical := append([]string(nil), values...)
	sort.Strings(canonical)
	for index, value := range canonical {
		if value == "" ||
			value != strings.TrimSpace(value) ||
			len(value) > maxStationCapabilityLength ||
			(index > 0 && canonical[index-1] == value) {
			return nil, fmt.Errorf("Station capabilities are invalid")
		}
	}
	return canonical, nil
}

func StationCapabilitiesDigest(values []string) ([sha256.Size]byte, error) {
	var zero [sha256.Size]byte
	canonical, err := CanonicalStationCapabilities(values)
	if err != nil {
		return zero, err
	}
	raw, err := marshalDeterministicBounded(
		&StationCapabilitySet{Capabilities: canonical},
	)
	if err != nil {
		return zero, err
	}
	return sha256.Sum256(raw), nil
}

func SignStationNodeAuthorization(
	stationRootPrivateKey libp2pcrypto.PrivKey,
	nodePublicKey libp2pcrypto.PubKey,
	authorizationEpoch uint64,
	capabilities []string,
	issuedAt time.Time,
	expiresAt time.Time,
) (*StationNodeAuthorization, error) {
	if stationRootPrivateKey == nil ||
		stationRootPrivateKey.Type() != libp2pcrypto.Ed25519 ||
		nodePublicKey == nil ||
		nodePublicKey.Type() != libp2pcrypto.Ed25519 {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	stationPeerID, err := libp2ppeer.IDFromPrivateKey(stationRootPrivateKey)
	if err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	nodePeerID, err := libp2ppeer.IDFromPublicKey(nodePublicKey)
	if err != nil || nodePeerID == stationPeerID {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	nodePublicKeyBytes, err := libp2pcrypto.MarshalPublicKey(nodePublicKey)
	if err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	capabilitiesDigest, err := StationCapabilitiesDigest(capabilities)
	if err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	statement := &StationNodeAuthorizationStatement{
		StationPeerId:      stationPeerID.String(),
		NodePeerId:         nodePeerID.String(),
		NodePublicKey:      nodePublicKeyBytes,
		AuthorizationEpoch: authorizationEpoch,
		CapabilitiesDigest: capabilitiesDigest[:],
		IssuedAtUnixMs:     issuedAt.UTC().UnixMilli(),
		ExpiresAtUnixMs:    expiresAt.UTC().UnixMilli(),
	}
	if !validAuthorizationTimes(statement, issuedAt.UTC()) {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	statementBytes, err := marshalDeterministicBounded(statement)
	if err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	rootSignature, err := stationRootPrivateKey.Sign(
		domainMessage(StationNodeAuthorizationDomain, statementBytes),
	)
	if err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	rootPublicKey, err := libp2pcrypto.MarshalPublicKey(
		stationRootPrivateKey.GetPublic(),
	)
	if err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	return &StationNodeAuthorization{
		StatementBytes:       statementBytes,
		StationRootPublicKey: rootPublicKey,
		RootSignature:        rootSignature,
	}, nil
}

func SignDefaultStationNodeAuthorization(
	stationRootPrivateKey libp2pcrypto.PrivKey,
	nodePublicKey libp2pcrypto.PubKey,
	capabilities []string,
	now time.Time,
) (*StationNodeAuthorization, error) {
	return SignStationNodeAuthorization(
		stationRootPrivateKey,
		nodePublicKey,
		defaultNodeAuthorizationEpoch,
		capabilities,
		now,
		now.Add(MaxNodeAuthorizationLifetime),
	)
}

func VerifyStationNodeAuthorization(
	authorization *StationNodeAuthorization,
	now time.Time,
) (*VerifiedStationNodeAuthorization, error) {
	if authorization == nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	if raw, err := marshalDeterministicBounded(authorization); err != nil ||
		len(raw) > MaxSignedControlBytes {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	statement := &StationNodeAuthorizationStatement{}
	if err := unmarshalCanonicalBounded(
		authorization.GetStatementBytes(),
		statement,
	); err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	if !validAuthorizationTimes(statement, now.UTC()) ||
		len(statement.GetCapabilitiesDigest()) != sha256.Size {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	rootPublicKey, err := libp2pcrypto.UnmarshalPublicKey(
		authorization.GetStationRootPublicKey(),
	)
	if err != nil || rootPublicKey.Type() != libp2pcrypto.Ed25519 {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	stationPeerID, err := libp2ppeer.IDFromPublicKey(rootPublicKey)
	if err != nil || stationPeerID.String() != statement.GetStationPeerId() {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	nodePublicKey, err := libp2pcrypto.UnmarshalPublicKey(
		statement.GetNodePublicKey(),
	)
	if err != nil || nodePublicKey.Type() != libp2pcrypto.Ed25519 {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	nodePeerID, err := libp2ppeer.IDFromPublicKey(nodePublicKey)
	if err != nil ||
		nodePeerID.String() != statement.GetNodePeerId() ||
		nodePeerID == stationPeerID {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	valid, err := rootPublicKey.Verify(
		domainMessage(
			StationNodeAuthorizationDomain,
			authorization.GetStatementBytes(),
		),
		authorization.GetRootSignature(),
	)
	if err != nil || !valid {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	raw, err := marshalDeterministicBounded(authorization)
	if err != nil {
		return nil, ErrStationNodeAuthorizationInvalid
	}
	return &VerifiedStationNodeAuthorization{
		Statement:            statement,
		StationRootPublicKey: rootPublicKey,
		NodePublicKey:        nodePublicKey,
		Digest:               sha256.Sum256(raw),
	}, nil
}

func SignStationIdentityResponse(
	nodePrivateKey libp2pcrypto.PrivKey,
	authorization *StationNodeAuthorization,
	canonicalOrigin string,
	challenge []byte,
	capabilities []string,
	now time.Time,
) (*StationIdentityResponse, error) {
	verified, err := VerifyStationNodeAuthorization(authorization, now)
	if err != nil ||
		nodePrivateKey == nil ||
		nodePrivateKey.Type() != libp2pcrypto.Ed25519 ||
		len(challenge) != StationIdentityChallengeSize ||
		canonicalOrigin == "" {
		return nil, ErrStationIdentityInvalid
	}
	nodePeerID, err := libp2ppeer.IDFromPrivateKey(nodePrivateKey)
	if err != nil || nodePeerID.String() != verified.Statement.GetNodePeerId() {
		return nil, ErrStationIdentityInvalid
	}
	canonicalCapabilities, err := CanonicalStationCapabilities(capabilities)
	if err != nil {
		return nil, ErrStationIdentityInvalid
	}
	capabilitiesDigest, err := StationCapabilitiesDigest(canonicalCapabilities)
	if err != nil ||
		!bytes.Equal(
			capabilitiesDigest[:],
			verified.Statement.GetCapabilitiesDigest(),
		) {
		return nil, ErrStationIdentityInvalid
	}
	statement := &StationIdentityStatement{
		Challenge:               append([]byte(nil), challenge...),
		StationPeerId:           verified.Statement.GetStationPeerId(),
		CanonicalOrigin:         canonicalOrigin,
		Capabilities:            canonicalCapabilities,
		IssuedAtUnixMs:          now.UTC().UnixMilli(),
		ExpiresAtUnixMs:         now.UTC().Add(stationIdentityResponseLifetime).UnixMilli(),
		NodeAuthorizationDigest: verified.Digest[:],
	}
	statementBytes, err := marshalDeterministicBounded(statement)
	if err != nil {
		return nil, ErrStationIdentityInvalid
	}
	nodeSignature, err := nodePrivateKey.Sign(
		domainMessage(StationIdentityDomain, statementBytes),
	)
	if err != nil {
		return nil, ErrStationIdentityInvalid
	}
	return &StationIdentityResponse{
		StatementBytes:    statementBytes,
		NodeSignature:     nodeSignature,
		NodeAuthorization: proto.Clone(authorization).(*StationNodeAuthorization),
	}, nil
}

func VerifyStationIdentityResponse(
	response *StationIdentityResponse,
	challenge []byte,
	expectedCanonicalOrigin string,
	requiredCapabilities []string,
	now time.Time,
) (*VerifiedStationIdentity, error) {
	if response == nil || len(challenge) != StationIdentityChallengeSize {
		return nil, ErrStationIdentityInvalid
	}
	if raw, err := marshalDeterministicBounded(response); err != nil ||
		len(raw) > MaxSignedControlBytes {
		return nil, ErrStationIdentityInvalid
	}
	authorization, err := VerifyStationNodeAuthorization(
		response.GetNodeAuthorization(),
		now,
	)
	if err != nil {
		return nil, ErrStationIdentityInvalid
	}
	statement := &StationIdentityStatement{}
	if err := unmarshalCanonicalBounded(
		response.GetStatementBytes(),
		statement,
	); err != nil {
		return nil, ErrStationIdentityInvalid
	}
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	if !bytes.Equal(statement.GetChallenge(), challenge) ||
		statement.GetStationPeerId() !=
			authorization.Statement.GetStationPeerId() ||
		statement.GetCanonicalOrigin() != expectedCanonicalOrigin ||
		issuedAt.After(now.UTC().Add(stationTrustClockSkew)) ||
		!expiresAt.After(now.UTC()) ||
		expiresAt.Sub(issuedAt) <= 0 ||
		expiresAt.Sub(issuedAt) > MaxStationIdentityLifetime ||
		expiresAt.After(
			time.UnixMilli(
				authorization.Statement.GetExpiresAtUnixMs(),
			).UTC(),
		) ||
		!bytes.Equal(
			statement.GetNodeAuthorizationDigest(),
			authorization.Digest[:],
		) {
		return nil, ErrStationIdentityInvalid
	}
	capabilities, err := CanonicalStationCapabilities(
		statement.GetCapabilities(),
	)
	if err != nil || !equalStrings(capabilities, statement.GetCapabilities()) {
		return nil, ErrStationIdentityInvalid
	}
	capabilitiesDigest, err := StationCapabilitiesDigest(capabilities)
	if err != nil ||
		!bytes.Equal(
			capabilitiesDigest[:],
			authorization.Statement.GetCapabilitiesDigest(),
		) {
		return nil, ErrStationIdentityInvalid
	}
	for _, required := range requiredCapabilities {
		index := sort.SearchStrings(capabilities, required)
		if index == len(capabilities) || capabilities[index] != required {
			return nil, ErrStationIdentityInvalid
		}
	}
	valid, err := authorization.NodePublicKey.Verify(
		domainMessage(
			StationIdentityDomain,
			response.GetStatementBytes(),
		),
		response.GetNodeSignature(),
	)
	if err != nil || !valid {
		return nil, ErrStationIdentityInvalid
	}
	return &VerifiedStationIdentity{
		Statement:     statement,
		Authorization: authorization,
	}, nil
}

func StationNodeAuthorizationDigest(
	authorization *StationNodeAuthorization,
) ([sha256.Size]byte, error) {
	var zero [sha256.Size]byte
	if authorization == nil {
		return zero, ErrStationNodeAuthorizationInvalid
	}
	raw, err := marshalDeterministicBounded(authorization)
	if err != nil {
		return zero, ErrStationNodeAuthorizationInvalid
	}
	return sha256.Sum256(raw), nil
}

func validAuthorizationTimes(
	statement *StationNodeAuthorizationStatement,
	now time.Time,
) bool {
	if statement == nil || statement.GetAuthorizationEpoch() == 0 {
		return false
	}
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	return !issuedAt.After(now.Add(stationTrustClockSkew)) &&
		expiresAt.After(now) &&
		expiresAt.Sub(issuedAt) > 0 &&
		expiresAt.Sub(issuedAt) <= MaxNodeAuthorizationLifetime
}

func marshalDeterministicBounded(message proto.Message) ([]byte, error) {
	if message == nil {
		return nil, fmt.Errorf("signed control message is nil")
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw) > MaxSignedControlBytes {
		return nil, fmt.Errorf("signed control message size is invalid")
	}
	return raw, nil
}

func unmarshalCanonicalBounded(raw []byte, message proto.Message) error {
	if len(raw) == 0 || len(raw) > MaxSignedControlBytes {
		return fmt.Errorf("signed statement size is invalid")
	}
	if err := proto.Unmarshal(raw, message); err != nil {
		return err
	}
	canonical, err := marshalDeterministicBounded(message)
	if err != nil || !bytes.Equal(canonical, raw) {
		return fmt.Errorf("signed statement is not canonical")
	}
	return nil
}

func domainMessage(domain string, statement []byte) []byte {
	message := make([]byte, 0, len(domain)+len(statement))
	message = append(message, domain...)
	message = append(message, statement...)
	return message
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
