package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAttachmentControllerPersistsCredentialBeforeDesiredIntentAndCleansUp(
	t *testing.T,
) {
	relayPeerID := testPeerID(t)
	stationPeerID := testPeerID(t)
	var retireEnabled atomic.Bool
	var retireCalls atomic.Int32
	controlServer := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			switch request.URL.Path {
			case "/api/v1/relay/enrollment/challenge":
				_ = json.NewEncoder(response).Encode(enrollmentChallenge{
					ChallengeID: "challenge",
					RelayPeerID: relayPeerID.String(),
					Challenge:   make([]byte, 32),
				})
			case "/api/v1/relay/register":
				_ = json.NewEncoder(response).Encode(relayCredential{
					Token:         "relay-token",
					RelayPeerID:   relayPeerID.String(),
					StationPeerID: stationPeerID.String(),
					EnrollmentID:  7,
					Generation:    1,
					ExpiresAt: time.Now().UTC().
						Add(time.Hour).
						Format(time.RFC3339),
				})
			case "/api/v1/relay/enrollment/self":
				retireCalls.Add(1)
				if request.Method != http.MethodDelete ||
					request.Header.Get("Authorization") != "Bearer relay-token" {
					http.Error(response, "invalid retirement request", http.StatusBadRequest)
					return
				}
				if !retireEnabled.Load() {
					http.Error(response, "offline", http.StatusServiceUnavailable)
					return
				}
				_, _ = response.Write([]byte(`{"status":"retired"}`))
			default:
				http.NotFound(response, request)
			}
		},
	))
	defer controlServer.Close()

	runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeOff})
	defer runtime.Close()
	db := openAttachmentTestDB(t, "relay-attachment-lifecycle")
	credentialRoot := filepath.Join(t.TempDir(), "credentials")
	controller, err := NewAttachmentController(
		db,
		runtime,
		stationPeerID.String(),
		credentialRoot,
	)
	if err != nil {
		t.Fatalf("create Attachment Controller: %v", err)
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatalf("initialize Attachment Controller: %v", err)
	}

	invitationToken := "one-time-invitation"
	attachment, err := controller.ImportAttachment(
		t.Context(),
		InvitationPackage{
			SchemaVersion:         1,
			RelayPeerID:           relayPeerID.String(),
			ControlOrigin:         controlServer.URL,
			DialAddresses:         []string{"/ip4/127.0.0.1/tcp/1/p2p/" + relayPeerID.String()},
			InviteToken:           invitationToken,
			IntendedStationPeerID: stationPeerID.String(),
			Label:                 "primary",
		},
	)
	if err != nil {
		t.Fatalf("import Relay attachment: %v", err)
	}
	if attachment.State != AttachmentStateAttaching {
		t.Fatalf("imported attachment state = %s", attachment.State)
	}
	targets := runtime.targets()
	if len(targets) != 1 || targets[0].InviteToken != "" {
		t.Fatalf("runtime retained invitation secret: %+v", targets)
	}
	credentialRaw, err := os.ReadFile(targets[0].CredentialFile)
	if err != nil {
		t.Fatalf("read persisted Relay credential: %v", err)
	}
	if strings.Contains(string(credentialRaw), invitationToken) {
		t.Fatal("credential file contains invitation token")
	}
	var stored relayAttachmentPO
	if err := db.First(&stored, "relay_peer_id = ?", relayPeerID.String()).
		Error; err != nil {
		t.Fatalf("load desired Relay attachment: %v", err)
	}
	if !stored.Enabled || stored.CleanupPending ||
		stored.CredentialFile != targets[0].CredentialFile {
		t.Fatalf("unexpected desired Relay attachment: %+v", stored)
	}

	deleting, err := controller.DeleteAttachment(
		t.Context(),
		relayPeerID.String(),
	)
	if err != nil {
		t.Fatalf("delete Relay attachment: %v", err)
	}
	if deleting.State != AttachmentStateCleanupPending ||
		!deleting.CleanupPending ||
		len(runtime.targets()) != 0 ||
		controller.controlHasTarget(relayPeerID) {
		t.Fatalf("offline delete did not disable local use: %+v", deleting)
	}
	visible, err := controller.ListAttachments(t.Context())
	if err != nil || len(visible) != 1 ||
		visible[0].State != AttachmentStateCleanupPending {
		t.Fatalf("cleanup-pending projection = %+v, err=%v", visible, err)
	}

	retireEnabled.Store(true)
	detached, err := controller.RetryAttachment(
		t.Context(),
		relayPeerID.String(),
	)
	if err != nil {
		t.Fatalf("retry Relay cleanup: %v", err)
	}
	if detached.State != AttachmentStateDetached ||
		detached.CleanupPending {
		t.Fatalf("cleanup retry result = %+v", detached)
	}
	if retireCalls.Load() != 2 {
		t.Fatalf("retirement calls = %d, want 2", retireCalls.Load())
	}
	if _, err := os.Stat(stored.CredentialFile); !os.IsNotExist(err) {
		t.Fatalf("Relay credential survived detach: %v", err)
	}
	visible, err = controller.ListAttachments(t.Context())
	if err != nil || len(visible) != 0 {
		t.Fatalf("detached attachment remained visible: %+v, err=%v", visible, err)
	}
	repeated, err := controller.DeleteAttachment(t.Context(), relayPeerID.String())
	if err != nil || repeated.CleanupPending || repeated.State != AttachmentStateDetached ||
		retireCalls.Load() != 2 {
		t.Fatalf("repeated detach recreated cleanup: %+v err=%v calls=%d", repeated, err, retireCalls.Load())
	}
	if _, err := controller.ImportAttachment(t.Context(), InvitationPackage{
		SchemaVersion: 1, RelayPeerID: relayPeerID.String(), ControlOrigin: controlServer.URL,
		DialAddresses: []string{"/ip4/127.0.0.1/tcp/1/p2p/" + relayPeerID.String()},
		InviteToken:   "fresh-invitation",
	}); err != nil {
		t.Fatal("completed detach blocked fresh invitation:", err)
	}
	if err := controller.ownedDB(t.Context()).First(&stored, "relay_peer_id = ?", relayPeerID.String()).Error; err != nil ||
		stored.RetirementConfirmed || !stored.Enabled {
		t.Fatalf("fresh invitation retained previous retirement: %+v err=%v", stored, err)
	}
}

