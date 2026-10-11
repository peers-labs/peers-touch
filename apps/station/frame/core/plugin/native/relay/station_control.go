package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	connectionCodePrefix       = "ptc1:"
	connectionDeepLink         = "peers-touch://connect#"
	defaultControlTimeout      = 30 * time.Second
	defaultCredentialRenewal   = 5 * time.Minute
	defaultPrivateGrantLife    = 10 * time.Minute
	maxControlResponseBytes    = 1 << 20
	defaultPublicRouteLifetime = peerpb.MaxRouteAttestationLifetime
)

type StationControlSigner interface {
	SignStationIdentityResponse(
		challenge []byte,
	) (*peerpb.StationIdentityResponse, error)
	SignStationRouteAttestation(
		*peerpb.StationRouteStatement,
	) (*peerpb.StationRouteAttestation, error)
	SignStationConnectionGrant(
		*peerpb.StationConnectionGrantStatement,
	) (*peerpb.StationConnectionGrant, error)
}

type relayCredential struct {
	Token         string `json:"relay_token"`
	RelayPeerID   string `json:"relay_peer_id"`
	StationPeerID string `json:"station_peer_id"`
	EnrollmentID  uint64 `json:"enrollment_id"`
	Generation    uint64 `json:"generation"`
	ExpiresAt     string `json:"expires_at"`
}

type enrollmentChallenge struct {
	ChallengeID string `json:"challenge_id"`
	RelayPeerID string `json:"relay_peer_id"`
	Challenge   []byte `json:"challenge"`
}

type stationIdentityProof struct {
	ChallengeID string `json:"challenge_id"`
	Response    []byte `json:"response_bytes"`
}

type StationControl struct {
	pool       Pool
	host       host.Host
	signer     StationControlSigner
	innerSPKI  [sha256.Size]byte
	liveRoutes func(time.Time) []CircuitRoute

	lock        sync.Mutex
	credentials map[string]relayCredential
	clients     map[string]*http.Client
}

func NewStationControl(
	pool Pool,
	valueHost host.Host,
	signer StationControlSigner,
	innerSPKI [sha256.Size]byte,
	liveRoutes func(time.Time) []CircuitRoute,
) (*StationControl, error) {
	if pool.Mode != PoolModeCustom || len(pool.Targets) == 0 ||
		valueHost == nil || signer == nil ||
		innerSPKI == ([sha256.Size]byte{}) ||
		liveRoutes == nil {
		return nil, fmt.Errorf("Station Relay control is incomplete")
	}
	return &StationControl{
		pool:        pool,
		host:        valueHost,
		signer:      signer,
		innerSPKI:   innerSPKI,
		liveRoutes:  liveRoutes,
		credentials: make(map[string]relayCredential, len(pool.Targets)),
		clients:     make(map[string]*http.Client, len(pool.Targets)),
	}, nil
}

func (c *StationControl) Authorize(
	ctx context.Context,
	target Target,
) (uint64, error) {
	c.lock.Lock()
	defer c.lock.Unlock()
	credential, err := c.ensureCredentialLocked(ctx, target)
	if err != nil {
		return 0, err
	}
	return credential.Generation, nil
}

func (c *StationControl) Publish(
	ctx context.Context,
	target Target,
	route CircuitRoute,
) error {
	c.lock.Lock()
	defer c.lock.Unlock()
	credential, err := c.ensureCredentialLocked(ctx, target)
	if err != nil {
		return err
	}
	_, err = c.publishRouteLocked(
		ctx,
		target,
		credential,
		route,
		"circuit-"+target.RelayPeerID.String(),
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
		defaultPublicRouteLifetime,
	)
	return err
}

