package application

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	defaultMountCredentialTTL  = 15 * time.Minute
	maxStationIdentityLifetime = time.Minute
	stationIdentityClockSkew   = time.Minute
)

var ErrInvalidCredential = errors.New("invalid relay credential")

type credentialClaims struct {
	CredentialType string   `json:"type"`
	StationPeerID  string   `json:"station_peer_id"`
	MountID        uint64   `json:"mount_id"`
	Generation     uint64   `json:"generation"`
	Scopes         []string `json:"scope"`
	jwt.RegisteredClaims
}

type CredentialAuthority struct {
	privateKey  ed25519.PrivateKey
	publicKey   ed25519.PublicKey
	relayPeerID string
	inviteKey   []byte
	now         func() time.Time
}

func NewCredentialAuthority(signingMaterial []byte) (*CredentialAuthority, error) {
	privateKey, err := parseEd25519PrivateKey(signingMaterial)
	if err != nil {
		return nil, err
	}
	publicKey := privateKey.Public().(ed25519.PublicKey)
	libp2pPublicKey, err := libp2pcrypto.UnmarshalEd25519PublicKey(publicKey)
	if err != nil {
		return nil, fmt.Errorf("decode Relay signing public key: %w", err)
	}
	relayPeerID, err := peer.IDFromPublicKey(libp2pPublicKey)
	if err != nil {
		return nil, fmt.Errorf("derive Relay peer ID: %w", err)
	}
	inviteKey := hmac.New(sha256.New, privateKey.Seed())
	_, _ = inviteKey.Write([]byte("peers-touch/relay-invite-digest/v1\x00"))
	_, _ = inviteKey.Write([]byte(relayPeerID.String()))
	return &CredentialAuthority{
		privateKey:  privateKey,
		publicKey:   publicKey,
		relayPeerID: relayPeerID.String(),
		inviteKey:   inviteKey.Sum(nil),
		now:         func() time.Time { return time.Now().UTC() },
	}, nil
}

func (a *CredentialAuthority) RelayPeerID() string {
	return a.relayPeerID
}

func (a *CredentialAuthority) SignEndpointStatement(
	statement []byte,
) ([]byte, []byte, error) {
	if len(statement) == 0 {
		return nil, nil, ErrInvalidCredential
	}
	signature := ed25519.Sign(
		a.privateKey,
		append([]byte(domain.AccessEndpointDomain), statement...),
	)
	libp2pPublicKey, err := libp2pcrypto.UnmarshalEd25519PublicKey(a.publicKey)
	if err != nil {
		return nil, nil, fmt.Errorf("decode Relay endpoint public key: %w", err)
	}
	publicKey, err := libp2pcrypto.MarshalPublicKey(libp2pPublicKey)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal Relay endpoint public key: %w", err)
	}
	return publicKey, signature, nil
}

func (a *CredentialAuthority) DigestInvite(secret string) string {
	mac := hmac.New(sha256.New, a.inviteKey)
	_, _ = mac.Write([]byte(secret))
	return hex.EncodeToString(mac.Sum(nil))
}

func (a *CredentialAuthority) IssueMountCredential(
	mount *domain.Mount,
	jti string,
) (*domain.MountCredential, error) {
	return a.issueCredential(
		mount,
		jti,
		"relay_mount",
		domain.MountCredentialAudience,
		[]string{
			domain.ScopeMountConnect,
			domain.ScopeMountRotate,
			domain.ScopeRoutePublish,
			domain.ScopePeerTunnel,
		},
		defaultMountCredentialTTL,
	)
}

func (a *CredentialAuthority) issueCredential(
	mount *domain.Mount,
	jti string,
	credentialType string,
	audience string,
	scopes []string,
	ttl time.Duration,
) (*domain.MountCredential, error) {
	if mount == nil || mount.ID == 0 || mount.StationPeerID == "" ||
		mount.Generation == 0 || jti == "" {
		return nil, ErrInvalidCredential
	}
	now := a.now()
	expiresAt := now.Add(ttl)
	claims := credentialClaims{
		CredentialType: credentialType,
		StationPeerID:  mount.StationPeerID,
		MountID:        mount.ID,
		Generation:     mount.Generation,
		Scopes:         append([]string(nil), scopes...),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    a.relayPeerID,
			Subject:   subjectForCredential(credentialType, mount.StationPeerID),
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        jti,
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).
		SignedString(a.privateKey)
	if err != nil {
		return nil, fmt.Errorf("sign Relay credential: %w", err)
	}
	return &domain.MountCredential{
		Token:         signed,
		RelayPeerID:   a.relayPeerID,
		StationPeerID: mount.StationPeerID,
		MountID:       mount.ID,
		Generation:    mount.Generation,
		JTI:           jti,
		ExpiresAt:     expiresAt,
	}, nil
}

