package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
	authpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	accesspb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	protobufContentType   = "application/protobuf"
	stationIdentityDomain = "peers-touch/station-identity/v1\x00"
	maxClockSkew          = 30 * time.Second
	maxIdentityLifetime   = time.Minute
)

var requiredCapabilities = map[string]bool{
	"access-gate":      true,
	"actor-ptid":       true,
	"station-identity": true,
}

type loginOutput struct {
	Token string `json:"token"`
	PTID  string `json:"ptid"`
}

func main() {
	station := flag.String("station", os.Getenv("PT_ACCESS_CLIENT_STATION"), "Station base URL")
	email := flag.String("email", os.Getenv("PT_ACCESS_CLIENT_EMAIL"), "Actor email")
	password := flag.String("password", os.Getenv("PT_ACCESS_CLIENT_PASSWORD"), "Actor password")
	flag.Parse()

	result, err := login(*station, *email, *password)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func login(station, email, password string) (*loginOutput, error) {
	origin, err := normalizeOrigin(station)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(email) == "" || password == "" {
		return nil, errors.New("email and password are required")
	}

	stationPeerID, err := verifyStationIdentity(origin)
	if err != nil {
		return nil, err
	}
	deviceID := "federation-e2e-" + uuid.NewString()
	const generation uint64 = 1

	start := &accesspb.StartAccessAttemptResponse{}
	if err := postPeersProto(
		origin+"/actor/access/start",
		&accesspb.StartAccessAttemptRequest{
			StationUrl:    origin,
			StationPeerId: stationPeerID,
			Client: &accesspb.AccessGateClientInfo{
				Platform:            "testnet-federation-e2e",
				AppVersion:          "1",
				DeviceId:            deviceID,
				Locale:              "en",
				LifecycleGeneration: generation,
			},
		},
		start,
	); err != nil {
		return nil, fmt.Errorf("start access attempt: %w", err)
	}

	decision := start.GetDecision()
	if decision == nil || decision.GetAttemptId() == "" {
		return nil, errors.New("access start returned no decision")
	}
	gate := currentLoginGate(decision)
	if gate == nil {
		return nil, errors.New("canonical password gate is unavailable")
	}

	submit := &accesspb.SubmitAccessGateResponse{}
	if err := postPeersProto(
		origin+"/actor/access/submit",
		&accesspb.SubmitAccessGateRequest{
			AttemptId:           decision.GetAttemptId(),
			GateId:              gate.GetGateId(),
			Type:                accesspb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
			ActionInput:         &accesspb.SubmitAccessGateRequest_Login{Login: &authpb.LoginRequest{Email: email, Password: password, DeviceType: "testnet-federation"}},
			ActionId:            gate.GetActionId(),
			StationPeerId:       stationPeerID,
			DeviceId:            deviceID,
			LifecycleGeneration: generation,
			SchemaRevision:      gate.GetSchemaRevision(),
			SchemaDigest:        gate.GetSchemaDigest(),
			SubmissionId:        uuid.NewString(),
		},
		submit,
	); err != nil {
		return nil, fmt.Errorf("submit access gate: %w", err)
	}
	if submit.GetDecision().GetState() != accesspb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED {
		return nil, fmt.Errorf("access decision is not granted: %s", submit.GetDecision().GetState())
	}
	session := submit.GetLoginResponse()
	if session == nil || session.GetTokens().GetAccessToken() == "" || session.GetActorRef().GetPtid() == "" {
		return nil, errors.New("access submit returned an incomplete session")
	}
	return &loginOutput{
		Token: session.GetTokens().GetAccessToken(),
		PTID:  session.GetActorRef().GetPtid(),
	}, nil
}

func verifyStationIdentity(origin string) (string, error) {
	challenge := make([]byte, 32)
	if _, err := rand.Read(challenge); err != nil {
		return "", fmt.Errorf("generate Station challenge: %w", err)
	}
	response := &peerpb.StationIdentityResponse{}
	if err := postDirectProto(
		origin+"/sub-bootstrap/station-identity",
		&peerpb.StationIdentityRequest{Challenge: challenge},
		response,
	); err != nil {
		return "", fmt.Errorf("read Station identity: %w", err)
	}
	statement := &peerpb.StationIdentityStatement{}
	if err := proto.Unmarshal(response.GetStatementBytes(), statement); err != nil {
		return "", fmt.Errorf("decode Station identity statement: %w", err)
	}
	if !bytes.Equal(statement.GetChallenge(), challenge) {
		return "", errors.New("Station identity challenge mismatch")
	}
	if statement.GetCanonicalOrigin() != origin {
		return "", fmt.Errorf(
			"Station identity origin mismatch: got %q want %q",
			statement.GetCanonicalOrigin(),
			origin,
		)
	}
	now := time.Now().UnixMilli()
	if statement.GetIssuedAtUnixMs() > now+maxClockSkew.Milliseconds() ||
		statement.GetExpiresAtUnixMs() < now-maxClockSkew.Milliseconds() ||
		statement.GetExpiresAtUnixMs()-statement.GetIssuedAtUnixMs() > maxIdentityLifetime.Milliseconds() {
		return "", errors.New("Station identity validity window is invalid")
	}
	capabilities := make(map[string]bool, len(statement.GetCapabilities()))
	for _, capability := range statement.GetCapabilities() {
		capabilities[capability] = true
	}
	for capability := range requiredCapabilities {
		if !capabilities[capability] {
			return "", fmt.Errorf("Station identity is missing capability %q", capability)
		}
	}

	publicKey, err := crypto.UnmarshalPublicKey(response.GetHostPublicKey())
	if err != nil {
		return "", fmt.Errorf("decode Station public key: %w", err)
	}
	derivedPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		return "", fmt.Errorf("derive Station peer ID: %w", err)
	}
	if derivedPeerID.String() != statement.GetStationPeerId() {
		return "", errors.New("Station identity peer ID does not match the signing key")
	}
	signingBytes := append([]byte(stationIdentityDomain), response.GetStatementBytes()...)
	verified, err := publicKey.Verify(signingBytes, response.GetSignature())
	if err != nil || !verified {
		return "", errors.New("Station identity signature verification failed")
	}
	return statement.GetStationPeerId(), nil
}

