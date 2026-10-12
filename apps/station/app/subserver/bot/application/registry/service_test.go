package registry

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type fakeMinter struct {
	calls   int
	avatars map[string]string
}

func (f *fakeMinter) MintAgentActor(_ context.Context, handle, _, _ string) (string, error) {
	f.calls++
	return "ptid:v1:actor:peers:b:" + handle + ":fp" + string(rune('0'+f.calls)), nil
}

func (f *fakeMinter) SetAgentAvatar(_ context.Context, botPtid, avatarURL string) error {
	if f.avatars == nil {
		f.avatars = map[string]string{}
	}
	f.avatars[botPtid] = avatarURL
	return nil
}

func newTestService(t *testing.T) (*Service, *persistence.GormRepo) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := persistence.NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	svc := NewService(repo, &fakeMinter{})
	fixed := time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return fixed }
	return svc, repo
}

const owner = "ptid:v1:actor:peers:p:owner:aaa"

// BOT-A01: create mints an AGENT actor and stores an ACTIVE registry row;
// the plaintext secret is returned once and never persisted.
func TestCreateBot(t *testing.T) {
	svc, repo := newTestService(t)
	ctx := context.Background()

	created, err := svc.Create(ctx, owner, "Claude Code", "peers", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	b := created.Bot
	if b.State != domain.StateActive {
		t.Fatalf("state = %d, want ACTIVE", b.State)
	}
	if b.WebhookID == "" || b.BotPtid == "" || b.OwnerPtid != owner {
		t.Fatalf("identity not populated: %+v", b)
	}
	if b.DeliveryScope != domain.ScopeOwnerOnly {
		t.Fatalf("scope = %d, want OWNER_ONLY", b.DeliveryScope)
	}
	if created.SecretPlaintext == "" {
		t.Fatal("plaintext secret must be returned once")
	}
	if !domain.VerifySecret(b.SecretHash, created.SecretPlaintext) {
		t.Fatal("stored hash does not verify the returned secret")
	}

	// Persisted row carries a hash, never the plaintext.
	stored, err := repo.GetByPtid(ctx, b.BotPtid)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if stored.SecretHash == created.SecretPlaintext {
		t.Fatal("plaintext secret was persisted")
	}
}

// BOT-A05: duplicate active name for the same owner is a typed conflict;
// another owner may use the same display name.
func TestCreateDuplicateName(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()
	if _, err := svc.Create(ctx, owner, "Dup", "peers", ""); err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err := svc.Create(ctx, owner, "Dup", "peers", "")
	de, ok := domain.AsError(err)
	if !ok || de.Code != domain.CodeNameConflict {
		t.Fatalf("want BOT_NAME_CONFLICT, got %v", err)
	}
	if _, err := svc.Create(ctx, "ptid:v1:actor:peers:p:other:bbb", "Dup", "peers", ""); err != nil {
		t.Fatalf("same name for a different owner must be allowed: %v", err)
	}
}

// BOT-A03: rotation keeps identity/history, new secret works, old is rejected.
func TestRotateSecret(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()
	created, _ := svc.Create(ctx, owner, "Rot", "peers", "")
	ptid := created.Bot.BotPtid
	webhookID := created.Bot.WebhookID

	newSecret, err := svc.RotateSecret(ctx, owner, ptid)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if newSecret == created.SecretPlaintext {
		t.Fatal("rotated secret must differ")
	}
	got, err := svc.repo.GetByPtid(ctx, ptid)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.WebhookID != webhookID {
		t.Fatal("webhook id must be stable across rotation")
	}
	if domain.VerifySecret(got.SecretHash, created.SecretPlaintext) {
		t.Fatal("old secret must stop authenticating after rotation")
	}
	if !domain.VerifySecret(got.SecretHash, newSecret) {
		t.Fatal("new secret must authenticate")
	}

	// Rotating a revoked bot is a state conflict.
	if _, err := svc.SetState(ctx, owner, ptid, domain.StateRevoked); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := svc.RotateSecret(ctx, owner, ptid); err == nil {
		t.Fatal("rotation on revoked bot must fail")
	}
}

// BOT-A04 / BOT-A04B: disable and revoke take effect immediately, and revoke
// clears the secret hash while preserving the row.
func TestDisableAndRevoke(t *testing.T) {
	svc, repo := newTestService(t)
	ctx := context.Background()
	created, _ := svc.Create(ctx, owner, "Life", "peers", "")
	ptid := created.Bot.BotPtid

	disabled, err := svc.SetState(ctx, owner, ptid, domain.StateDisabled)
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if disabled.CanIngest() || disabled.DisabledAt == nil {
		t.Fatal("disabled bot must reject ingestion immediately")
	}
	if _, err := svc.SetState(ctx, owner, ptid, domain.StateDisabled); err == nil {
		t.Fatal("disabling twice must be a conflict")
	}

	enabled, err := svc.SetState(ctx, owner, ptid, domain.StateActive)
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !enabled.CanIngest() || enabled.DisabledAt != nil {
		t.Fatal("enabled bot must ingest and clear disabled_at")
	}

	revoked, err := svc.SetState(ctx, owner, ptid, domain.StateRevoked)
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if revoked.CanIngest() || revoked.SecretHash != "" || revoked.RevokedAt == nil {
		t.Fatal("revoked bot must reject ingestion and clear its secret hash")
	}
	stored, _ := repo.GetByPtid(ctx, ptid)
	if stored == nil {
		t.Fatal("revoking must preserve the registry row/history")
	}
}

// SetProfile writes the avatar to the bot actor via the minter, owner-scoped.
func TestSetProfileAvatar(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()
	created, _ := svc.Create(ctx, owner, "Avatar Bot", "peers", "")
	ptid := created.Bot.BotPtid
	minter := svc.minter.(*fakeMinter)

	if _, err := svc.SetProfile(ctx, owner, ptid, "/sub-oss/file?key=ab"); err != nil {
		t.Fatalf("set profile: %v", err)
	}
	if got := minter.avatars[ptid]; got != "/sub-oss/file?key=ab" {
		t.Fatalf("avatar not forwarded to actor minter, got %q", got)
	}
	// Non-owner is indistinguishable from not-found and must not mutate.
	if _, err := svc.SetProfile(ctx, "ptid:v1:actor:peers:p:other:bbb", ptid, "/x"); err == nil {
		t.Fatal("non-owner set-profile must be rejected")
	}
	if got := minter.avatars[ptid]; got != "/sub-oss/file?key=ab" {
		t.Fatalf("non-owner attempt mutated avatar: %q", got)
	}
}
