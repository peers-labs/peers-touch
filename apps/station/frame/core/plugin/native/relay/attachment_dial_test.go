package relay

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestOfflineDetachNeverDiscoversRemovedRelayWhileAnotherRemains(t *testing.T) {
	var discoveries [2]atomic.Int32
	var servers [2]*httptest.Server
	for index := range servers {
		servers[index] = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/.well-known/peers-touch/access" {
				discoveries[index].Add(1)
				http.NotFound(w, r)
				return
			}
			http.Error(w, "Relay offline for retirement", http.StatusServiceUnavailable)
		}))
		t.Cleanup(servers[index].Close)
	}
	runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeOff})
	defer runtime.Close()
	controller, err := NewAttachmentController(
		openAttachmentTestDB(t, "attachment-dial-isolation"),
		runtime, testPeerID(t).String(), t.TempDir(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatal(err)
	}
	var rows [2]relayAttachmentPO
	for index := range rows {
		id := testPeerID(t).String()
		rows[index] = relayAttachmentPO{
			StationPeerID: controller.stationPeerID, NodePeerID: controller.nodePeerID,
			RelayPeerID: id, ControlOrigin: servers[index].URL,
			DialAddresses:  []string{"/ip4/127.0.0.1/tcp/1/p2p/" + id},
			CredentialFile: filepath.Join(controller.credentialRoot, id+".json"),
			Enabled:        true, Source: attachmentSourceInvitation,
		}
		if err := persistRelayCredential(rows[index].CredentialFile, relayCredential{
			Token: "cleanup-test-token", RelayPeerID: id, StationPeerID: controller.stationPeerID,
			Generation: 1, EnrollmentID: 1, ExpiresAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
		}); err != nil {
			t.Fatal(err)
		}
		if err := controller.upsertDesired(t.Context(), &rows[index]); err != nil {
			t.Fatal(err)
		}
	}
	if err := controller.Initialize(t.Context()); err != nil {
		t.Fatal(err)
	}
	deleted, err := controller.DeleteAttachment(t.Context(), rows[0].RelayPeerID)
	if err != nil || !deleted.CleanupPending {
		t.Fatalf("offline detach = %+v, err=%v", deleted, err)
	}
	request, err := http.NewRequest(http.MethodGet, "https://station.example/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	// No signed destination is available in this fixture, but the remaining
	// Relay must still be queried and the deleted Relay must never be queried.
	_, err = runtime.RoundTrip(t.Context(), testPeerID(t).String(), request)
	if err == nil {
		t.Fatal("unsigned discovery unexpectedly produced a route")
	}
	if discoveries[0].Load() != 0 || discoveries[1].Load() != 1 {
		t.Fatalf("discovery calls: removed=%d remaining=%d", discoveries[0].Load(), discoveries[1].Load())
	}
	if _, err := controller.RetryAttachment(t.Context(), rows[0].RelayPeerID); err != nil {
		t.Fatal(err)
	}
	_, _ = runtime.RoundTrip(t.Context(), testPeerID(t).String(), request)
	if discoveries[0].Load() != 0 || discoveries[1].Load() != 2 {
		t.Fatal("cleanup retry reintroduced the removed Relay into discovery")
	}
}
