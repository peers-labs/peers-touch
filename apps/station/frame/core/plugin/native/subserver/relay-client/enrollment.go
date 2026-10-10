package relayclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

var ErrEnrollmentRequired = errors.New("relay enrollment required")

const maxEnrollmentResponseBytes = 64 * 1024

type cachedMountCredential struct {
	Token         string `json:"relay_token"`
	RelayPeerID   string `json:"relay_peer_id"`
	StationPeerID string `json:"station_peer_id"`
	MountID       uint64 `json:"mount_id"`
	Generation    uint64 `json:"generation"`
	ExpiresAt     string `json:"expires_at"`
}

type enrollmentChallengeResponse struct {
	ChallengeID string `json:"challenge_id"`
	InviteID    uint64 `json:"invite_id,omitempty"`
	RelayPeerID string `json:"relay_peer_id"`
	Challenge   []byte `json:"challenge"`
	IssuedAt    string `json:"issued_at"`
	ExpiresAt   string `json:"expires_at"`
}

type credentialResponse struct {
	RelayToken    string `json:"relay_token"`
	RelayPeerID   string `json:"relay_peer_id"`
	StationPeerID string `json:"station_peer_id"`
	MountID       uint64 `json:"mount_id"`
	Generation    uint64 `json:"generation"`
	ExpiresAt     string `json:"expires_at"`
}

