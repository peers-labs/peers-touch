package peer

import (
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	libp2ppeer "github.com/libp2p/go-libp2p/core/peer"
)

const (
	PublicConnectionMaterialSchemaVersion = uint32(1)
	PublicStationAdvertisementDomain      = "peers-touch/public-station-advertisement/v1\x00"

	MaxPublicConnectionMaterialLifetime   = 7 * 24 * time.Hour
	MaxPublicStationAdvertisementLifetime = 7 * 24 * time.Hour
	MaxPublicDiscoveryOriginBytes         = 512
	MaxPublicDisplayNameBytes             = 128
	MaxEndpointCertificateAuthorityBytes  = 16 * 1024
)

var (
	ErrPublicConnectionMaterialInvalid   = errors.New("public endpoint connection material is invalid")
	ErrPublicStationAdvertisementInvalid = errors.New("public Station advertisement is invalid")
)

type VerifiedEndpointTLSTrust struct {
	CertificateAuthorityDER        []byte
	LeafSPKISHA256                 [sha256.Size]byte
	UsesWebPKI                     bool
	AuthenticatedHTTPBootstrapOnly bool
}

type VerifiedPublicEndpointConnectionMaterial struct {
	CanonicalDiscoveryOrigin string
	ExpectedEndpointRole     AccessEndpointRole
	ExpectedEndpointIdentity libp2ppeer.ID
	StationRootPublicKey     libp2pcrypto.PubKey
	TLSTrust                 VerifiedEndpointTLSTrust
	ExpiresAt                time.Time
}

type VerifiedPublicStationAdvertisement struct {
	Statement *PublicStationAdvertisementStatement
	Material  *VerifiedPublicEndpointConnectionMaterial
}

func VerifyPublicEndpointConnectionMaterialBytes(
	raw []byte,
	sourceAuthenticated bool,
	now time.Time,
) (*VerifiedPublicEndpointConnectionMaterial, error) {
	material := &PublicEndpointConnectionMaterial{}
	if err := unmarshalCanonicalBounded(raw, material); err != nil {
		return nil, ErrPublicConnectionMaterialInvalid
	}
	return VerifyPublicEndpointConnectionMaterial(material, sourceAuthenticated, now)
}

