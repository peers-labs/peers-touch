package delivery_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	sourceStation = "station-source"
	targetStation = "station-target"
	signingKeyID  = "station-key"
)

type testClock struct {
	mu  sync.RWMutex
	now time.Time
}

func newTestClock(now time.Time) *testClock {
	return &testClock{now: now.UTC()}
}

func (c *testClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

func (c *testClock) Set(now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = now.UTC()
}

func (c *testClock) Advance(duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(duration)
}

type ed25519Signer struct {
	keyID      string
	privateKey ed25519.PrivateKey
}

func (s ed25519Signer) KeyID() string {
	return s.keyID
}

func (s ed25519Signer) Sign(_ context.Context, canonical []byte) ([]byte, error) {
	return ed25519.Sign(s.privateKey, canonical), nil
}

type ed25519Verifier struct {
	sourceStationPeerID string
	keyID               string
	publicKey           ed25519.PublicKey
}

func (v ed25519Verifier) Verify(
	_ context.Context,
	sourceStationPeerID string,
	keyID string,
	canonical []byte,
	signature []byte,
) error {
	if sourceStationPeerID != v.sourceStationPeerID || keyID != v.keyID {
		return errors.New("station signing identity does not match")
	}
	if !ed25519.Verify(v.publicKey, canonical, signature) {
		return errors.New("station signature is invalid")
	}
	return nil
}

type frameFixture struct {
	clock    *testClock
	policy   delivery.FramePolicy
	signer   ed25519Signer
	verifier ed25519Verifier
}

func newFrameFixture(t *testing.T) frameFixture {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate test signing key: %v", err)
	}
	now := time.Unix(1_800_000_000, 123_000_000).UTC()
	return frameFixture{
		clock:  newTestClock(now),
		policy: delivery.DefaultFramePolicy(targetStation),
		signer: ed25519Signer{
			keyID:      signingKeyID,
			privateKey: privateKey,
		},
		verifier: ed25519Verifier{
			sourceStationPeerID: sourceStation,
			keyID:               signingKeyID,
			publicKey:           publicKey,
		},
	}
}

func (f frameFixture) signedFrame(
	t *testing.T,
	frameID string,
	idempotencyKey string,
	payloadKind delivery.PayloadKind,
	payloadID string,
	payload proto.Message,
) *delivery.Frame {
	t.Helper()
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	now := f.clock.Now()
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             frameID,
		SourceStationPeerId: sourceStation,
		TargetStationPeerId: targetStation,
		IdempotencyKey:      idempotencyKey,
		PayloadKind:         payloadKind,
		PayloadId:           payloadID,
		OrderingKey:         "lane:" + payloadID,
		OrderingSequence:    1,
		OpaquePayload:       payloadBytes,
		IssuedAt:            timestamppb.New(now),
		ExpiresAt:           timestamppb.New(now.Add(time.Hour)),
	}
	if err := delivery.SignFrame(context.Background(), frame, f.policy, f.signer); err != nil {
		t.Fatalf("sign frame: %v", err)
	}
	return frame
}

func (f frameFixture) stringFrame(
	t *testing.T,
	frameID string,
	idempotencyKey string,
	value string,
) *delivery.Frame {
	t.Helper()
	return f.signedFrame(
		t,
		frameID,
		idempotencyKey,
		delivery.PayloadKindSocialFriendRequestCommand,
		"payload-"+frameID,
		wrapperspb.String(value),
	)
}

func cloneFrame(t *testing.T, frame *delivery.Frame) *delivery.Frame {
	t.Helper()
	cloned, ok := proto.Clone(frame).(*delivery.Frame)
	if !ok {
		t.Fatal("clone did not return a Federation frame")
	}
	return cloned
}

func openSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared&_busy_timeout=5000"),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatalf("open SQLite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("resolve SQLite handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close SQLite: %v", err)
		}
	})
	return db
}

func newSQLiteRepository(
	t *testing.T,
	clock delivery.Clock,
) (*gorm.DB, *delivery.GORMRepository) {
	t.Helper()
	db := openSQLite(t)
	repository, err := delivery.NewGORMRepository(db, clock)
	if err != nil {
		t.Fatalf("create repository: %v", err)
	}
	if err := repository.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate repository: %v", err)
	}
	return db, repository
}

type domainRecord struct {
	ID    string `gorm:"column:id;size:512;primaryKey"`
	Value string `gorm:"column:value;size:512;not null"`
}

func (*domainRecord) TableName() string {
	return "federation_delivery_test_domain"
}