func TestAttachmentControllerHonorsDisabledBootstrapTombstone(t *testing.T) {
	relayPeerID := testPeerID(t)
	stationPeerID := testPeerID(t)
	credentialRoot := filepath.Join(t.TempDir(), "credentials")
	target := Target{
		RelayPeerID:    relayPeerID,
		Addresses:      []string{"/ip4/127.0.0.1/tcp/1/p2p/" + relayPeerID.String()},
		ControlOrigin:  "http://127.0.0.1:1",
		InviteToken:    "bootstrap-invite",
		CredentialFile: filepath.Join(credentialRoot, relayPeerID.String()+".json"),
	}
	runtime := newAttachmentTestRuntime(t, Pool{
		Mode:    PoolModeCustom,
		Targets: []Target{target},
	})
	defer runtime.Close()
	db := openAttachmentTestDB(t, "relay-attachment-bootstrap-tombstone")
	if err := db.AutoMigrate(&relayAttachmentPO{}); err != nil {
		t.Fatalf("migrate Relay attachment table: %v", err)
	}
	if err := db.Create(&relayAttachmentPO{
		StationPeerID:  stationPeerID.String(),
		NodePeerID:     runtime.host.ID().String(),
		RelayPeerID:    relayPeerID.String(),
		ControlOrigin:  target.ControlOrigin,
		DialAddresses:  target.Addresses,
		CredentialFile: target.CredentialFile,
		Source:         attachmentSourceBootstrap,
		Enabled:        false,
	}).Error; err != nil {
		t.Fatalf("create bootstrap tombstone: %v", err)
	}
	controller, err := NewAttachmentController(
		db,
		runtime,
		stationPeerID.String(),
		credentialRoot,
	)
	if err != nil {
		t.Fatalf("create Attachment Controller: %v", err)
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatalf("initialize Attachment Controller: %v", err)
	}
	if len(runtime.targets()) != 0 ||
		controller.controlHasTarget(relayPeerID) {
		t.Fatal("disabled bootstrap target was reactivated")
	}
}

func newAttachmentTestRuntime(t *testing.T, pool Pool) *Runtime {
	t.Helper()
	value, err := NewRuntime(RuntimeConfig{Pool: pool}, true)
	if err != nil {
		t.Fatalf("create Relay runtime: %v", err)
	}
	node, err := libp2p.New(libp2p.NoListenAddrs)
	if err != nil {
		t.Fatalf("create Station Host: %v", err)
	}
	t.Cleanup(func() { _ = node.Close() })
	if err := value.AttachHost(node); err != nil {
		t.Fatalf("attach Station Host: %v", err)
	}
	if err := value.ConfigureStationControl(
		credentialPersistenceSigner{},
		[32]byte{1},
	); err != nil {
		t.Fatalf("configure Station Relay control: %v", err)
	}
	return value
}

func openAttachmentTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+name+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open attachment database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open attachment database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}
