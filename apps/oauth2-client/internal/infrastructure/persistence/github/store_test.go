package githubstore

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
)

func TestStoreCompletesAuthorizationAcrossInstances(t *testing.T) {
	fixture := newGitDataFixture(t)
	first := fixture.newStore(t, "v1", map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)})
	second := fixture.newStore(t, "v1", map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)})
	now := time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "raw-state-secret",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		ReturnTo:  "peers-touch://oauth/callback",
		Verifier:  "pkce-verifier-secret",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := first.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	loaded, err := second.FindAuthorization(context.Background(), session.State)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Verifier != session.Verifier {
		t.Fatalf("transaction did not survive store instance change: %#v", loaded)
	}
	completion := entity.AuthorizationCompletion{
		State:           session.State,
		CompletionID:    "code-fingerprint",
		CodeFingerprint: "code-fingerprint",
		Identity: entity.ProviderIdentity{
			ProviderUserID: "42",
			Username:       "alice",
			Email:          "alice@example.com",
		},
		Tokens: entity.TokenSet{
			AccessToken:  "access-token-secret",
			RefreshToken: "refresh-token-secret",
			TokenType:    "Bearer",
			ObtainedAt:   now.Add(time.Minute),
		},
		CompletedAt: now.Add(time.Minute),
	}
	identity, err := second.CompleteAuthorization(context.Background(), completion)
	if err != nil {
		t.Fatal(err)
	}
	if identity.LoginCount != 1 || identity.IdentityID == "" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
	commitsAfterSuccess := fixture.commitCount()
	replayed, err := first.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: completion.CompletionID,
		CompletedAt:  now.Add(2 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if replayed.IdentityID != identity.IdentityID {
		t.Fatalf("idempotent replay returned another identity: %#v", replayed)
	}
	if fixture.commitCount() != commitsAfterSuccess {
		t.Fatal("idempotent replay created another commit")
	}
	if _, err := first.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: "different-code",
		CompletedAt:  now.Add(2 * time.Minute),
	}); err != repository.ErrAuthorizationConsumed {
		t.Fatalf("expected consumed error, got %v", err)
	}
	for path, content := range fixture.files() {
		if strings.Contains(path, session.State) {
			t.Fatalf("raw state leaked into path %s", path)
		}
		for _, secret := range []string{
			session.State,
			session.Verifier,
			completion.Tokens.AccessToken,
			completion.Tokens.RefreshToken,
		} {
			if bytes.Contains(content, []byte(secret)) {
				t.Fatalf("secret leaked into repository payload at %s", path)
			}
		}
		kind, ok := recordKindForPath(path)
		if !ok {
			t.Fatalf("unknown record path: %s", path)
		}
		plaintext, _, err := first.codec.Decrypt(kind, path, content)
		if err != nil {
			t.Fatal(err)
		}
		if kind != credentialKind {
			for _, secret := range []string{
				session.State,
				completion.Tokens.AccessToken,
				completion.Tokens.RefreshToken,
			} {
				if bytes.Contains(plaintext, []byte(secret)) {
					t.Fatalf("secret leaked into %s plaintext schema", kind)
				}
			}
		}
		if kind == auditKind && bytes.Contains(plaintext, []byte(session.Verifier)) {
			t.Fatal("verifier leaked into audit plaintext")
		}
	}
	snapshot, err := first.AdminSnapshot(context.Background(), 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Identities) != 1 || len(snapshot.Events) != 2 {
		t.Fatalf("unexpected admin snapshot: %#v", snapshot)
	}
	if !snapshot.Identities[0].HasRefreshToken {
		t.Fatal("refresh-token presence was not projected")
	}
	t.Run("oversized successful response", assertGitHubResponseOverflow)
	t.Run("truncated recursive tree", assertTruncatedTreeTraversal)
	t.Run("oversized recursive tree", assertOversizedRecursiveTreeTraversal)
}