func validateRelayClientOptions(options *Options) error {
	if options == nil {
		return fmt.Errorf("relay-client options are required")
	}
	controlURL, err := url.Parse(strings.TrimSpace(options.RelayURL))
	if err != nil || controlURL.Hostname() == "" {
		return fmt.Errorf("relay-url must be a valid HTTP(S) origin")
	}
	if controlURL.User != nil ||
		(controlURL.Path != "" && controlURL.Path != "/") ||
		controlURL.RawQuery != "" ||
		controlURL.Fragment != "" {
		return fmt.Errorf("relay-url must not contain userinfo, path, query, or fragment")
	}
	switch strings.ToLower(controlURL.Scheme) {
	case "https":
	case "http":
		host := strings.TrimSpace(controlURL.Hostname())
		ip := net.ParseIP(host)
		if !strings.EqualFold(host, "localhost") &&
			(ip == nil || !ip.IsLoopback()) {
			return fmt.Errorf("plaintext Relay control is restricted to loopback")
		}
	default:
		return fmt.Errorf("relay-url must use HTTPS or loopback HTTP")
	}
	if !options.UseTLS {
		return fmt.Errorf("Relay stream TLS is required")
	}
	identityURL, err := url.Parse(strings.TrimSpace(options.BootstrapIdentityURL))
	if err != nil ||
		identityURL.Scheme != "http" ||
		!isLoopbackHost(identityURL.Hostname()) ||
		identityURL.Path != "/sub-bootstrap/station-identity" ||
		identityURL.RawQuery != "" ||
		identityURL.Fragment != "" ||
		identityURL.User != nil {
		return fmt.Errorf("bootstrap-identity-url must be the local Station identity endpoint")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(strings.TrimSpace(host), "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *SubServer) acquireRelayCredential(
	ctx context.Context,
	stationPeerID string,
) (*cachedMountCredential, error) {
	if cached, err := loadCachedMountCredential(
		s.opts.TokenStorePath,
		stationPeerID,
	); err == nil {
		expiresAt, _ := time.Parse(time.RFC3339, cached.ExpiresAt)
		refreshLead := time.Duration(
			s.opts.CredentialRefreshIntervalSec,
		) * time.Second
		if refreshLead <= 0 {
			refreshLead = 5 * time.Minute
		}
		if expiresAt.After(time.Now().Add(refreshLead)) {
			return cached, nil
		}
		if expiresAt.After(time.Now()) {
			rotated, rotateErr := s.rotateRelayCredential(ctx, cached.Token)
			if rotateErr == nil {
				if err := s.persistRelayCredential(rotated); err != nil {
					return nil, err
				}
				return rotated, nil
			}
			return cached, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		_ = s.clearRelayCredential()
	}

	if strings.TrimSpace(s.opts.InviteToken) == "" {
		return nil, ErrEnrollmentRequired
	}
	credential, err := s.enroll(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrEnrollmentRequired, err)
	}
	if credential.StationPeerID != stationPeerID {
		return nil, fmt.Errorf("%w: Station identity changed", ErrEnrollmentRequired)
	}
	if err := s.persistRelayCredential(credential); err != nil {
		return nil, err
	}
	return credential, nil
}

func (s *SubServer) enroll(ctx context.Context) (*cachedMountCredential, error) {
	challenge := &enrollmentChallengeResponse{}
	if err := s.postJSON(
		ctx,
		"/api/v1/relay/enrollment/challenge",
		map[string]string{
			"invite_token": s.opts.InviteToken,
			"label":        s.opts.Label,
		},
		"",
		challenge,
	); err != nil {
		return nil, err
	}
	proof, err := s.signRelayChallenge(ctx, challenge)
	if err != nil {
		return nil, err
	}
	response := &credentialResponse{}
	if err := s.postJSON(
		ctx,
		"/api/v1/relay/register",
		map[string]interface{}{
			"invite_token": s.opts.InviteToken,
			"proof":        proof,
		},
		"",
		response,
	); err != nil {
		return nil, err
	}
	return cacheFromCredentialResponse(response)
}

func (s *SubServer) rotateRelayCredential(
	ctx context.Context,
	currentToken string,
) (*cachedMountCredential, error) {
	challenge := &enrollmentChallengeResponse{}
	if err := s.postJSON(
		ctx,
		"/api/v1/relay/rotation/challenge",
		map[string]interface{}{},
		currentToken,
		challenge,
	); err != nil {
		return nil, err
	}
	proof, err := s.signRelayChallenge(ctx, challenge)
	if err != nil {
		return nil, err
	}
	response := &credentialResponse{}
	if err := s.postJSON(
		ctx,
		"/api/v1/relay/token/refresh",
		map[string]interface{}{"proof": proof},
		currentToken,
		response,
	); err != nil {
		return nil, err
	}
	return cacheFromCredentialResponse(response)
}

func (s *SubServer) signRelayChallenge(
	ctx context.Context,
	challenge *enrollmentChallengeResponse,
) (domain.StationIdentityProof, error) {
	if challenge == nil ||
		challenge.ChallengeID == "" ||
		challenge.RelayPeerID == "" ||
		len(challenge.Challenge) != domain.EnrollmentChallengeByteSize {
		return domain.StationIdentityProof{}, fmt.Errorf("Relay challenge is invalid")
	}
	requestBytes, err := proto.Marshal(&peerpb.StationIdentityRequest{
		Challenge: challenge.Challenge,
	})
	if err != nil {
		return domain.StationIdentityProof{}, fmt.Errorf(
			"encode Station identity request: %w",
			err,
		)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.opts.BootstrapIdentityURL,
		bytes.NewReader(requestBytes),
	)
	if err != nil {
		return domain.StationIdentityProof{}, err
	}
	request.Header.Set("Accept", "application/x-protobuf")
	request.Header.Set("Content-Type", "application/x-protobuf")
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		return domain.StationIdentityProof{}, fmt.Errorf(
			"request Station identity proof: %w",
			err,
		)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(
		response.Body,
		maxEnrollmentResponseBytes,
	))
	if err != nil {
		return domain.StationIdentityProof{}, err
	}
	if response.StatusCode != http.StatusOK {
		return domain.StationIdentityProof{}, fmt.Errorf(
			"Station identity proof status=%d",
			response.StatusCode,
		)
	}
	identity := &peerpb.StationIdentityResponse{}
	if err := proto.Unmarshal(raw, identity); err != nil {
		return domain.StationIdentityProof{}, fmt.Errorf(
			"decode Station identity proof: %w",
			err,
		)
	}
	return domain.StationIdentityProof{
		ChallengeID:   challenge.ChallengeID,
		Statement:     append([]byte(nil), identity.GetStatementBytes()...),
		HostPublicKey: append([]byte(nil), identity.GetHostPublicKey()...),
		Signature:     append([]byte(nil), identity.GetSignature()...),
	}, nil
}

func (s *SubServer) postJSON(
	ctx context.Context,
	path string,
	body interface{},
	bearer string,
	output interface{},
) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(s.opts.RelayURL, "/") + path
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(encoded),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	response, err := s.relayHTTPClient(30 * time.Second).Do(request)
	if err != nil {
		return fmt.Errorf("Relay request failed: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(
		response.Body,
		maxEnrollmentResponseBytes,
	))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Relay request rejected with status=%d", response.StatusCode)
	}
	if err := json.Unmarshal(raw, output); err != nil {
		return fmt.Errorf("decode Relay response: %w", err)
	}
	return nil
}

