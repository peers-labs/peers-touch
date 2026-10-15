package relay

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func TestPendingLegacyCleanupPreservesOriginalCredentialFile(t *testing.T) {
	key, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	relayID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeOff})
	defer runtime.Close()
	db := openAttachmentTestDB(t, "attachment-legacy-pending-cleanup")
	controller, err := NewAttachmentController(db, runtime, testPeerID(t).String(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	rawKey, err := key.Raw()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"type": "relay_enrollment", "station_peer_id": controller.stationPeerID,
		"node_peer_id": controller.nodePeerID, "iss": relayID.String(),
		"aud": "peers-touch-relay-enrollment",
		"sub": "relay-access:" + controller.stationPeerID + ":" + controller.nodePeerID,
		"iat": now.Add(-time.Minute).Unix(), "exp": now.Add(time.Hour).Unix(),
	}).SignedString(ed25519.PrivateKey(rawKey))
	if err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(t.TempDir(), "operator-credential.json")
	if err := persistRelayCredential(original, relayCredential{Token: token}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(original)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("unexpected cleanup request")
		}
		_, _ = w.Write([]byte(`{"status":"retired"}`))
	}))
	defer server.Close()
	if err := migrateAttachmentScope(db); err != nil {
		t.Fatal(err)
	}
	row := relayAttachmentPO{StationPeerID: controller.stationPeerID, NodePeerID: controller.nodePeerID,
		RelayPeerID: relayID.String(), ControlOrigin: server.URL, DialAddresses: []string{"/ip4/127.0.0.1/tcp/1"},
		CredentialFile: original, Source: attachmentSourceInvitation, CleanupPending: true}
	if err := controller.upsertDesired(t.Context(), &row); err != nil {
		t.Fatal(err)
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := controller.ownedDB(t.Context()).First(&row, "relay_peer_id = ?", relayID.String()).Error; err != nil {
		t.Fatal(err)
	}
	managed := filepath.Join(controller.credentialRoot, relayID.String()+".json")
	if row.CredentialFile != managed || len(runtime.targets()) != 0 || controller.controlHasTarget(relayID) {
		t.Fatal("pending cleanup did not scope its credential while remaining disabled")
	}
	if _, err := os.Stat(managed); err != nil {
		t.Fatal("managed credential copy missing:", err)
	}
	if err := db.Exec(`CREATE TRIGGER fail_retirement_ack
		BEFORE UPDATE OF retirement_confirmed ON station_relay_attachment
		BEGIN SELECT RAISE(ABORT, 'ack persistence failed'); END`).Error; err != nil {
		t.Fatal(err)
	}
	result, err := controller.RetryAttachment(t.Context(), relayID.String())
	if err != nil || !result.CleanupPending {
		t.Fatalf("failed acknowledgement persistence did not retain pending cleanup: %+v err=%v", result, err)
	}
	if _, err := os.Stat(managed); err != nil {
		t.Fatal("credential removed before durable acknowledgement:", err)
	}
	if err := db.Exec("DROP TRIGGER fail_retirement_ack").Error; err != nil {
		t.Fatal(err)
	}
	result, err = controller.RetryAttachment(t.Context(), relayID.String())
	if err != nil || result.CleanupPending {
		t.Fatalf("legacy cleanup failed: %+v err=%v", result, err)
	}
	after, err := os.ReadFile(original)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("cleanup mutated or deleted the operator-provided original:", err)
	}
	if _, err := os.Stat(managed); !os.IsNotExist(err) {
		t.Fatal("managed credential survived completed cleanup:", err)
	}
}

func TestCleanupResumesAfterAcknowledgementAndCredentialRemoval(t *testing.T) {
	runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeOff})
	defer runtime.Close()
	db := openAttachmentTestDB(t, "attachment-interrupted-cleanup")
	controller, err := NewAttachmentController(db, runtime, testPeerID(t).String(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	relayID := testPeerID(t)
	if err := migrateAttachmentScope(db); err != nil {
		t.Fatal(err)
	}
	// Model a stop after authenticated acknowledgement and file removal but
	// before cleanup_pending was cleared. The offline Relay is not needed again.
	row := relayAttachmentPO{StationPeerID: controller.stationPeerID, NodePeerID: controller.nodePeerID,
		RelayPeerID: relayID.String(), ControlOrigin: "http://127.0.0.1:1",
		DialAddresses:  []string{"/ip4/127.0.0.1/tcp/1"},
		CredentialFile: filepath.Join(controller.credentialRoot, relayID.String()+".json"),
		Source:         attachmentSourceInvitation, CleanupPending: true, RetirementConfirmed: true}
	if err := controller.upsertDesired(t.Context(), &row); err != nil {
		t.Fatal(err)
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatal(err)
	}
	result, err := controller.RetryAttachment(t.Context(), relayID.String())
	if err != nil || result.CleanupPending || result.State != AttachmentStateDetached {
		t.Fatalf("acknowledged cleanup required deleted credentials: %+v err=%v", result, err)
	}
	if len(runtime.targets()) != 0 || controller.controlHasTarget(relayID) {
		t.Fatal("cleanup replay restored a dial target")
	}
}
