package githubrepository

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestClientCommitsOneBoundedNonForceCAS(t *testing.T) {
	const (
		headOne = "1111111111111111111111111111111111111111"
		headTwo = "2222222222222222222222222222222222222222"
		treeOne = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		treeTwo = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	)
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate App key: %v", err)
	}
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})
	var mu sync.Mutex
	patches := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/app/installations/2/access_tokens":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"token":      "installation-token",
				"expires_at": time.Now().Add(time.Hour).UTC(),
			})
		case r.Method == http.MethodGet &&
			r.URL.Path == "/repos/owner/repo/git/ref/heads/main":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"object": map[string]string{"sha": headOne},
			})
		case r.Method == http.MethodGet &&
			r.URL.Path == "/repos/owner/repo/git/commits/"+headOne:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tree": map[string]string{"sha": treeOne},
			})
		case r.Method == http.MethodGet &&
			r.URL.Path == "/repos/owner/repo/git/trees/"+treeOne:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"truncated": false,
				"tree":      []any{},
			})
		case r.Method == http.MethodPost &&
			r.URL.Path == "/repos/owner/repo/git/blobs":
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": "blob-1"})
		case r.Method == http.MethodPost &&
			r.URL.Path == "/repos/owner/repo/git/trees":
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": treeTwo})
		case r.Method == http.MethodPost &&
			r.URL.Path == "/repos/owner/repo/git/commits":
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": headTwo})
		case r.Method == http.MethodPatch &&
			r.URL.Path == "/repos/owner/repo/git/refs/heads/main":
			var body struct {
				SHA   string `json:"sha"`
				Force bool   `json:"force"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode ref update: %v", err)
			}
			if body.SHA != headTwo || body.Force {
				t.Errorf("unsafe ref update: %+v", body)
			}
			mu.Lock()
			patches++
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{})
		default:
			http.Error(w, fmt.Sprintf("unexpected %s %s", r.Method, r.URL.String()), http.StatusNotFound)
		}
	}))
	defer server.Close()

	auth, err := NewAppAuthenticator(
		server.URL,
		"1",
		2,
		privateKeyPEM,
		server.Client(),
	)
	if err != nil {
		t.Fatalf("create App authenticator: %v", err)
	}
	client, err := NewClient(
		server.URL,
		"owner",
		"repo",
		"main",
		auth,
		server.Client(),
	)
	if err != nil {
		t.Fatalf("create repository client: %v", err)
	}
	immutable, err := client.SnapshotAtCommit(
		context.Background(),
		headOne,
	)
	if err != nil {
		t.Fatalf("immutable snapshot failed: %v", err)
	}
	if immutable.Revision() != headOne {
		t.Fatalf("immutable revision = %q", immutable.Revision())
	}
	if _, err := client.SnapshotAtCommit(
		context.Background(),
		"not-a-commit",
	); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("invalid immutable revision was accepted: %v", err)
	}
	err = client.Update(
		context.Background(),
		"test: update",
		func(snapshot *Snapshot) (map[string][]byte, error) {
			if paths := snapshot.Paths(""); len(paths) != 0 {
				t.Fatalf("unexpected initial paths: %v", paths)
			}
			return map[string][]byte{"catalogs/stable.yaml": []byte("version: 1\n")}, nil
		},
	)
	if err != nil {
		t.Fatalf("commit CAS update: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if patches != 1 {
		t.Fatalf("expected one ref CAS update, got %d", patches)
	}
}

func TestClientRejectsOversizedGitHubResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, MaxResponseBytes+1))
	}))
	defer server.Close()
	client := &Client{
		httpClient: server.Client(),
		auth: &AppAuthenticator{
			token:     "cached-token",
			expiresAt: time.Now().Add(time.Hour),
			now:       func() time.Time { return time.Now().UTC() },
		},
	}
	var output map[string]any
	err := client.request(
		context.Background(),
		http.MethodGet,
		server.URL,
		nil,
		&output,
	)
	if !errors.Is(err, ErrUnavailable) ||
		!errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("expected bounded response error, got %v", err)
	}
}
