package endpointvalidator

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	libp2ppeer "github.com/libp2p/go-libp2p/core/peer"
	peer "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"google.golang.org/protobuf/proto"
)

const (
	accessEndpointPath   = "/.well-known/peers-touch/access"
	accessEndpointDomain = "peers-touch/access-endpoint/v1\x00"
	maxResponseBytes     = 64 * 1024
)

type Validator struct {
	Resolver    *net.Resolver
	Timeout     time.Duration
	Now         func() time.Time
	DialContext func(context.Context, string, string) (net.Conn, error)
}

func (v Validator) Validate(
	ctx context.Context,
	endpoint catalog.CatalogEndpoint,
) []catalog.Finding {
	materialBytes, err := base64.StdEncoding.DecodeString(
		endpoint.ConnectionMaterialBase64,
	)
	if err != nil {
		return findings("connection_material_base64", "material_encoding_invalid")
	}
	material := &peer.PublicEndpointConnectionMaterial{}
	if err := proto.Unmarshal(materialBytes, material); err != nil {
		return findings("connection_material_base64", "material_contract_invalid")
	}
	now := time.Now().UTC()
	if v.Now != nil {
		now = v.Now().UTC()
	}
	verified, err := peer.VerifyPublicEndpointConnectionMaterial(
		material,
		true,
		now,
	)
	if err != nil {
		return findings("connection_material_base64", "material_trust_invalid")
	}
	origin, err := url.Parse(verified.CanonicalDiscoveryOrigin)
	if err != nil {
		return findings("connection_material_base64", "origin_invalid")
	}
	addresses, err := v.resolvePublic(ctx, origin.Hostname())
	if err != nil {
		return findings("connection_material_base64", "origin_not_public")
	}
	challenge := make([]byte, peer.StationIdentityChallengeSize)
	if _, err := rand.Read(challenge); err != nil {
		return findings("", "validation_unavailable")
	}
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&peer.AccessEndpointRequest{
			Challenge:             challenge,
			ClientProtocolVersion: 1,
		},
	)
	if err != nil {
		return findings("", "validation_unavailable")
	}
	client, err := v.clientFor(material, origin, addresses)
	if err != nil {
		return findings("connection_material_base64", "tls_trust_invalid")
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		verified.CanonicalDiscoveryOrigin+accessEndpointPath,
		bytes.NewReader(requestBytes),
	)
	if err != nil {
		return findings("", "validation_unavailable")
	}
	request.Header.Set("Accept", "application/protobuf")
	request.Header.Set("Content-Type", "application/protobuf")
	response, err := client.Do(request)
	if err != nil {
		return findings("", "endpoint_unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return findings("", "endpoint_rejected")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(body) > maxResponseBytes {
		return findings("", "endpoint_response_invalid")
	}
	if err := verifyResponse(
		body,
		material,
		challenge,
		now,
	); err != nil {
		return findings("", "endpoint_identity_invalid")
	}
	return nil
}

func (v Validator) resolvePublic(
	ctx context.Context,
	host string,
) ([]net.IP, error) {
	if address := net.ParseIP(host); address != nil {
		if forbiddenAddress(address) {
			return nil, catalog.ErrValidationFailed
		}
		return []net.IP{address}, nil
	}
	resolver := v.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	addresses, err := resolver.LookupIP(ctx, "ip", host)
	if err != nil || len(addresses) == 0 {
		return nil, catalog.ErrValidationFailed
	}
	for _, address := range addresses {
		if forbiddenAddress(address) {
			return nil, catalog.ErrValidationFailed
		}
	}
	return addresses, nil
}

func (v Validator) clientFor(
	material *peer.PublicEndpointConnectionMaterial,
	origin *url.URL,
	addresses []net.IP,
) (*http.Client, error) {
	timeout := v.Timeout
	if timeout <= 0 || timeout > 10*time.Second {
		timeout = 5 * time.Second
	}
	port := origin.Port()
	if port == "" {
		if origin.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	if number, err := strconv.Atoi(port); err != nil ||
		number < 1 ||
		number > 65535 {
		return nil, catalog.ErrValidationFailed
	}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(
			ctx context.Context,
			network string,
			_ string,
		) (net.Conn, error) {
			return v.dialResolvedAddresses(
				ctx,
				network,
				port,
				addresses,
				timeout,
			)
		},
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: origin.Hostname(),
		},
	}
	if trust := material.GetEndpointTlsTrust(); trust != nil {
		switch value := trust.GetTrust().(type) {
		case *peer.EndpointTlsTrust_CertificateAuthorityDer:
			certificate, err := x509.ParseCertificate(
				value.CertificateAuthorityDer,
			)
			if err != nil {
				return nil, err
			}
			pool := x509.NewCertPool()
			pool.AddCert(certificate)
			transport.TLSClientConfig.RootCAs = pool
		case *peer.EndpointTlsTrust_LeafSpkiSha256:
			expected := append([]byte(nil), value.LeafSpkiSha256...)
			transport.TLSClientConfig.InsecureSkipVerify = true
			transport.TLSClientConfig.VerifyConnection = func(
				state tls.ConnectionState,
			) error {
				if len(state.PeerCertificates) == 0 {
					return catalog.ErrValidationFailed
				}
				digest := sha256.Sum256(
					state.PeerCertificates[0].RawSubjectPublicKeyInfo,
				)
				if !bytes.Equal(digest[:], expected) {
					return catalog.ErrValidationFailed
				}
				return nil
			}
		}
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(
			_ *http.Request,
			_ []*http.Request,
		) error {
			return http.ErrUseLastResponse
		},
	}, nil
}

