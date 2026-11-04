package service

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/sandbox"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openTerminalDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&persistence.Conversation{}, &persistence.TerminalSession{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

type fakePtyBridge struct {
	opened sandbox.PtySessionOpen
	data   []byte
	resize [2]uint32
	signal int
	read   *sandbox.PtyRead
}

func (f *fakePtyBridge) Open(_ context.Context, in sandbox.PtySessionOpen) error {
	f.opened = in
	return nil
}
func (f *fakePtyBridge) Write(_ context.Context, _, _ string, data []byte) error {
	f.data = data
	return nil
}
func (f *fakePtyBridge) Read(_ context.Context, _, _ string, cursor uint64, _ uint32) (*sandbox.PtyRead, error) {
	if f.read != nil {
		return f.read, nil
	}
	return &sandbox.PtyRead{State: "running", NextCursor: cursor}, nil
}
func (f *fakePtyBridge) Resize(_ context.Context, _, _ string, c, r uint32) error {
	f.resize = [2]uint32{c, r}
	return nil
}
func (f *fakePtyBridge) Signal(_ context.Context, _, _ string, sig int) error {
	f.signal = sig
	return nil
}
func (f *fakePtyBridge) Close(context.Context, string, string) error { return nil }

func sandboxCreateRequest() *model.CreateTerminalSessionRequest {
	return &model.CreateTerminalSessionRequest{
		SessionId:       "terms-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		ConversationId:  "",
		Command:         "sh",
		ExecutionTarget: model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
		SandboxRef:      "wbox-1",
	}
}

func TestSandboxTerminalCreateOpensProvisionerPty(t *testing.T) {
	db := openTerminalDB(t)
	svc := NewTerminalSessionService()
	svc.SetDB(db)
	bridge := &fakePtyBridge{}
	svc.SetSandboxPtyBridge(bridge)

	row, err := svc.Create(context.Background(), "actor:1", sandboxCreateRequest())
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if row.ExecutionTarget != "workspace_sandbox" || row.SandboxRef != "wbox-1" || row.DeviceID != "" {
		t.Fatalf("row=%+v", row)
	}
	if bridge.opened.SandboxRef != "wbox-1" || bridge.opened.Command != "sh" ||
		bridge.opened.PtyID != row.ID {
		t.Fatalf("open=%+v", bridge.opened)
	}
}

func TestSandboxTerminalProxyFailsClosedWithoutBridge(t *testing.T) {
	db := openTerminalDB(t)
	svc := NewTerminalSessionService()
	svc.SetDB(db)
	if _, err := svc.Create(context.Background(), "actor:1", sandboxCreateRequest()); err == nil {
		t.Fatalf("sandbox create without bridge must fail closed")
	}
	var n int64
	db.Model(&persistence.TerminalSession{}).Count(&n)
	if n != 0 {
		t.Fatalf("failed open must not leave a row, got %d", n)
	}
}

func TestSandboxTerminalReadPersistsExit(t *testing.T) {
	db := openTerminalDB(t)
	svc := NewTerminalSessionService()
	svc.SetDB(db)
	svc.SetSandboxPtyBridge(&fakePtyBridge{
		read: &sandbox.PtyRead{State: "exited", ExitCode: 0, NextCursor: 12, Data: []byte("bye")},
	})
	if _, err := svc.Create(context.Background(), "actor:1", sandboxCreateRequest()); err != nil {
		t.Fatalf("create: %v", err)
	}
	resp, err := svc.SandboxPtyRead(context.Background(), "actor:1",
		&model.SandboxPtyReadRequest{SessionId: "terms-ABCDEFGHIJKLMNOPQRSTUVWXYZ", Cursor: 0, MaxBytes: 256})
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(resp.Data) != "bye" || resp.Status != model.TerminalSessionStatus_TERMINAL_SESSION_STATUS_EXITED {
		t.Fatalf("resp=%+v", resp)
	}
	var row persistence.TerminalSession
	db.Where("id = ?", "terms-ABCDEFGHIJKLMNOPQRSTUVWXYZ").First(&row)
	if row.Status != "exited" || row.EndedAt == nil {
		t.Fatalf("persisted status=%s ended=%v", row.Status, row.EndedAt)
	}
}

func TestSandboxPtyRejectedOnDesktopSession(t *testing.T) {
	db := openTerminalDB(t)
	svc := NewTerminalSessionService()
	svc.SetDB(db)
	svc.SetSandboxPtyBridge(&fakePtyBridge{})
	// Persist a desktop-device row directly.
	if err := db.Create(&persistence.TerminalSession{
		ID: "terms-DESKTOPABCDEFGHIJKLMNOPQR", ActorPTID: "a", ConversationID: "",
		DeviceID: "dev-1", Command: "sh", Status: "running", ExecutionTarget: "desktop_device",
	}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	err := svc.SandboxPtyWrite(context.Background(), "a",
		&model.SandboxPtyWriteRequest{SessionId: "terms-DESKTOPABCDEFGHIJKLMNOPQR", Data: []byte("x")})
	if err == nil {
		t.Fatalf("sandbox PTY write on a desktop session must be rejected")
	}
}
