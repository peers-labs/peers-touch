package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEnrollmentHTTPDerivesIdentityAndNeverListsInviteSecret(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-enrollment-http?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()

	repository := infrastructure.NewGormRepo(db)
	if err := repository.AutoMigrate(); err != nil {
		t.Fatalf("migrate Relay schema: %v", err)
	}
	authority, err := application.NewCredentialAuthority(
		[]byte("relay-http-test-signing-material-32-bytes"),
	)
	if err != nil {
		t.Fatalf("create credential authority: %v", err)
	}
	service := application.NewService(repository, authority)
	subserver := &SubServer{
		opts:    &Options{MaxStations: 10},
		svc:     service,
		streams: NewStreamManager(nil, 4),
	}
	handler := newRelayHandler(subserver)

	invite, secret, err := service.CreateInvite(
		context.Background(),
		"",
		"station",
		4,
		0,
		time.Hour,
	)
	if err != nil {
		t.Fatalf("create invite: %v", err)
	}
	challengeRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/relay/enrollment/challenge",
		strings.NewReader(
			`{"invite_token":"`+secret+`","label":"station"}`,
		),
	)
	challengeResponseRecorder := httptest.NewRecorder()
	handler.handleEnrollmentChallenge(
		challengeResponseRecorder,
		challengeRequest,
	)
	if challengeResponseRecorder.Code != http.StatusOK {
		t.Fatalf(
			"challenge status=%d body=%s",
			challengeResponseRecorder.Code,
			challengeResponseRecorder.Body.String(),
		)
	}
	var challenge enrollmentChallengeResponse
	if err := json.Unmarshal(
		challengeResponseRecorder.Body.Bytes(),
		&challenge,
	); err != nil {
		t.Fatalf("decode challenge: %v", err)
	}
	if challenge.InviteID != invite.ID ||
		len(challenge.Challenge) != domain.EnrollmentChallengeByteSize {
		t.Fatalf("unexpected challenge: %+v", challenge)
	}

	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Station key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive Station peer ID: %v", err)
	}
	now := time.Now().UTC()
	statement := &peerpb.StationIdentityStatement{
		Challenge:       challenge.Challenge,
		StationPeerId:   stationPeerID.String(),
		CanonicalOrigin: "https://station.example:443",
		Capabilities:    []string{"station-identity"},
		IssuedAtUnixMs:  now.UnixMilli(),
		ExpiresAtUnixMs: now.Add(time.Minute).UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil {
		t.Fatalf("marshal Station statement: %v", err)
	}
	signature, err := privateKey.Sign(
		append([]byte(domain.StationIdentityDomain), statementBytes...),
	)
	if err != nil {
		t.Fatalf("sign Station statement: %v", err)
	}
	hostPublicKey, err := libp2pcrypto.MarshalPublicKey(publicKey)
	if err != nil {
		t.Fatalf("marshal Station public key: %v", err)
	}
	registerBody, err := json.Marshal(registerRequest{
		InviteToken: secret,
		Proof: domain.StationIdentityProof{
			ChallengeID:   challenge.ChallengeID,
			Statement:     statementBytes,
			HostPublicKey: hostPublicKey,
			Signature:     signature,
		},
	})
	if err != nil {
		t.Fatalf("marshal registration: %v", err)
	}
	registerRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/relay/register",
		bytes.NewReader(registerBody),
	)
	registerRequest.Header.Set("X-Station-Peer-ID", "attacker-controlled")
	registerResponse := httptest.NewRecorder()
	handler.handleRegister(registerResponse, registerRequest)
	if registerResponse.Code != http.StatusOK {
		t.Fatalf(
			"register status=%d body=%s",
			registerResponse.Code,
			registerResponse.Body.String(),
		)
	}
	var registration struct {
		StationPeerID string `json:"station_peer_id"`
		RelayToken    string `json:"relay_token"`
		Generation    uint64 `json:"generation"`
	}
	if err := json.Unmarshal(registerResponse.Body.Bytes(), &registration); err != nil {
		t.Fatalf("decode registration: %v", err)
	}
	if registration.StationPeerID != stationPeerID.String() {
		t.Fatalf(
			"registered station=%q, want host-key peer=%q",
			registration.StationPeerID,
			stationPeerID,
		)
	}

	listResponse := httptest.NewRecorder()
	handler.handleListInvites(
		listResponse,
		httptest.NewRequest(http.MethodGet, "/api/v1/relay/invites", nil),
	)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list invites status=%d", listResponse.Code)
	}
	if strings.Contains(listResponse.Body.String(), secret) ||
		strings.Contains(listResponse.Body.String(), `"token"`) ||
		strings.Contains(listResponse.Body.String(), "secret_digest") {
		t.Fatalf("invite list exposed secret material: %s", listResponse.Body.String())
	}
}