func (c *StationControl) IssueConnectionMaterial(
	ctx context.Context,
	request ConnectionMaterialRequest,
) (*ConnectionMaterial, error) {
	if c == nil {
		return nil, ErrConnectionMaterialUnavailable
	}
	now := time.Now().UTC()
	routeLifetime := request.RouteLifetime
	if routeLifetime == 0 {
		routeLifetime = defaultPublicRouteLifetime
	}
	grantLifetime := request.GrantLifetime
	if grantLifetime == 0 {
		grantLifetime = defaultPrivateGrantLife
	}
	maxUses := request.MaxUses
	if maxUses == 0 {
		maxUses = 1
	}
	if routeLifetime <= 0 ||
		routeLifetime > peerpb.MaxRouteAttestationLifetime ||
		grantLifetime <= 0 ||
		grantLifetime > peerpb.MaxConnectionGrantLifetime ||
		grantLifetime > routeLifetime ||
		maxUses > peerpb.MaxConnectionGrantUses {
		return nil, ErrInvalidConnectionMaterialRequest
	}
	routeID := strings.TrimSpace(request.RouteID)
	if routeID == "" {
		generated, err := randomControlID()
		if err != nil {
			return nil, err
		}
		routeID = generated
	}
	if len(routeID) > 128 || strings.ContainsRune(routeID, '\x00') {
		return nil, ErrInvalidConnectionMaterialRequest
	}

	c.lock.Lock()
	defer c.lock.Unlock()
	target, route, err := c.selectLiveRouteLocked(now)
	if err != nil {
		return nil, err
	}
	credential, err := c.ensureCredentialLocked(ctx, target)
	if err != nil {
		return nil, err
	}
	attestation, err := c.publishRouteLocked(
		ctx,
		target,
		credential,
		route,
		routeID,
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_GRANT_ONLY,
		routeLifetime,
	)
	if err != nil {
		return nil, err
	}
	grantID, err := randomControlID()
	if err != nil {
		return nil, err
	}
	grantExpiresAt := now.Add(grantLifetime)
	grant, err := c.signer.SignStationConnectionGrant(
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
	if err := c.postProtoLocked(
		ctx,
		target,
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
		registered.GetRemainingUses() != maxUses {
		return nil, fmt.Errorf("Relay returned an invalid connection grant result")
	}
	envelopeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&peerpb.StationConnectionEnvelope{
			ProtocolVersion:  1,
			RelayOrigin:      target.ControlOrigin,
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

func (c *StationControl) publishRouteLocked(
	ctx context.Context,
	target Target,
	credential relayCredential,
	route CircuitRoute,
	routeID string,
	visibility peerpb.StationRouteVisibility,
	lifetime time.Duration,
) (*peerpb.StationRouteAttestation, error) {
	now := time.Now().UTC()
	expiresAt := now.Add(lifetime)
	if route.ExpiresAt.Before(expiresAt) {
		expiresAt = route.ExpiresAt
	}
	attestation, err := c.signer.SignStationRouteAttestation(
		&peerpb.StationRouteStatement{
			StationPeerId:      credential.StationPeerID,
			RelayPeerId:        credential.RelayPeerID,
			RouteId:            routeID,
			RouteGeneration:    credential.Generation,
			InnerTlsSpkiSha256: c.innerSPKI[:],
			Visibility:         visibility,
			IssuedAtUnixMs:     now.UnixMilli(),
			ExpiresAtUnixMs:    expiresAt.UnixMilli(),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("sign Station Circuit route: %w", err)
	}
	published := &peerpb.PublishStationRouteResponse{}
	if err := c.postProtoLocked(
		ctx,
		target,
		"/api/v1/relay/routes",
		credential.Token,
		&peerpb.PublishStationRouteRequest{RouteAttestation: attestation},
		published,
	); err != nil {
		return nil, fmt.Errorf("publish Station Circuit route: %w", err)
	}
	if published.GetRouteId() != routeID ||
		published.GetRouteGeneration() != credential.Generation {
		return nil, fmt.Errorf("Relay published a different Station route")
	}
	return attestation, nil
}

func (c *StationControl) ensureCredentialLocked(
	ctx context.Context,
	target Target,
) (relayCredential, error) {
	key := target.RelayPeerID.String()
	credential, ok := c.credentials[key]
	if !ok {
		loaded, err := loadRelayCredential(target.CredentialFile)
		if err == nil {
			credential = loaded
			ok = true
		} else if !errors.Is(err, os.ErrNotExist) {
			return relayCredential{}, err
		}
	}
	if ok {
		expiresAt, err := time.Parse(time.RFC3339, credential.ExpiresAt)
		if err == nil &&
			credential.RelayPeerID == key &&
			credential.Generation > 0 &&
			expiresAt.After(time.Now().UTC().Add(defaultCredentialRenewal)) {
			c.credentials[key] = credential
			return credential, nil
		}
		if credential.Token != "" && credential.RelayPeerID == key {
			rotated, err := c.rotateCredentialLocked(ctx, target, credential)
			if err == nil {
				c.credentials[key] = rotated
				if err := persistRelayCredential(target.CredentialFile, rotated); err != nil {
					return relayCredential{}, err
				}
				return rotated, nil
			}
		}
	}
	if target.InviteToken == "" {
		return relayCredential{}, fmt.Errorf(
			"Relay %s requires enrollment but has no invite token",
			target.RelayPeerID,
		)
	}
	enrolled, err := c.enrollLocked(ctx, target)
	if err != nil {
		return relayCredential{}, err
	}
	c.credentials[key] = enrolled
	if err := persistRelayCredential(target.CredentialFile, enrolled); err != nil {
		return relayCredential{}, err
	}
	return enrolled, nil
}

func (c *StationControl) enrollLocked(
	ctx context.Context,
	target Target,
) (relayCredential, error) {
	challenge := enrollmentChallenge{}
	if err := c.postJSONLocked(
		ctx,
		target,
		"/api/v1/relay/enrollment/challenge",
		map[string]string{
			"invite_token": target.InviteToken,
			"label":        target.Label,
		},
		"",
		&challenge,
	); err != nil {
		return relayCredential{}, err
	}
	proof, err := c.signChallenge(challenge)
	if err != nil {
		return relayCredential{}, err
	}
	credential := relayCredential{}
	if err := c.postJSONLocked(
		ctx,
		target,
		"/api/v1/relay/register",
		map[string]any{
			"invite_token": target.InviteToken,
			"proof":        proof,
		},
		"",
		&credential,
	); err != nil {
		return relayCredential{}, err
	}
	return validateRelayCredential(target, credential)
}

func (c *StationControl) rotateCredentialLocked(
	ctx context.Context,
	target Target,
	current relayCredential,
) (relayCredential, error) {
	challenge := enrollmentChallenge{}
	if err := c.postJSONLocked(
		ctx,
		target,
		"/api/v1/relay/rotation/challenge",
		map[string]any{},
		current.Token,
		&challenge,
	); err != nil {
		return relayCredential{}, err
	}
	proof, err := c.signChallenge(challenge)
	if err != nil {
		return relayCredential{}, err
	}
	credential := relayCredential{}
	if err := c.postJSONLocked(
		ctx,
		target,
		"/api/v1/relay/token/refresh",
		map[string]any{"proof": proof},
		current.Token,
		&credential,
	); err != nil {
		return relayCredential{}, err
	}
	return validateRelayCredential(target, credential)
}

func (c *StationControl) signChallenge(
	challenge enrollmentChallenge,
) (stationIdentityProof, error) {
	if challenge.ChallengeID == "" ||
		challenge.RelayPeerID == "" ||
		len(challenge.Challenge) != 32 {
		return stationIdentityProof{}, fmt.Errorf("Relay challenge is invalid")
	}
	response, err := c.signer.SignStationIdentityResponse(
		challenge.Challenge,
	)
	if err != nil {
		return stationIdentityProof{}, err
	}
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(response)
	if err != nil {
		return stationIdentityProof{}, err
	}
	return stationIdentityProof{
		ChallengeID: challenge.ChallengeID,
		Response:    responseBytes,
	}, nil
}

func (c *StationControl) selectLiveRouteLocked(
	now time.Time,
) (Target, CircuitRoute, error) {
	routes := c.liveRoutes(now)
	if len(routes) != 1 {
		return Target{}, CircuitRoute{}, ErrConnectionMaterialUnavailable
	}
	route := routes[0]
	for _, target := range c.pool.Targets {
		if target.RelayPeerID == route.RelayPeerID {
			return target, route, nil
		}
	}
	return Target{}, CircuitRoute{}, ErrConnectionMaterialUnavailable
}

func (c *StationControl) postJSONLocked(
	ctx context.Context,
	target Target,
	path string,
	body any,
	bearer string,
	output any,
) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return c.doLocked(
		ctx,
		target,
		path,
		"application/json",
		bearer,
		encoded,
		func(raw []byte) error { return json.Unmarshal(raw, output) },
	)
}

func (c *StationControl) postProtoLocked(
	ctx context.Context,
	target Target,
	path string,
	bearer string,
	request proto.Message,
	response proto.Message,
) error {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return err
	}
	return c.doLocked(
		ctx,
		target,
		path,
		"application/protobuf",
		bearer,
		encoded,
		func(raw []byte) error {
			if err := proto.Unmarshal(raw, response); err != nil {
				return err
			}
			if len(response.ProtoReflect().GetUnknown()) != 0 {
				return fmt.Errorf("Relay response contains unknown fields")
			}
			return nil
		},
	)
}

func (c *StationControl) doLocked(
	ctx context.Context,
	target Target,
	path string,
	contentType string,
	bearer string,
	body []byte,
	decode func([]byte) error,
) error {
	client, err := c.httpClientLocked(target)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		target.ControlOrigin+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", contentType)
	request.Header.Set("Content-Type", contentType)
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("Relay control request failed: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(
		io.LimitReader(response.Body, maxControlResponseBytes+1),
	)
	if err != nil {
		return err
	}
	if len(raw) > maxControlResponseBytes {
		return fmt.Errorf("Relay control response exceeds size limit")
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf(
			"Relay control request returned HTTP %d",
			response.StatusCode,
		)
	}
	return decode(raw)
}

func (c *StationControl) httpClientLocked(target Target) (*http.Client, error) {
	key := target.RelayPeerID.String()
	if current := c.clients[key]; current != nil {
		return current, nil
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS13}
	if target.TLSCAFile != "" {
		pemBytes, err := os.ReadFile(target.TLSCAFile)
		if err != nil {
			return nil, fmt.Errorf("read Relay control CA: %w", err)
		}
		roots, err := x509.SystemCertPool()
		if err != nil || roots == nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM(pemBytes) {
			return nil, fmt.Errorf("Relay control CA contains no certificates")
		}
		transport.TLSClientConfig.RootCAs = roots
	}
	client := &http.Client{
		Timeout:   defaultControlTimeout,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	c.clients[key] = client
	return client, nil
}

func validateRelayCredential(
	target Target,
	credential relayCredential,
) (relayCredential, error) {
	expiresAt, err := time.Parse(time.RFC3339, credential.ExpiresAt)
	if err != nil || !expiresAt.After(time.Now().UTC()) ||
		credential.Token == "" ||
		credential.RelayPeerID != target.RelayPeerID.String() ||
		credential.StationPeerID == "" ||
		credential.EnrollmentID == 0 ||
		credential.Generation == 0 {
		return relayCredential{}, fmt.Errorf("Relay credential is invalid")
	}
	return credential, nil
}

func loadRelayCredential(path string) (relayCredential, error) {
	if path == "" {
		return relayCredential{}, os.ErrNotExist
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return relayCredential{}, err
	}
	credential := relayCredential{}
	if err := json.Unmarshal(raw, &credential); err != nil {
		return relayCredential{}, fmt.Errorf("decode Relay credential: %w", err)
	}
	return credential, nil
}

func persistRelayCredential(path string, credential relayCredential) error {
	if path == "" {
		return fmt.Errorf("Relay credential file is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func randomControlID() (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
