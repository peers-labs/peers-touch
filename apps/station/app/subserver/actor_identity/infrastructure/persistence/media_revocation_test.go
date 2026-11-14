package persistence

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/mediaaccess"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type deviceMediaFence struct {
	fail  bool
	calls []mediaaccess.Endpoint
}

func (f *deviceMediaFence) RevokeDevice(_ context.Context, actor, device string) error {
	f.calls = append(f.calls, mediaaccess.Endpoint{ActorPTID: actor, DeviceID: device})
	if f.fail {
		return errors.New("SFU unavailable")
	}
	return nil
}
func (*deviceMediaFence) RevokeSessions(context.Context, []string) error { return nil }
func (*deviceMediaFence) ReconcileConversation(context.Context, mediaaccess.ConversationScope) error {
	return nil
}

func TestDeviceRevokeCannotCommitBeforeMediaEjection(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	repository, err := NewRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	actor, device := "ptid:media-owner", "mobile-installation"
	if err := db.Create(&ActorIdentityModel{PTID: actor, PublicKey: make([]byte, 32),
		Fingerprint: make([]byte, 32), ProfileVersion: 3}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ActorDeviceModel{PTID: actor, DeviceID: device,
		HomeStationPeerID: "station-home", PublicKey: make([]byte, 32),
		ProfileVersion: 3, VerificationSource: localVerificationSource}).Error; err != nil {
		t.Fatal(err)
	}
	fence := &deviceMediaFence{fail: true}
	mediaaccess.Register(fence)
	t.Cleanup(func() { mediaaccess.Register(nil) })
	ctx := context.Background()
	_, err = repository.Revoke(ctx, actor, device, 3, time.Now())
	if err == nil {
		t.Fatal("device revoked without confirmed SFU ejection")
	}
	if err := RequireActiveDeviceForMutation(db, DeviceLocator{PTID: actor, DeviceID: device}); err != nil {
		t.Fatalf("failed ejection committed the device revocation: %v", err)
	}
	if len(fence.calls) != 1 || fence.calls[0].ActorPTID != actor || fence.calls[0].DeviceID != device {
		t.Fatalf("media revoke used another endpoint: %v", fence.calls)
	}
	fence.fail = false
	if _, err := repository.Revoke(ctx, actor, device, 3, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := RequireActiveDeviceForMutation(db, DeviceLocator{PTID: actor, DeviceID: device}); err == nil {
		t.Fatal("revoked device can issue another grant")
	}
}