func assertGitHubResponseOverflow(t *testing.T) {
	fixture := newGitDataFixture(t)
	client := fixture.newClient(t)
	var output map[string]any
	err := client.request(
		context.Background(),
		http.MethodGet,
		client.repoPath("/oversized"),
		nil,
		&output,
	)
	if !errors.Is(err, errGitHubResponseTooLarge) ||
		!errors.Is(err, repository.ErrStorageUnavailable) {
		t.Fatalf("expected bounded overflow error, got %v", err)
	}
}

func assertTruncatedTreeTraversal(t *testing.T) {
	assertTreeTraversalFallback(t, true, false)
}

func assertOversizedRecursiveTreeTraversal(t *testing.T) {
	assertTreeTraversalFallback(t, false, true)
}

func assertTreeTraversalFallback(t *testing.T, truncated, oversized bool) {
	fixture := newGitDataFixture(t)
	fixture.mu.Lock()
	fixture.truncateRecursive = truncated
	fixture.oversizeRecursive = oversized
	fixture.trees["tree-0"] = map[string]string{"oauth-data": "tree-1"}
	fixture.treeTypes["tree-0"] = map[string]string{"oauth-data": "tree"}
	fixture.trees["tree-1"] = map[string]string{"records": "tree-2"}
	fixture.treeTypes["tree-1"] = map[string]string{"records": "tree"}
	fixture.trees["tree-2"] = map[string]string{"identity.json": "blob-existing"}
	fixture.blobs["blob-existing"] = []byte("encrypted-record")
	fixture.mu.Unlock()

	snapshot, err := fixture.newClient(t).snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.entries["oauth-data/records/identity.json"] != "blob-existing" {
		t.Fatalf("nested tree entry missing: %#v", snapshot.entries)
	}
	fixture.mu.Lock()
	nonRecursiveRequests := fixture.nonRecursiveTreeRequests
	fixture.mu.Unlock()
	if nonRecursiveRequests != 3 {
		t.Fatalf("expected three bounded tree requests, got %d", nonRecursiveRequests)
	}
}

func TestStoreConvergesAfterLostRefUpdateResponse(t *testing.T) {
	fixture := newGitDataFixture(t)
	store := fixture.newStore(t, "v1", map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)})
	now := time.Date(2026, 9, 30, 2, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGoogle,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	fixture.abortAfterNextRefUpdate()
	identity, err := store.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:           session.State,
		CompletionID:    "same-operation",
		CodeFingerprint: "same-operation",
		Identity:        entity.ProviderIdentity{ProviderUserID: "subject"},
		Tokens:          entity.TokenSet{AccessToken: "token", ObtainedAt: now},
		CompletedAt:     now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if identity == nil || identity.LoginCount != 1 {
		t.Fatalf("lost-response retry did not converge: %#v", identity)
	}
	snapshot, err := store.AdminSnapshot(context.Background(), 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Events) != 2 {
		t.Fatalf("expected one start and one success event, got %d", len(snapshot.Events))
	}
}