func (a *CredentialAuthority) ValidateCredential(
	rawToken string,
	audience string,
	requiredScope string,
) (domain.MountIdentity, error) {
	claims := &credentialClaims{}
	token, err := jwt.ParseWithClaims(
		strings.TrimSpace(rawToken),
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodEdDSA {
				return nil, ErrInvalidCredential
			}
			return a.publicKey, nil
		},
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithIssuer(a.relayPeerID),
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
	)
	if err != nil || !token.Valid ||
		claims.ID == "" ||
		claims.StationPeerID == "" ||
		claims.MountID == 0 ||
		claims.Generation == 0 ||
		claims.Subject != subjectForCredential(
			claims.CredentialType,
			claims.StationPeerID,
		) ||
		!containsScope(claims.Scopes, requiredScope) {
		return domain.MountIdentity{}, ErrInvalidCredential
	}
	return domain.MountIdentity{
		RelayPeerID:   a.relayPeerID,
		StationPeerID: claims.StationPeerID,
		MountID:       claims.MountID,
		Generation:    claims.Generation,
		JTI:           claims.ID,
		Scopes:        append([]string(nil), claims.Scopes...),
		ExpiresAt:     claims.ExpiresAt.Time,
	}, nil
}

func VerifyStationIdentityProof(
	proof domain.StationIdentityProof,
	expectedChallenge []byte,
	now time.Time,
) (string, []byte, error) {
	if len(expectedChallenge) != domain.EnrollmentChallengeByteSize {
		return "", nil, fmt.Errorf("expected challenge is invalid")
	}
	statement := &peerpb.StationIdentityStatement{}
	if err := proto.Unmarshal(proof.Statement, statement); err != nil {
		return "", nil, fmt.Errorf("decode Station identity statement: %w", err)
	}
	if !bytes.Equal(statement.GetChallenge(), expectedChallenge) {
		return "", nil, fmt.Errorf("Station identity challenge mismatch")
	}
	if strings.TrimSpace(statement.GetCanonicalOrigin()) == "" {
		return "", nil, fmt.Errorf("Station canonical origin is missing")
	}
	nowMillis := now.UnixMilli()
	if statement.GetExpiresAtUnixMs() <= statement.GetIssuedAtUnixMs() ||
		statement.GetExpiresAtUnixMs()-statement.GetIssuedAtUnixMs() >
			maxStationIdentityLifetime.Milliseconds() ||
		statement.GetIssuedAtUnixMs() >
			nowMillis+stationIdentityClockSkew.Milliseconds() ||
		statement.GetExpiresAtUnixMs() <
			nowMillis-stationIdentityClockSkew.Milliseconds() {
		return "", nil, fmt.Errorf("Station identity validity window is invalid")
	}
	if !containsScope(statement.GetCapabilities(), "station-identity") {
		return "", nil, fmt.Errorf("Station identity capability is missing")
	}
	if !sort.StringsAreSorted(statement.GetCapabilities()) ||
		hasDuplicateStrings(statement.GetCapabilities()) {
		return "", nil, fmt.Errorf("Station identity capabilities are not canonical")
	}

	publicKey, err := libp2pcrypto.UnmarshalPublicKey(proof.HostPublicKey)
	if err != nil {
		return "", nil, fmt.Errorf("decode Station host public key: %w", err)
	}
	if publicKey.Type() != libp2pcrypto.Ed25519 {
		return "", nil, fmt.Errorf("Station host key must be Ed25519")
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		return "", nil, fmt.Errorf("derive Station peer ID: %w", err)
	}
	if statement.GetStationPeerId() != stationPeerID.String() {
		return "", nil, fmt.Errorf("Station peer ID does not match host key")
	}
	signingBytes := append([]byte(domain.StationIdentityDomain), proof.Statement...)
	verified, err := publicKey.Verify(signingBytes, proof.Signature)
	if err != nil || !verified {
		return "", nil, fmt.Errorf("Station identity signature is invalid")
	}
	return stationPeerID.String(), append([]byte(nil), proof.HostPublicKey...), nil
}

func randomIdentifier(size int) (string, error) {
	value, err := randomBytes(size)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func randomBytes(size int) ([]byte, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return nil, err
	}
	return value, nil
}

func parseEd25519PrivateKey(material []byte) (ed25519.PrivateKey, error) {
	trimmed := bytes.TrimSpace(material)
	if block, _ := pem.Decode(trimmed); block != nil {
		parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse Relay signing key: %w", err)
		}
		privateKey, ok := parsed.(ed25519.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("Relay signing key must be Ed25519")
		}
		return append(ed25519.PrivateKey(nil), privateKey...), nil
	}
	if decoded, err := hex.DecodeString(string(trimmed)); err == nil &&
		(len(decoded) == ed25519.SeedSize ||
			len(decoded) == ed25519.PrivateKeySize) {
		trimmed = decoded
	}
	switch len(trimmed) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(trimmed), nil
	case ed25519.PrivateKeySize:
		return ed25519.NewKeyFromSeed(trimmed[:ed25519.SeedSize]), nil
	default:
		if len(trimmed) < 32 {
			return nil, fmt.Errorf("Relay signing key must contain at least 32 bytes")
		}
		seed := sha256.Sum256(trimmed)
		return ed25519.NewKeyFromSeed(seed[:]), nil
	}
}

func subjectForCredential(credentialType, stationPeerID string) string {
	_ = credentialType
	return domain.SubjectRelayAccess + stationPeerID
}

func containsScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}

func hasDuplicateStrings(values []string) bool {
	for index := 1; index < len(values); index++ {
		if values[index-1] == values[index] {
			return true
		}
	}
	return false
}