func VerifyPublicEndpointConnectionMaterial(
	material *PublicEndpointConnectionMaterial,
	sourceAuthenticated bool,
	now time.Time,
) (*VerifiedPublicEndpointConnectionMaterial, error) {
	if material == nil ||
		material.GetSchemaVersion() != PublicConnectionMaterialSchemaVersion {
		return nil, ErrPublicConnectionMaterialInvalid
	}
	if raw, err := marshalDeterministicBounded(material); err != nil ||
		len(raw) > MaxSignedControlBytes {
		return nil, ErrPublicConnectionMaterialInvalid
	}
	origin, scheme, err := canonicalPublicDiscoveryOrigin(
		material.GetCanonicalDiscoveryOrigin(),
	)
	if err != nil || (scheme == "http" && !sourceAuthenticated) {
		return nil, ErrPublicConnectionMaterialInvalid
	}
	identity, err := libp2ppeer.Decode(material.GetExpectedEndpointIdentity())
	if err != nil ||
		identity.String() != material.GetExpectedEndpointIdentity() {
		return nil, ErrPublicConnectionMaterialInvalid
	}
	issuedAt := time.UnixMilli(material.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(material.GetExpiresAtUnixMs()).UTC()
	if !validPublicLifetime(
		issuedAt,
		expiresAt,
		now.UTC(),
		MaxPublicConnectionMaterialLifetime,
	) {
		return nil, ErrPublicConnectionMaterialInvalid
	}

	var stationRootPublicKey libp2pcrypto.PubKey
	switch material.GetExpectedEndpointRole() {
	case AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY:
		if len(material.GetExpectedStationRootPublicKey()) != 0 {
			return nil, ErrPublicConnectionMaterialInvalid
		}
	case AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION:
		stationRootPublicKey, err = libp2pcrypto.UnmarshalPublicKey(
			material.GetExpectedStationRootPublicKey(),
		)
		if err != nil || stationRootPublicKey.Type() != libp2pcrypto.Ed25519 {
			return nil, ErrPublicConnectionMaterialInvalid
		}
		stationPeerID, deriveErr := libp2ppeer.IDFromPublicKey(stationRootPublicKey)
		if deriveErr != nil || stationPeerID != identity {
			return nil, ErrPublicConnectionMaterialInvalid
		}
	default:
		return nil, ErrPublicConnectionMaterialInvalid
	}

	tlsTrust, err := verifyEndpointTLSTrust(
		material.GetEndpointTlsTrust(),
		scheme,
	)
	if err != nil {
		return nil, ErrPublicConnectionMaterialInvalid
	}
	return &VerifiedPublicEndpointConnectionMaterial{
		CanonicalDiscoveryOrigin: origin,
		ExpectedEndpointRole:     material.GetExpectedEndpointRole(),
		ExpectedEndpointIdentity: identity,
		StationRootPublicKey:     stationRootPublicKey,
		TLSTrust:                 tlsTrust,
		ExpiresAt:                expiresAt,
	}, nil
}

func PublicEndpointConnectionMaterialDigest(
	material *PublicEndpointConnectionMaterial,
) ([sha256.Size]byte, error) {
	var zero [sha256.Size]byte
	raw, err := marshalDeterministicBounded(material)
	if err != nil {
		return zero, ErrPublicConnectionMaterialInvalid
	}
	return sha256.Sum256(raw), nil
}

func SignPublicStationAdvertisement(
	stationRootPrivateKey libp2pcrypto.PrivKey,
	material *PublicEndpointConnectionMaterial,
	displayName string,
	advertisementSequence uint64,
	issuedAt time.Time,
	expiresAt time.Time,
) (*SignedPublicStationAdvertisement, error) {
	verifiedMaterial, err := VerifyPublicEndpointConnectionMaterial(
		material,
		true,
		issuedAt,
	)
	if err != nil ||
		stationRootPrivateKey == nil ||
		stationRootPrivateKey.Type() != libp2pcrypto.Ed25519 ||
		verifiedMaterial.ExpectedEndpointRole !=
			AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION ||
		advertisementSequence == 0 ||
		!validPublicDisplayName(displayName) {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	rootPublicKey := stationRootPrivateKey.GetPublic()
	rootPeerID, err := libp2ppeer.IDFromPublicKey(rootPublicKey)
	if err != nil ||
		rootPeerID != verifiedMaterial.ExpectedEndpointIdentity ||
		!rootPublicKey.Equals(verifiedMaterial.StationRootPublicKey) {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	materialIssuedAt := time.UnixMilli(material.GetIssuedAtUnixMs()).UTC()
	if issuedAt.UTC().Before(materialIssuedAt) ||
		expiresAt.UTC().After(verifiedMaterial.ExpiresAt) ||
		!validPublicLifetime(
			issuedAt.UTC(),
			expiresAt.UTC(),
			issuedAt.UTC(),
			MaxPublicStationAdvertisementLifetime,
		) {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	materialDigest, err := PublicEndpointConnectionMaterialDigest(material)
	if err != nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	rootPublicKeyBytes, err := libp2pcrypto.MarshalPublicKey(rootPublicKey)
	if err != nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	statement := &PublicStationAdvertisementStatement{
		SchemaVersion:            PublicConnectionMaterialSchemaVersion,
		StationPeerId:            rootPeerID.String(),
		StationRootPublicKey:     rootPublicKeyBytes,
		ConnectionMaterialDigest: materialDigest[:],
		PublicDiscoveryConsent:   true,
		AdvertisementSequence:    advertisementSequence,
		CanonicalDiscoveryOrigin: verifiedMaterial.CanonicalDiscoveryOrigin,
		DisplayName:              displayName,
		Visibility:               StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
		IssuedAtUnixMs:           issuedAt.UTC().UnixMilli(),
		ExpiresAtUnixMs:          expiresAt.UTC().UnixMilli(),
	}
	statementBytes, err := marshalDeterministicBounded(statement)
	if err != nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	signature, err := stationRootPrivateKey.Sign(
		domainMessage(PublicStationAdvertisementDomain, statementBytes),
	)
	if err != nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	return &SignedPublicStationAdvertisement{
		StatementBytes:       statementBytes,
		StationRootSignature: signature,
	}, nil
}

func VerifyPublicStationAdvertisementBytes(
	raw []byte,
	material *PublicEndpointConnectionMaterial,
	now time.Time,
) (*VerifiedPublicStationAdvertisement, error) {
	advertisement := &SignedPublicStationAdvertisement{}
	if err := unmarshalCanonicalBounded(raw, advertisement); err != nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	return VerifyPublicStationAdvertisement(advertisement, material, now)
}

func VerifyPublicStationAdvertisement(
	advertisement *SignedPublicStationAdvertisement,
	material *PublicEndpointConnectionMaterial,
	now time.Time,
) (*VerifiedPublicStationAdvertisement, error) {
	if advertisement == nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	if raw, err := marshalDeterministicBounded(advertisement); err != nil ||
		len(raw) > MaxSignedControlBytes {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	verifiedMaterial, err := VerifyPublicEndpointConnectionMaterial(
		material,
		true,
		now,
	)
	if err != nil ||
		verifiedMaterial.ExpectedEndpointRole !=
			AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	statement := &PublicStationAdvertisementStatement{}
	if err := unmarshalCanonicalBounded(
		advertisement.GetStatementBytes(),
		statement,
	); err != nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	materialDigest, err := PublicEndpointConnectionMaterialDigest(material)
	if err != nil {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	issuedAt := time.UnixMilli(statement.GetIssuedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(statement.GetExpiresAtUnixMs()).UTC()
	materialIssuedAt := time.UnixMilli(material.GetIssuedAtUnixMs()).UTC()
	if statement.GetSchemaVersion() != PublicConnectionMaterialSchemaVersion ||
		statement.GetStationPeerId() !=
			verifiedMaterial.ExpectedEndpointIdentity.String() ||
		!bytes.Equal(
			statement.GetStationRootPublicKey(),
			material.GetExpectedStationRootPublicKey(),
		) ||
		!bytes.Equal(statement.GetConnectionMaterialDigest(), materialDigest[:]) ||
		!statement.GetPublicDiscoveryConsent() ||
		statement.GetAdvertisementSequence() == 0 ||
		statement.GetCanonicalDiscoveryOrigin() !=
			verifiedMaterial.CanonicalDiscoveryOrigin ||
		!validPublicDisplayName(statement.GetDisplayName()) ||
		statement.GetVisibility() !=
			StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC ||
		issuedAt.Before(materialIssuedAt) ||
		expiresAt.After(verifiedMaterial.ExpiresAt) ||
		!validPublicLifetime(
			issuedAt,
			expiresAt,
			now.UTC(),
			MaxPublicStationAdvertisementLifetime,
		) {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	valid, err := verifiedMaterial.StationRootPublicKey.Verify(
		domainMessage(
			PublicStationAdvertisementDomain,
			advertisement.GetStatementBytes(),
		),
		advertisement.GetStationRootSignature(),
	)
	if err != nil || !valid {
		return nil, ErrPublicStationAdvertisementInvalid
	}
	return &VerifiedPublicStationAdvertisement{
		Statement: statement,
		Material:  verifiedMaterial,
	}, nil
}

func verifyEndpointTLSTrust(
	trust *EndpointTlsTrust,
	scheme string,
) (VerifiedEndpointTLSTrust, error) {
	if trust == nil || trust.GetTrust() == nil {
		if scheme == "https" {
			return VerifiedEndpointTLSTrust{UsesWebPKI: true}, nil
		}
		return VerifiedEndpointTLSTrust{
			AuthenticatedHTTPBootstrapOnly: true,
		}, nil
	}
	if scheme != "https" {
		return VerifiedEndpointTLSTrust{}, ErrPublicConnectionMaterialInvalid
	}
	switch value := trust.GetTrust().(type) {
	case *EndpointTlsTrust_CertificateAuthorityDer:
		if len(value.CertificateAuthorityDer) == 0 ||
			len(value.CertificateAuthorityDer) >
				MaxEndpointCertificateAuthorityBytes {
			return VerifiedEndpointTLSTrust{}, ErrPublicConnectionMaterialInvalid
		}
		certificate, err := x509.ParseCertificate(value.CertificateAuthorityDer)
		if err != nil || !certificate.BasicConstraintsValid || !certificate.IsCA {
			return VerifiedEndpointTLSTrust{}, ErrPublicConnectionMaterialInvalid
		}
		return VerifiedEndpointTLSTrust{
			CertificateAuthorityDER: append(
				[]byte(nil),
				value.CertificateAuthorityDer...,
			),
		}, nil
	case *EndpointTlsTrust_LeafSpkiSha256:
		if len(value.LeafSpkiSha256) != sha256.Size {
			return VerifiedEndpointTLSTrust{}, ErrPublicConnectionMaterialInvalid
		}
		var digest [sha256.Size]byte
		copy(digest[:], value.LeafSpkiSha256)
		return VerifiedEndpointTLSTrust{LeafSPKISHA256: digest}, nil
	default:
		return VerifiedEndpointTLSTrust{}, ErrPublicConnectionMaterialInvalid
	}
}

func canonicalPublicDiscoveryOrigin(raw string) (string, string, error) {
	if raw == "" ||
		raw != strings.TrimSpace(raw) ||
		len(raw) > MaxPublicDiscoveryOriginBytes {
		return "", "", ErrPublicConnectionMaterialInvalid
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil ||
		parsed.Host == "" ||
		parsed.Path != "" ||
		parsed.RawPath != "" ||
		parsed.RawQuery != "" ||
		parsed.ForceQuery ||
		parsed.Fragment != "" {
		return "", "", ErrPublicConnectionMaterialInvalid
	}
	host := parsed.Hostname()
	if !validCanonicalHost(host) {
		return "", "", ErrPublicConnectionMaterialInvalid
	}
	port := parsed.Port()
	if port != "" {
		number, parseErr := strconv.Atoi(port)
		if parseErr != nil ||
			number < 1 ||
			number > 65535 ||
			strconv.Itoa(number) != port {
			return "", "", ErrPublicConnectionMaterialInvalid
		}
	}
	authority := host
	if address := net.ParseIP(host); address != nil {
		host = address.String()
		if strings.Contains(host, ":") {
			authority = "[" + host + "]"
		} else {
			authority = host
		}
	}
	if port != "" {
		authority = net.JoinHostPort(host, port)
	}
	canonical := parsed.Scheme + "://" + authority
	if raw != canonical {
		return "", "", ErrPublicConnectionMaterialInvalid
	}
	return canonical, parsed.Scheme, nil
}

func validCanonicalHost(host string) bool {
	if host == "" || host != strings.ToLower(host) || strings.HasSuffix(host, ".") {
		return false
	}
	if address := net.ParseIP(host); address != nil {
		return address.String() == host
	}
	if len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" ||
			len(label) > 63 ||
			label[0] == '-' ||
			label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') &&
				(character < '0' || character > '9') &&
				character != '-' {
				return false
			}
		}
	}
	return true
}

func validPublicLifetime(
	issuedAt time.Time,
	expiresAt time.Time,
	now time.Time,
	maxLifetime time.Duration,
) bool {
	return !issuedAt.After(now.Add(stationTrustClockSkew)) &&
		expiresAt.After(now) &&
		expiresAt.Sub(issuedAt) > 0 &&
		expiresAt.Sub(issuedAt) <= maxLifetime
}

func validPublicDisplayName(value string) bool {
	return value != "" &&
		value == strings.TrimSpace(value) &&
		len(value) <= MaxPublicDisplayNameBytes
}