func TestStoreConvergesRefreshAfterLostRefUpdateResponse(t *testing.T) {
	fixture := newGitDataFixture(t)
	store := fixture.newStore(t, "v1", map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)})
	now := time.Date(2026, 9, 30, 2, 30, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "refresh-state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGoogle,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	identity, err := store.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: "login-operation",
		Identity:     entity.ProviderIdentity{ProviderUserID: "subject"},
		Tokens: entity.TokenSet{
			AccessToken:  "access-old",
			RefreshToken: "refresh-old",
			ObtainedAt:   now,
		},
		CompletedAt: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}

	fixture.abortAfterNextRefUpdate()
	refreshed, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "refresh-operation",
		ExpectedGeneration: 1,
		Tokens: entity.TokenSet{
			AccessToken: "access-new",
			ObtainedAt:  now.Add(2 * time.Minute),
		},
		RefreshedAt: now.Add(2 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Generation != 2 ||
		refreshed.RefreshToken != "refresh-old" ||
		refreshed.LastRefreshOperationID != "refresh-operation" {
		t.Fatalf("lost refresh response did not converge: %#v", refreshed)
	}
	commitsAfterRefresh := fixture.commitCount()
	duplicate, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "refresh-operation",
		ExpectedGeneration: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if duplicate.Generation != 2 || fixture.commitCount() != commitsAfterRefresh {
		t.Fatalf("duplicate refresh mutated storage: %#v", duplicate)
	}
	secondOperation, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "refresh-operation-2",
		ExpectedGeneration: 2,
		Tokens: entity.TokenSet{
			AccessToken: "access-newer",
			ObtainedAt:  now.Add(3 * time.Minute),
		},
		RefreshedAt: now.Add(3 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if secondOperation.Generation != 3 {
		t.Fatalf("second refresh did not advance generation: %#v", secondOperation)
	}
	commitsAfterSecondOperation := fixture.commitCount()
	if _, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "stale-refresh",
		ExpectedGeneration: 2,
		Tokens: entity.TokenSet{
			AccessToken: "must-not-commit",
			ObtainedAt:  now.Add(4 * time.Minute),
		},
		RefreshedAt: now.Add(4 * time.Minute),
	}); !errors.Is(err, repository.ErrCredentialGeneration) {
		t.Fatalf("expected stale generation rejection, got %v", err)
	}
	if fixture.commitCount() != commitsAfterSecondOperation {
		t.Fatal("stale refresh created a repository commit")
	}
	if _, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "stale-refresh",
		ExpectedGeneration: 2,
		Tokens: entity.TokenSet{
			AccessToken: "must-not-commit",
			ObtainedAt:  now.Add(4 * time.Minute),
		},
		RefreshedAt: now.Add(4 * time.Minute),
	}); !errors.Is(err, repository.ErrCredentialGeneration) {
		t.Fatalf("expected stale generation rejection, got %v", err)
	}
	if fixture.commitCount() != commitsAfterSecondOperation {
		t.Fatal("stale refresh created a repository commit")
	}
	olderDuplicate, err := store.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         identity.IdentityID,
		OperationID:        "refresh-operation",
		ExpectedGeneration: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if olderDuplicate.Generation != 3 ||
		olderDuplicate.AccessToken != "access-newer" ||
		fixture.commitCount() != commitsAfterSecondOperation {
		t.Fatalf("older duplicate refresh mutated storage: %#v", olderDuplicate)
	}
	snapshot, err := store.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	refreshEvents := 0
	for _, event := range snapshot.Events {
		if event.EventType == entity.AuditCredentialRefreshed {
			refreshEvents++
		}
	}
	if refreshEvents != 2 {
		t.Fatalf("expected two refresh events, got %d", refreshEvents)
	}
}

func TestGitDataRetriesConflictAndRefreshesInstallationToken(t *testing.T) {
	fixture := newGitDataFixture(t)
	store := fixture.newStore(t, "v1", map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)})
	fixture.rejectNextRepositoryAuth()
	fixture.conflictAfterNextCommit()
	now := time.Date(2026, 9, 30, 3, 0, 0, 0, time.UTC)
	if err := store.CreateAuthorization(context.Background(), entity.AuthSession{
		State:     "state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.installationRequests != 2 {
		t.Fatalf("expected installation token refresh, got %d requests", fixture.installationRequests)
	}
	if fixture.patchRequests != 2 {
		t.Fatalf("expected one CAS retry, got %d ref updates", fixture.patchRequests)
	}
	if !fixture.forceValuesValid {
		t.Fatal("branch update did not keep force=false")
	}
}

