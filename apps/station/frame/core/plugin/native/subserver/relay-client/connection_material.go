package relayclient

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	defaultRouteLifetime = time.Hour
	defaultGrantLifetime = 10 * time.Minute
	connectionCodePrefix = "ptc1:"
	connectionDeepLink   = "peers-touch://connect#"
)

var (
	ErrConnectionMaterialUnavailable = errors.New(
		"Relay connection material is unavailable",
	)
	ErrInvalidConnectionMaterialRequest = errors.New(
		"Relay connection material request is invalid",
	)
)

type stationConnectionSigner interface {
	SignStationRouteAttestation(
		*peerpb.StationRouteStatement,
	) (*peerpb.StationRouteAttestation, error)
	SignStationConnectionGrant(
		*peerpb.StationConnectionGrantStatement,
	) (*peerpb.StationConnectionGrant, error)
}

// ConnectionMaterialRequest is supplied by the Station-owned inner TLS
// ingress once its exact SPKI and capability manifest are available.
type ConnectionMaterialRequest struct {
	RouteID            string
	InnerTLSSPKISHA256 []byte
	CapabilitiesDigest []byte
	RouteLifetime      time.Duration
	GrantLifetime      time.Duration
	MaxUses            uint32
}

// ConnectionMaterial is the only operator-facing projection of a private
// Relay route. Callers must treat both strings as secrets and avoid logs,
// analytics, query parameters, and HTTP Referer-bearing navigation.
type ConnectionMaterial struct {
	Code      string
	DeepLink  string
	ExpiresAt time.Time
}

// ConnectionMaterialIssuer is the Station-side control contract consumed by
// an authenticated operator surface. The relay-client retains mount credential
// ownership and never exposes it through this interface.
type ConnectionMaterialIssuer interface {
	IssueConnectionMaterial(
		context.Context,
		ConnectionMaterialRequest,
	) (*ConnectionMaterial, error)
}

var _ ConnectionMaterialIssuer = (*SubServer)(nil)