type dialResult struct {
	connection net.Conn
	err        error
}

func (v Validator) dialResolvedAddresses(
	ctx context.Context,
	network string,
	port string,
	addresses []net.IP,
	timeout time.Duration,
) (net.Conn, error) {
	if len(addresses) == 0 {
		return nil, catalog.ErrValidationFailed
	}
	dial := v.DialContext
	if dial == nil {
		dialer := &net.Dialer{Timeout: timeout}
		dial = dialer.DialContext
	}
	dialCtx, cancel := context.WithCancel(ctx)
	results := make(chan dialResult, len(addresses))
	for _, address := range addresses {
		address := append(net.IP(nil), address...)
		go func() {
			connection, err := dial(
				dialCtx,
				networkForAddress(network, address),
				net.JoinHostPort(address.String(), port),
			)
			results <- dialResult{connection: connection, err: err}
		}()
	}

	var failures []error
	for completed := 0; completed < len(addresses); completed++ {
		select {
		case <-ctx.Done():
			cancel()
			closePendingConnections(results, len(addresses)-completed)
			return nil, ctx.Err()
		case result := <-results:
			if result.err == nil && result.connection != nil {
				cancel()
				closePendingConnections(
					results,
					len(addresses)-completed-1,
				)
				return result.connection, nil
			}
			if result.connection != nil {
				_ = result.connection.Close()
			}
			if result.err != nil {
				failures = append(failures, result.err)
			}
		}
	}
	cancel()
	if err := errors.Join(failures...); err != nil {
		return nil, err
	}
	return nil, catalog.ErrValidationFailed
}

func networkForAddress(network string, address net.IP) string {
	if network != "tcp" {
		return network
	}
	if address.To4() != nil {
		return "tcp4"
	}
	return "tcp6"
}

func closePendingConnections(results <-chan dialResult, count int) {
	if count <= 0 {
		return
	}
	go func() {
		for range count {
			result := <-results
			if result.connection != nil {
				_ = result.connection.Close()
			}
		}
	}()
}

func verifyResponse(
	raw []byte,
	material *peer.PublicEndpointConnectionMaterial,
	challenge []byte,
	now time.Time,
) error {
	response := &peer.AccessEndpointResponse{}
	if err := proto.Unmarshal(raw, response); err != nil {
		return err
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil || !bytes.Equal(canonical, raw) {
		return catalog.ErrValidationFailed
	}
	statement := &peer.AccessEndpointStatement{}
	if err := proto.Unmarshal(
		response.GetEndpointStatementBytes(),
		statement,
	); err != nil {
		return err
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		statement,
	)
	if err != nil ||
		!bytes.Equal(statementBytes, response.GetEndpointStatementBytes()) ||
		!bytes.Equal(statement.GetChallenge(), challenge) ||
		statement.GetCanonicalOrigin() != material.GetCanonicalDiscoveryOrigin() ||
		statement.GetEndpointRole() != material.GetExpectedEndpointRole() ||
		statement.GetExpiresAtUnixMs() <= now.UnixMilli() {
		return catalog.ErrValidationFailed
	}
	publicKey, err := libp2pcrypto.UnmarshalPublicKey(
		response.GetEndpointPublicKey(),
	)
	if err != nil || publicKey.Type() != libp2pcrypto.Ed25519 {
		return catalog.ErrValidationFailed
	}
	endpointPeerID, err := libp2ppeer.IDFromPublicKey(publicKey)
	if err != nil ||
		endpointPeerID.String() != statement.GetEndpointPeerId() {
		return catalog.ErrValidationFailed
	}
	valid, err := publicKey.Verify(
		append(
			[]byte(accessEndpointDomain),
			response.GetEndpointStatementBytes()...,
		),
		response.GetEndpointSignature(),
	)
	if err != nil || !valid {
		return catalog.ErrValidationFailed
	}
	switch material.GetExpectedEndpointRole() {
	case peer.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY:
		if endpointPeerID.String() != material.GetExpectedEndpointIdentity() ||
			response.GetNodeAuthorization() != nil {
			return catalog.ErrValidationFailed
		}
	case peer.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION:
		authorization, err := peer.VerifyStationNodeAuthorization(
			response.GetNodeAuthorization(),
			now,
		)
		if err != nil ||
			authorization.Statement.GetNodePeerId() != endpointPeerID.String() ||
			authorization.Statement.GetStationPeerId() !=
				material.GetExpectedEndpointIdentity() ||
			!bytes.Equal(
				response.GetEndpointPublicKey(),
				authorization.Statement.GetNodePublicKey(),
			) {
			return catalog.ErrValidationFailed
		}
	default:
		return catalog.ErrValidationFailed
	}
	return nil
}

func forbiddenAddress(address net.IP) bool {
	if address == nil ||
		address.IsLoopback() ||
		address.IsPrivate() ||
		address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() ||
		address.IsMulticast() ||
		address.IsUnspecified() {
		return true
	}
	for _, blocked := range []string{
		"169.254.169.254",
		"100.100.100.200",
		"fd00:ec2::254",
	} {
		if address.Equal(net.ParseIP(blocked)) {
			return true
		}
	}
	return false
}

func findings(field string, code string) []catalog.Finding {
	return []catalog.Finding{
		{
			Field:   field,
			Code:    code,
			Message: "Endpoint validation failed.",
			Owner:   "node-connectivity",
		},
	}
}