func TestRotateEncryptionCoversEveryRecordClass(t *testing.T) {
	fixture := newGitDataFixture(t)
	oldKey := bytes.Repeat([]byte{1}, 32)
	newKey := bytes.Repeat([]byte{2}, 32)
	oldStore := fixture.newStore(t, "v1", map[string][]byte{"v1": oldKey})
	now := time.Date(2026, 9, 30, 4, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "rotation-state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := oldStore.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	if _, err := oldStore.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: "completion",
		Identity:     entity.ProviderIdentity{ProviderUserID: "42"},
		Tokens: entity.TokenSet{
			AccessToken:  "access-secret",
			RefreshToken: "refresh-secret",
			ObtainedAt:   now,
		},
		CompletedAt: now.Add(time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := oldStore.ReplaceCredential(context.Background(), entity.CredentialRefresh{
		IdentityID:         oldStore.identityID("main", string(valueobject.ProviderGitHub), "42"),
		OperationID:        "rotation-refresh",
		ExpectedGeneration: 1,
		Tokens: entity.TokenSet{
			AccessToken:  "access-rotated",
			RefreshToken: "refresh-rotated",
			ObtainedAt:   now.Add(2 * time.Minute),
		},
		RefreshedAt: now.Add(2 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}

	rotatingStore := fixture.newStore(t, "v2", map[string][]byte{
		"v1": oldKey,
		"v2": newKey,
	})
	totalRotated := 0
	for pass := 0; pass < 10; pass++ {
		result, err := rotatingStore.RotateEncryption(context.Background(), 2)
		if err != nil {
			t.Fatal(err)
		}
		totalRotated += result.Rotated
		if result.Rotated < 2 {
			break
		}
	}
	if totalRotated != 7 {
		t.Fatalf("expected seven rotated records, got %d", totalRotated)
	}
	commitsAfterRotation := fixture.commitCount()
	second, err := rotatingStore.RotateEncryption(context.Background(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if second.Rotated != 0 || fixture.commitCount() != commitsAfterRotation {
		t.Fatalf("second rotation was not a no-op: %#v", second)
	}
	for path, payload := range fixture.files() {
		var envelope recordcrypto.Envelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.KeyID != "v2" {
			t.Fatalf("record %s still uses key %s", path, envelope.KeyID)
		}
	}
}

func TestRotateEncryptionUnknownKeyFailsClosed(t *testing.T) {
	fixture := newGitDataFixture(t)
	oldStore := fixture.newStore(t, "v1", map[string][]byte{
		"v1": bytes.Repeat([]byte{1}, 32),
	})
	now := time.Date(2026, 9, 30, 5, 0, 0, 0, time.UTC)
	if err := oldStore.CreateAuthorization(context.Background(), entity.AuthSession{
		State:     "unknown-key-state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	rotatingStore := fixture.newStore(t, "v2", map[string][]byte{
		"v2": bytes.Repeat([]byte{2}, 32),
	})
	result, err := rotatingStore.RotateEncryption(context.Background(), 100)
	if !errors.Is(err, repository.ErrKeyUnavailable) {
		t.Fatalf("expected unknown-key failure, got result=%#v err=%v", result, err)
	}
	if result.Failed == 0 || result.Rotated != 0 {
		t.Fatalf("unexpected failure counts: %#v", result)
	}
}

type gitDataFixture struct {
	t      *testing.T
	server *httptest.Server

	mu                       sync.Mutex
	head                     string
	commitTrees              map[string]string
	commitParents            map[string]string
	trees                    map[string]map[string]string
	treeTypes                map[string]map[string]string
	blobs                    map[string][]byte
	sequence                 int
	commitTotal              int
	truncateRecursive        bool
	oversizeRecursive        bool
	nonRecursiveTreeRequests int
	abortNextPatch           bool
	conflictNextPatch        bool
	failNextRepoAuth         bool
	installationRequests     int
	patchRequests            int
	forceValuesValid         bool
}

func newGitDataFixture(t *testing.T) *gitDataFixture {
	t.Helper()
	fixture := &gitDataFixture{
		t:                t,
		head:             "commit-0",
		commitTrees:      map[string]string{"commit-0": "tree-0"},
		commitParents:    map[string]string{"commit-0": ""},
		trees:            map[string]map[string]string{"tree-0": {}},
		treeTypes:        map[string]map[string]string{"tree-0": {}},
		blobs:            make(map[string][]byte),
		forceValuesValid: true,
	}
	fixture.server = httptest.NewServer(http.HandlerFunc(fixture.serveHTTP))
	t.Cleanup(fixture.server.Close)
	return fixture
}

func (f *gitDataFixture) rejectNextRepositoryAuth() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failNextRepoAuth = true
}

func (f *gitDataFixture) conflictAfterNextCommit() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.conflictNextPatch = true
}

func (f *gitDataFixture) newClient(t *testing.T) *Client {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	privateDER := x509.MarshalPKCS1PrivateKey(privateKey)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: privateDER})
	auth, err := NewAppAuthenticator(f.server.URL, "1", 2, privatePEM, f.server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client, err := NewClient(f.server.URL, "owner", "repo", "data", auth, f.server.Client())
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func (f *gitDataFixture) newStore(t *testing.T, activeKey string, keys map[string][]byte) *Store {
	t.Helper()
	codec, err := recordcrypto.NewCodec(activeKey, keys)
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(
		f.newClient(t),
		codec,
		recordcrypto.NewFingerprinter(bytes.Repeat([]byte{3}, 32)),
		recordcrypto.NewFingerprinter(bytes.Repeat([]byte{4}, 32)),
	)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func (f *gitDataFixture) abortAfterNextRefUpdate() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.abortNextPatch = true
}

func (f *gitDataFixture) commitCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.commitTotal
}

func (f *gitDataFixture) files() map[string][]byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make(map[string][]byte)
	for path, sha := range f.trees[f.commitTrees[f.head]] {
		result[path] = append([]byte(nil), f.blobs[sha]...)
	}
	return result
}

func (f *gitDataFixture) serveHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")

	if r.URL.Path == "/app/installations/2/access_tokens" && r.Method == http.MethodPost {
		authorization := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(strings.Split(authorization, ".")) != 3 {
			f.t.Errorf("installation token request did not use an App JWT")
		}
		f.installationRequests++
		writeFixtureJSON(w, map[string]any{
			"token":      fmt.Sprintf("installation-token-%d", f.installationRequests),
			"expires_at": time.Now().Add(time.Hour).UTC(),
		})
		return
	}
	const repoPrefix = "/repos/owner/repo"
	path := strings.TrimPrefix(r.URL.Path, repoPrefix)
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer installation-token-") {
		f.t.Errorf("repository request did not use an installation token")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if f.failNextRepoAuth {
		f.failNextRepoAuth = false
		http.Error(w, "expired", http.StatusUnauthorized)
		return
	}
	switch {
	case path == "/oversized" && r.Method == http.MethodGet:
		_, _ = w.Write(bytes.Repeat([]byte("x"), maxGitHubResponseBytes+1))
	case path == "/git/ref/heads/data" && r.Method == http.MethodGet:
		writeFixtureJSON(w, map[string]any{"object": map[string]string{"sha": f.head}})
	case strings.HasPrefix(path, "/git/commits/") && r.Method == http.MethodGet:
		sha := strings.TrimPrefix(path, "/git/commits/")
		writeFixtureJSON(w, map[string]any{"tree": map[string]string{"sha": f.commitTrees[sha]}})
	case strings.HasPrefix(path, "/git/trees/") && r.Method == http.MethodGet:
		treeSHA := strings.TrimPrefix(path, "/git/trees/")
		if r.URL.Query().Get("recursive") == "1" && f.oversizeRecursive {
			_, _ = w.Write(bytes.Repeat([]byte("x"), maxGitHubResponseBytes+1))
			return
		}
		if r.URL.Query().Get("recursive") == "1" && f.truncateRecursive {
			writeFixtureJSON(w, map[string]any{"truncated": true, "tree": []any{}})
			return
		}
		if r.URL.Query().Get("recursive") == "" {
			f.nonRecursiveTreeRequests++
		}
		entries := make([]map[string]string, 0)
		for recordPath, sha := range f.trees[treeSHA] {
			entryType := f.treeTypes[treeSHA][recordPath]
			if entryType == "" {
				entryType = "blob"
			}
			entries = append(entries, map[string]string{
				"path": recordPath,
				"type": entryType,
				"mode": "100644",
				"sha":  sha,
			})
		}
		writeFixtureJSON(w, map[string]any{"truncated": false, "tree": entries})
	case strings.HasPrefix(path, "/git/blobs/") && r.Method == http.MethodGet:
		sha := strings.TrimPrefix(path, "/git/blobs/")
		writeFixtureJSON(w, map[string]string{
			"encoding": "base64",
			"content":  base64.StdEncoding.EncodeToString(f.blobs[sha]),
		})
	case path == "/git/blobs" && r.Method == http.MethodPost:
		var input struct {
			Content string `json:"content"`
		}
		decodeFixtureJSON(f.t, r, &input)
		content, err := base64.StdEncoding.DecodeString(input.Content)
		if err != nil {
			f.t.Fatal(err)
		}
		sha := f.next("blob")
		f.blobs[sha] = content
		writeFixtureJSON(w, map[string]string{"sha": sha})
	case path == "/git/trees" && r.Method == http.MethodPost:
		var input struct {
			BaseTree string `json:"base_tree"`
			Tree     []struct {
				Path string `json:"path"`
				SHA  string `json:"sha"`
			} `json:"tree"`
		}
		decodeFixtureJSON(f.t, r, &input)
		next := make(map[string]string)
		for recordPath, sha := range f.trees[input.BaseTree] {
			next[recordPath] = sha
		}
		for _, entry := range input.Tree {
			next[entry.Path] = entry.SHA
		}
		sha := f.next("tree")
		f.trees[sha] = next
		f.treeTypes[sha] = make(map[string]string, len(next))
		for recordPath := range next {
			f.treeTypes[sha][recordPath] = "blob"
		}
		writeFixtureJSON(w, map[string]string{"sha": sha})
	case path == "/git/commits" && r.Method == http.MethodPost:
		var input struct {
			Tree    string   `json:"tree"`
			Parents []string `json:"parents"`
		}
		decodeFixtureJSON(f.t, r, &input)
		sha := f.next("commit")
		f.commitTrees[sha] = input.Tree
		f.commitParents[sha] = input.Parents[0]
		f.commitTotal++
		writeFixtureJSON(w, map[string]string{"sha": sha})
	case path == "/git/refs/heads/data" && r.Method == http.MethodPatch:
		var input struct {
			SHA   string `json:"sha"`
			Force bool   `json:"force"`
		}
		decodeFixtureJSON(f.t, r, &input)
		f.patchRequests++
		f.forceValuesValid = f.forceValuesValid && !input.Force
		if f.conflictNextPatch {
			f.conflictNextPatch = false
			http.Error(w, "conflict", http.StatusUnprocessableEntity)
			return
		}
		if f.commitParents[input.SHA] != f.head {
			http.Error(w, "conflict", http.StatusUnprocessableEntity)
			return
		}
		f.head = input.SHA
		if f.abortNextPatch {
			f.abortNextPatch = false
			panic(http.ErrAbortHandler)
		}
		writeFixtureJSON(w, map[string]string{"ref": "refs/heads/data"})
	default:
		http.NotFound(w, r)
	}
}

func (f *gitDataFixture) next(prefix string) string {
	f.sequence++
	return fmt.Sprintf("%s-%d", prefix, f.sequence)
}

func writeFixtureJSON(w http.ResponseWriter, value any) {
	if err := json.NewEncoder(w).Encode(value); err != nil {
		panic(err)
	}
}

func decodeFixtureJSON(t *testing.T, r *http.Request, output any) {
	t.Helper()
	if err := json.NewDecoder(r.Body).Decode(output); err != nil {
		t.Fatal(err)
	}
}
