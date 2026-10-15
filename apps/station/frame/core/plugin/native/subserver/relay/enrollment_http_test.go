package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	standardrelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
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
	admission := standardrelay.NewAdmission()
	service := application.NewService(repository, authority, admission)
	subserver := &SubServer{
		opts: &Options{
			MaxStations: 10,
			Admission:   admission,
		},
		svc: service,
	}
	handler := newRelayHandler(subserver)

	invite, secret, err := service.CreateInvite(
		context.Background(),
		"",
		"station",
		4,
		0,
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

	rootPrivateKey, rootPublicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Station root key: %v", err)
	}
	nodePrivateKey, nodePublicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Station node key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(rootPublicKey)
	if err != nil {
		t.Fatalf("derive Station peer ID: %v", err)
	}
	now := time.Now().UTC()
	capabilities := []string{"station-identity", "station-route"}
	authorization, err := peerpb.SignStationNodeAuthorization(
		rootPrivateKey,
		nodePublicKey,
		1,
		capabilities,
		now,
		now.Add(time.Hour),
	)
	if err != nil {
		t.Fatalf("authorize Station node: %v", err)
	}
	identityResponse, err := peerpb.SignStationIdentityResponse(
		nodePrivateKey,
		authorization,
		"https://station.example:443",
		challenge.Challenge,
		capabilities,
		now,
	)
	if err != nil {
		t.Fatalf("sign Station identity response: %v", err)
	}
	identityResponseBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(identityResponse)
	if err != nil {
		t.Fatalf("marshal Station identity response: %v", err)
	}
	registerBody, err := json.Marshal(registerRequest{
		InviteToken: secret,
		Proof: domain.StationIdentityProof{
			ChallengeID: challenge.ChallengeID,
			Response:    identityResponseBytes,
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

	retireIdentity, err := service.AuthenticateRetireCredential(
		t.Context(),
		registration.RelayToken,
	)
	if err != nil {
		t.Fatalf("authenticate self-retire credential: %v", err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		retireRequest := httptest.NewRequest(
			http.MethodDelete,
			"/api/v1/relay/enrollment/self",
			nil,
		)
		retireRequest = retireRequest.WithContext(coreauth.WithSubject(
			retireRequest.Context(),
			nodeIdentitySubject(retireIdentity, domain.ScopeNodeRetire),
		))
		retireResponse := httptest.NewRecorder()
		handler.handleRetireEnrollment(retireResponse, retireRequest)
		if retireResponse.Code != http.StatusOK {
			t.Fatalf(
				"self-retire attempt %d status=%d body=%s",
				attempt,
				retireResponse.Code,
				retireResponse.Body.String(),
			)
		}
	}
}

func TestInviteHTTPUsesPermanentDeleteContract(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:relay-invite-http?mode=memory&cache=shared"),
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
	node, err := libp2p.New(libp2p.NoListenAddrs)
	if err != nil {
		t.Fatalf("create Relay Host: %v", err)
	}
	defer node.Close()
	admission := standardrelay.NewAdmission()
	handler := newRelayHandler(&SubServer{
		opts: &Options{
			MaxStations:   10,
			PublicBaseURL: "https://relay.example",
			Admission:     admission,
			Host:          node,
		},
		svc: application.NewService(repository, authority, admission),
	})

	createResponse := httptest.NewRecorder()
	handler.handleCreateInvite(
		createResponse,
		httptest.NewRequest(
			http.MethodPost,
			"/api/v1/relay/invite",
			strings.NewReader(`{"label":"permanent"}`),
		),
	)
	if createResponse.Code != http.StatusOK {
		t.Fatalf(
			"create invite status=%d body=%s",
			createResponse.Code,
			createResponse.Body.String(),
		)
	}
	if strings.Contains(createResponse.Body.String(), "expires") {
		t.Fatalf(
			"permanent invite response contains expiry: %s",
			createResponse.Body.String(),
		)
	}
	var created struct {
		InviteID   uint64            `json:"invite_id,string"`
		Invitation invitationPackage `json:"invitation"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create invite response: %v", err)
	}
	if created.InviteID == 0 ||
		created.Invitation.InviteToken == "" ||
		created.Invitation.ControlOrigin != "https://relay.example" ||
		created.Invitation.RelayPeerID != node.ID().String() {
		t.Fatalf("unexpected invitation package: %+v", created)
	}

	listResponse := httptest.NewRecorder()
	handler.handleListInvites(
		listResponse,
		httptest.NewRequest(http.MethodGet, "/api/v1/relay/invites", nil),
	)
	if listResponse.Code != http.StatusOK ||
		strings.Contains(listResponse.Body.String(), "expires") {
		t.Fatalf(
			"list permanent invites status=%d body=%s",
			listResponse.Code,
			listResponse.Body.String(),
		)
	}

	var browserPayload map[string]interface{}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &browserPayload); err != nil {
		t.Fatal(err)
	}
	if browserPayload["invite_id"] != strconv.FormatUint(created.InviteID, 10) {
		t.Fatalf("invite ID is not a lossless JSON string: %v", browserPayload["invite_id"])
	}
	var browserList struct {
		Invites []struct {
			ID string `json:"id"`
		} `json:"invites"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &browserList); err != nil ||
		len(browserList.Invites) != 1 || browserList.Invites[0].ID != browserPayload["invite_id"] {
		t.Fatalf("list ID lost precision: %+v, err=%v", browserList, err)
	}
	deleteBody, err := json.Marshal(map[string]interface{}{"invite_id": browserPayload["invite_id"]})
	if err != nil {
		t.Fatal(err)
	}
	deleteResponse := httptest.NewRecorder()
	handler.handleDeleteInvite(
		deleteResponse,
		httptest.NewRequest(
			http.MethodDelete,
			"/api/v1/relay/invite",
			bytes.NewReader(deleteBody),
		),
	)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf(
			"delete active invite status=%d body=%s",
			deleteResponse.Code,
			deleteResponse.Body.String(),
		)
	}
	repeatDeleteResponse := httptest.NewRecorder()
	handler.handleDeleteInvite(
		repeatDeleteResponse,
		httptest.NewRequest(
			http.MethodDelete,
			"/api/v1/relay/invite",
			bytes.NewReader(deleteBody),
		),
	)
	if repeatDeleteResponse.Code != http.StatusConflict {
		t.Fatalf(
			"repeat delete status=%d body=%s",
			repeatDeleteResponse.Code,
			repeatDeleteResponse.Body.String(),
		)
	}
}
