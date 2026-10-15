package relay

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestRetirementRecoversActiveCredentialAndPersistsBeforeRetry(t *testing.T) {
	for _, failPersistence := range []bool{false, true} {
		t.Run(map[bool]string{false: "persisted", true: "persistence-failed"}[failPersistence], func(t *testing.T) {
			relayID := testPeerID(t)
			current := relayCredential{Token: "expired", RelayPeerID: relayID.String(),
				StationPeerID: testPeerID(t).String(), EnrollmentID: 1, Generation: 1,
				ExpiresAt: time.Now().Add(-time.Hour).Format(time.RFC3339)}
			next := current
			next.Token, next.ExpiresAt = "recovered", time.Now().Add(time.Hour).Format(time.RFC3339)
			path := filepath.Join(t.TempDir(), "credential.json")
			if err := persistRelayCredential(path, current); err != nil {
				t.Fatal(err)
			}
			var deletes, rotations, enrollments atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/v1/relay/enrollment/self":
					if deletes.Add(1) == 1 {
						if r.Header.Get("Authorization") != "Bearer expired" {
							t.Error("retirement rotated before sending the saved token")
						}
						http.Error(w, "renewal required", http.StatusUnauthorized)
						return
					}
					saved, err := loadRelayCredential(path)
					if err != nil || saved.Token != next.Token ||
						r.Header.Get("Authorization") != "Bearer recovered" {
						t.Errorf("retirement retried before persistence: err=%v", err)
					}
					_, _ = w.Write([]byte(`{"status":"retired"}`))
				case "/api/v1/relay/rotation/challenge":
					rotations.Add(1)
					_ = json.NewEncoder(w).Encode(enrollmentChallenge{
						ChallengeID: "challenge", RelayPeerID: relayID.String(), Challenge: make([]byte, 32)})
				case "/api/v1/relay/token/refresh":
					_ = json.NewEncoder(w).Encode(next)
				default:
					enrollments.Add(1)
					http.Error(w, "unexpected registration", http.StatusBadRequest)
				}
			}))
			defer server.Close()
			runtime := newAttachmentTestRuntime(t, Pool{Mode: PoolModeOff})
			defer runtime.Close()
			persistErr := errors.New("retirement credential persistence failed")
			if failPersistence {
				runtime.control.persist = func(string, relayCredential) error { return persistErr }
			}
			target := Target{RelayPeerID: relayID, ControlOrigin: server.URL, CredentialFile: path,
				Addresses: []string{"/ip4/127.0.0.1/tcp/1"}, InviteToken: "must-not-be-used"}
			err := runtime.control.RetireTarget(t.Context(), target)
			expectedDeletes := int32(2)
			if failPersistence {
				expectedDeletes = 1
				if !errors.Is(err, persistErr) {
					t.Fatal("persistence failure was ignored:", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if deletes.Load() != expectedDeletes || rotations.Load() != 1 || enrollments.Load() != 0 {
				t.Fatalf("retirement requests: deletes=%d rotations=%d registrations=%d",
					deletes.Load(), rotations.Load(), enrollments.Load())
			}
			if len(runtime.control.targets) != 0 || len(runtime.control.credentials) != 0 {
				t.Fatal("retirement installed transient dial or credential state")
			}
		})
	}
}