func loadCachedMountCredential(
	path string,
	stationPeerID string,
) (*cachedMountCredential, error) {
	if strings.TrimSpace(path) == "" {
		return nil, os.ErrNotExist
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cached cachedMountCredential
	if json.Unmarshal(data, &cached) != nil ||
		cached.Token == "" ||
		cached.RelayPeerID == "" ||
		cached.StationPeerID != stationPeerID ||
		cached.MountID == 0 ||
		cached.Generation == 0 {
		return nil, fmt.Errorf("cached Relay credential is invalid")
	}
	expiresAt, err := time.Parse(time.RFC3339, cached.ExpiresAt)
	if err != nil || !expiresAt.After(time.Now()) {
		return nil, fmt.Errorf("cached Relay credential is expired")
	}
	return &cached, nil
}

func (s *SubServer) persistRelayCredential(
	credential *cachedMountCredential,
) error {
	if strings.TrimSpace(s.opts.TokenStorePath) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.opts.TokenStorePath), 0o700); err != nil {
		return fmt.Errorf("create Relay credential directory: %w", err)
	}
	payload, err := json.Marshal(credential)
	if err != nil {
		return fmt.Errorf("encode Relay credential: %w", err)
	}
	temporary := s.opts.TokenStorePath + ".tmp"
	if err := os.WriteFile(temporary, payload, 0o600); err != nil {
		return fmt.Errorf("write Relay credential: %w", err)
	}
	if err := os.Rename(temporary, s.opts.TokenStorePath); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("replace Relay credential: %w", err)
	}
	return nil
}

func (s *SubServer) clearRelayCredential() error {
	s.setCredential(nil)
	if strings.TrimSpace(s.opts.TokenStorePath) == "" {
		return nil
	}
	err := os.Remove(s.opts.TokenStorePath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func cacheFromCredentialResponse(
	response *credentialResponse,
) (*cachedMountCredential, error) {
	if response == nil ||
		response.RelayToken == "" ||
		response.RelayPeerID == "" ||
		response.StationPeerID == "" ||
		response.MountID == 0 ||
		response.Generation == 0 {
		return nil, fmt.Errorf("Relay credential response is incomplete")
	}
	expiresAt, err := time.Parse(time.RFC3339, response.ExpiresAt)
	if err != nil || !expiresAt.After(time.Now()) {
		return nil, fmt.Errorf("Relay credential response is expired")
	}
	return &cachedMountCredential{
		Token:         response.RelayToken,
		RelayPeerID:   response.RelayPeerID,
		StationPeerID: response.StationPeerID,
		MountID:       response.MountID,
		Generation:    response.Generation,
		ExpiresAt:     expiresAt.UTC().Format(time.RFC3339),
	}, nil
}