func currentLoginGate(decision *accesspb.AccessDecision) *accesspb.AccessGate {
	for _, gate := range decision.GetGates() {
		if gate.GetGateId() == decision.GetCurrentGateId() &&
			gate.GetType() == accesspb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN {
			return gate
		}
	}
	return nil
}

func postDirectProto(endpoint string, request proto.Message, response proto.Message) error {
	body, err := requestBytes(request)
	if err != nil {
		return err
	}
	raw, err := executePost(endpoint, body)
	if err != nil {
		return err
	}
	return proto.Unmarshal(raw, response)
}

func postPeersProto(endpoint string, request proto.Message, response proto.Message) error {
	body, err := requestBytes(request)
	if err != nil {
		return err
	}
	raw, err := executePost(endpoint, body)
	if err != nil {
		return err
	}
	envelope := &types.PeersResponse{}
	if err := proto.Unmarshal(raw, envelope); err != nil {
		return fmt.Errorf("decode Peers response: %w", err)
	}
	if envelope.GetData() == nil {
		return fmt.Errorf("Peers response has no data: code=%s msg=%s", envelope.GetCode(), envelope.GetMsg())
	}
	if err := envelope.GetData().UnmarshalTo(response); err != nil {
		return fmt.Errorf("decode Peers response data: %w", err)
	}
	return nil
}

func requestBytes(message proto.Message) ([]byte, error) {
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("encode protobuf request: %w", err)
	}
	return body, nil
}

func executePost(endpoint string, body []byte) ([]byte, error) {
	request, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", protobufContentType)
	request.Header.Set("Accept", protobufContentType)
	client := &http.Client{Timeout: 20 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request %s: %w", endpoint, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("request %s failed: status=%d body=%q", endpoint, response.StatusCode, string(raw))
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != protobufContentType {
		return nil, fmt.Errorf("request %s returned non-canonical content type %q", endpoint, response.Header.Get("Content-Type"))
	}
	return raw, nil
}

func normalizeOrigin(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.User != nil || parsed.Hostname() == "" {
		return "", errors.New("Station URL is invalid")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("Station URL scheme must be http or https")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("Station URL must be an origin")
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}
