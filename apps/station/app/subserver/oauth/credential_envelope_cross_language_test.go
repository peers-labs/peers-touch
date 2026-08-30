package oauth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"golang.org/x/crypto/hkdf"
	"google.golang.org/protobuf/proto"
)

type credentialEnvelopeCrossLanguageFixture struct {
	CandidateID              string `json:"candidate_id"`
	SessionID                string `json:"session_id"`
	ActorPTID                string `json:"actor_ptid"`
	StationPeerID            string `json:"station_peer_id"`
	DeviceID                 string `json:"device_id"`
	LifecycleGeneration      uint64 `json:"lifecycle_generation"`
	AccessAttemptID          string `json:"access_attempt_id"`
	DecisionRevision         uint64 `json:"decision_revision"`
	ClientPrivateKey         string `json:"client_private_key"`
	ServerEphemeralPublicKey string `json:"server_ephemeral_public_key"`
	Nonce                    string `json:"nonce"`
	Ciphertext               string `json:"ciphertext"`
	ExpectedAccessToken      string `json:"expected_access_token"`
	ExpectedRefreshToken     string `json:"expected_refresh_token"`
}

func TestCredentialEnvelopeCrossLanguageFixtureMatchesCanonicalAlgorithm(t *testing.T) {
	expected := buildCredentialEnvelopeCrossLanguageFixture(t)
	fixturePath := filepath.Join(
		"..", "..", "..", "..",
		"mobile", "src-tauri", "src", "runtime", "oauth", "fixtures",
		"credential_envelope_go.json",
	)
	payload, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read cross-language credential envelope fixture: %v", err)
	}
	var actual credentialEnvelopeCrossLanguageFixture
	if err := json.Unmarshal(payload, &actual); err != nil {
		t.Fatalf("decode cross-language credential envelope fixture: %v", err)
	}
	if !reflect.DeepEqual(actual, expected) {
		expectedJSON, marshalErr := json.MarshalIndent(expected, "", "  ")
		if marshalErr != nil {
			t.Fatalf("encode expected cross-language fixture: %v", marshalErr)
		}
		t.Fatalf("credential envelope fixture differs from canonical Go algorithm:\n%s", expectedJSON)
	}
}

func buildCredentialEnvelopeCrossLanguageFixture(
	t *testing.T,
) credentialEnvelopeCrossLanguageFixture {
	t.Helper()

	const (
		candidateID         = "candidate-cross-language"
		sessionID           = "session-cross-language"
		actorPTID           = "ptid:person:cross-language"
		stationPeerID       = "12D3KooWCrossLanguageStation"
		deviceID            = "mobile-cross-language-device"
		accessAttemptID     = "access-attempt-cross-language"
		lifecycleGeneration = uint64(17)
		decisionRevision    = uint64(29)
	)
	clientPrivateBytes := fixedBytes(1, 32)
	serverPrivateBytes := fixedBytes(101, 32)
	nonce := fixedBytes(201, 12)

	curve := ecdh.X25519()
	clientPrivateKey, err := curve.NewPrivateKey(clientPrivateBytes)
	if err != nil {
		t.Fatalf("parse fixed client private key: %v", err)
	}
	serverPrivateKey, err := curve.NewPrivateKey(serverPrivateBytes)
	if err != nil {
		t.Fatalf("parse fixed server private key: %v", err)
	}
	sharedSecret, err := serverPrivateKey.ECDH(clientPrivateKey.PublicKey())
	if err != nil {
		t.Fatalf("derive fixed credential envelope secret: %v", err)
	}
	associatedData := credentialEnvelopeAssociatedData(
		candidateID,
		sessionID,
		stationPeerID,
		deviceID,
		lifecycleGeneration,
		accessAttemptID,
		decisionRevision,
	)
	key := make([]byte, 32)
	if _, err := io.ReadFull(
		hkdf.New(sha256.New, sharedSecret, nil, associatedData),
		key,
	); err != nil {
		t.Fatalf("derive fixed credential envelope key: %v", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("create fixed credential envelope cipher: %v", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("create fixed credential envelope AEAD: %v", err)
	}
	credential := &model.LoginResponse{
		Tokens: &model.AuthTokens{
			Token:        "fixture-access-token",
			AccessToken:  "fixture-access-token",
			RefreshToken: "fixture-refresh-token",
			TokenType:    "Bearer",
			ExpiresAt:    "2030-01-02T03:04:05Z",
		},
		SessionId: sessionID,
		ActorRef: &model.ActorRef{
			Ptid: actorPTID,
			Kind: model.ActorKind_ACTOR_KIND_PERSON,
		},
	}
	plaintext, err := proto.Marshal(credential)
	if err != nil {
		t.Fatalf("marshal fixed credential envelope plaintext: %v", err)
	}

	return credentialEnvelopeCrossLanguageFixture{
		CandidateID:              candidateID,
		SessionID:                sessionID,
		ActorPTID:                actorPTID,
		StationPeerID:            stationPeerID,
		DeviceID:                 deviceID,
		LifecycleGeneration:      lifecycleGeneration,
		AccessAttemptID:          accessAttemptID,
		DecisionRevision:         decisionRevision,
		ClientPrivateKey:         base64.StdEncoding.EncodeToString(clientPrivateBytes),
		ServerEphemeralPublicKey: base64.StdEncoding.EncodeToString(serverPrivateKey.PublicKey().Bytes()),
		Nonce:                    base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(
			aead.Seal(nil, nonce, plaintext, associatedData),
		),
		ExpectedAccessToken:  credential.GetTokens().GetAccessToken(),
		ExpectedRefreshToken: credential.GetTokens().GetRefreshToken(),
	}
}

func fixedBytes(start byte, count int) []byte {
	values := make([]byte, count)
	for index := range values {
		values[index] = start + byte(index)
	}
	return values
}