// IssueConnectionMaterial signs and publishes the current Station route,
// registers the private grant digest with the Relay, and only then returns the
// encoded connection material. The Relay never receives the grant plaintext.
func (s *SubServer) IssueConnectionMaterial(
	ctx context.Context,
	request ConnectionMaterialRequest,
) (*ConnectionMaterial, error) {
	if !s.connectionMaterialReady() {
		return nil, ErrConnectionMaterialUnavailable
	}
	credential, ok := s.getCredential()
	if !ok || credential.Token == "" ||
		credential.StationPeerID == "" ||
		credential.RelayPeerID == "" ||
		credential.Generation == 0 {
		return nil, ErrConnectionMaterialUnavailable
	}
	now := time.Now().UTC()
	credentialExpiresAt, err := time.Parse(time.RFC3339, credential.ExpiresAt)
	if err != nil || !credentialExpiresAt.After(now) {
		return nil, ErrConnectionMaterialUnavailable
	}
	routeLifetime := request.RouteLifetime
	if routeLifetime == 0 {
		routeLifetime = defaultRouteLifetime
	}
	grantLifetime := request.GrantLifetime
	if grantLifetime == 0 {
		grantLifetime = defaultGrantLifetime
	}
	if routeLifetime <= 0 ||
		routeLifetime > domain.MaxRouteAttestationLifetime ||
		grantLifetime <= 0 ||
		grantLifetime > domain.MaxConnectionGrantLifetime ||
		grantLifetime > routeLifetime {
		return nil, fmt.Errorf(
			"%w: Station connection material lifetime is invalid",
			ErrInvalidConnectionMaterialRequest,
		)
	}
	maxUses := request.MaxUses
	if maxUses == 0 {
		maxUses = 1
	}
	if maxUses > domain.MaxConnectionGrantUses {
		return nil, fmt.Errorf(
			"%w: Station connection grant max uses is invalid",
			ErrInvalidConnectionMaterialRequest,
		)
	}
	routeID := strings.TrimSpace(request.RouteID)
	if routeID == "" {
		routeID, err = randomConnectionMaterialID()
		if err != nil {
			return nil, fmt.Errorf("generate Station route ID: %w", err)
		}
	}
	signer, err := s.ensureStationConnectionSigner()
	if err != nil {
		return nil, err
	}

	// Route security material is owned by the Station process. Caller-supplied
	// digest fields are retained in the request wire for compatibility but are
	// never trusted as route truth.
	attestation, err := s.publishRoute(
		ctx,
		routeID,
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
		routeLifetime,
	)
	if err != nil {
		return nil, err
	}

	grantID, err := randomConnectionMaterialID()
	if err != nil {
		return nil, fmt.Errorf("generate Station connection grant ID: %w", err)
	}
	grantExpiresAt := now.Add(grantLifetime)
	grant, err := signer.SignStationConnectionGrant(
		&peerpb.StationConnectionGrantStatement{
			GrantId:         grantID,
			StationPeerId:   credential.StationPeerID,
			RelayPeerId:     credential.RelayPeerID,
			RouteId:         routeID,
			RouteGeneration: credential.Generation,
			MaxUses:         maxUses,
			IssuedAtUnixMs:  now.UnixMilli(),
			ExpiresAtUnixMs: grantExpiresAt.UnixMilli(),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("sign Station connection grant: %w", err)
	}
	grantBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(grant)
	if err != nil {
		return nil, fmt.Errorf("encode Station connection grant: %w", err)
	}
	grantDigest := sha256.Sum256(grantBytes)
	registered := &peerpb.RegisterStationConnectionGrantResponse{}
	if err := s.postProto(
		ctx,
		"/api/v1/relay/grants",
		credential.Token,
		&peerpb.RegisterStationConnectionGrantRequest{
			GrantDigest:     grantDigest[:],
			GrantId:         grantID,
			RouteId:         routeID,
			RouteGeneration: credential.Generation,
			MaxUses:         maxUses,
			ExpiresAtUnixMs: grantExpiresAt.UnixMilli(),
		},
		registered,
	); err != nil {
		return nil, fmt.Errorf("register Station connection grant: %w", err)
	}
	if registered.GetGrantId() != grantID ||
		registered.GetRemainingUses() == 0 ||
		registered.GetRemainingUses() > maxUses {
		return nil, fmt.Errorf("Relay registered an invalid Station connection grant")
	}

	envelopeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&peerpb.StationConnectionEnvelope{
			ProtocolVersion:  domain.AccessProtocolVersion,
			RelayOrigin:      strings.TrimRight(s.opts.RelayURL, "/"),
			RouteAttestation: attestation,
			ConnectionGrant:  grant,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("encode Station connection material: %w", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(envelopeBytes)
	return &ConnectionMaterial{
		Code:      connectionCodePrefix + payload,
		DeepLink:  connectionDeepLink + payload,
		ExpiresAt: grantExpiresAt,
	}, nil
}

func (s *SubServer) connectionMaterialReady() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status == server.StatusRunning &&
		s.enrollmentState == "mounted"
}

func (s *SubServer) ensureStationConnectionSigner() (stationConnectionSigner, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stationSigner != nil {
		return s.stationSigner, nil
	}
	signer, err := resolveStationConnectionSigner()
	if err != nil {
		return nil, err
	}
	s.stationSigner = signer
	return signer, nil
}

func resolveStationConnectionSigner() (_ stationConnectionSigner, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("Station route signer is unavailable")
		}
	}()
	options := server.GetOptions()
	var resolved stationConnectionSigner
	for _, subserver := range options.SubserverInstances {
		if signer, ok := subserver.(stationConnectionSigner); ok {
			if resolved != nil {
				return nil, fmt.Errorf("multiple Station route signers are registered")
			}
			resolved = signer
		}
	}
	if resolved == nil {
		return nil, fmt.Errorf("Station route signer is unavailable")
	}
	return resolved, nil
}

func (s *SubServer) postProto(
	ctx context.Context,
	path string,
	bearer string,
	input proto.Message,
	output proto.Message,
) error {
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(s.opts.RelayURL, "/")+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/protobuf")
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("Content-Type", "application/protobuf")
	response, err := s.relayHTTPClient(30 * time.Second).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(
		response.Body,
		maxEnrollmentResponseBytes+1,
	))
	if err != nil {
		return err
	}
	if len(raw) > maxEnrollmentResponseBytes {
		return fmt.Errorf("Relay protobuf response is too large")
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Relay request rejected with status=%d", response.StatusCode)
	}
	if err := proto.Unmarshal(raw, output); err != nil {
		return fmt.Errorf("decode Relay protobuf response: %w", err)
	}
	if len(output.ProtoReflect().GetUnknown()) != 0 {
		return fmt.Errorf("Relay protobuf response contains unknown fields")
	}
	return nil
}

func randomConnectionMaterialID() (string, error) {
	value := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
