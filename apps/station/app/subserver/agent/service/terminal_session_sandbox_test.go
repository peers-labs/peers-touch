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

// TestSandboxTerminalProtoRoundTripsPlacement guards the field the Desktop
// panel relies on to choose its PTY path: a created sandbox row must come back
// from List carrying WORKSPACE_SANDBOX + sandbox_ref, and a legacy row with no
// target must surface as DESKTOP_DEVICE (not UNSPECIFIED).
func TestSandboxTerminalProtoRoundTripsPlacement(t *testing.T) {
	db := openTerminalDB(t)
	svc := NewTerminalSessionService()
	svc.SetDB(db)
	svc.SetSandboxPtyBridge(&fakePtyBridge{})

	if _, err := svc.Create(context.Background(), "actor:1", sandboxCreateRequest()); err != nil {
		t.Fatalf("create: %v", err)
	}
	rows, err := svc.List(context.Background(), "actor:1", "")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	proto := TerminalSessionProto(&rows[0])
	if proto.ExecutionTarget != model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX {
		t.Fatalf("target=%v", proto.ExecutionTarget)
	}
	if proto.SandboxRef != "wbox-1" {
		t.Fatalf("sandboxRef=%q", proto.SandboxRef)
	}
}

func TestLegacyTerminalDefaultsToDesktopPlacement(t *testing.T) {
	db := openTerminalDB(t)
	if err := db.Create(&persistence.TerminalSession{
		ID: "terms-LEGACYABCDEFGHIJKLMNOPQ", ActorPTID: "a", ConversationID: "",
		DeviceID: "dev-1", Command: "sh", Status: "running",
		// No execution_target: the column default is desktop_device.
	}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	var row persistence.TerminalSession
	if err := db.Where("id = ?", "terms-LEGACYABCDEFGHIJKLMNOPQ").First(&row).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	proto := TerminalSessionProto(&row)
	if proto.ExecutionTarget != model.ExecutionTarget_EXECUTION_TARGET_DESKTOP_DEVICE {
		t.Fatalf("legacy target=%v, want DESKTOP_DEVICE", proto.ExecutionTarget)
	}
}

// Sandbox reconcile is scoped by sandbox_ref, never device_id: a fresh client
// that cannot yet prove a sandbox PTY alive downgrades only sandbox rows in the
// named sandbox, while desktop rows on another scope stay untouched.
func TestSandboxReconcileScopesBySandboxRef(t *testing.T) {
	db := openTerminalDB(t)
	svc := NewTerminalSessionService()
	svc.SetDB(db)
	svc.SetSandboxPtyBridge(&fakePtyBridge{})

	if _, err := svc.Create(context.Background(), "actor:1", sandboxCreateRequest()); err != nil {
		t.Fatalf("create sandbox: %v", err)
	}
	if err := db.Create(&persistence.TerminalSession{
		ID: "terms-DESKTOPABCDEFGHIJKLMNOPQR", ActorPTID: "actor:1", ConversationID: "",
		DeviceID: "dev-1", Command: "sh", Status: "running", ExecutionTarget: "desktop_device",
	}).Error; err != nil {
		t.Fatalf("seed desktop: %v", err)
	}

	// A sandbox reconcile without a sandbox_ref is an invalid request.
	if _, err := svc.Reconcile(context.Background(), "actor:1", &model.ReconcileTerminalSessionsRequest{
		ExecutionTarget: model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
	}); err == nil {
		t.Fatal("sandbox reconcile without sandbox_ref must be rejected")
	}

	// Boot proves nothing: empty live ids downgrade the sandbox row only.
	rows, err := svc.Reconcile(context.Background(), "actor:1", &model.ReconcileTerminalSessionsRequest{
		ExecutionTarget: model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
		SandboxRef:      "wbox-1",
	})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != "terms-ABCDEFGHIJKLMNOPQRSTUVWXYZ" || rows[0].Status != "unknown" {
		t.Fatalf("sandbox rows=%+v", rows)
	}
	var desktop persistence.TerminalSession
	db.Where("id = ?", "terms-DESKTOPABCDEFGHIJKLMNOPQR").First(&desktop)
	if desktop.Status != "running" {
		t.Fatalf("desktop row must stay running, got %s", desktop.Status)
	}

	// The first successful PTY read proves liveness and restores RUNNING.
	if _, err := svc.SandboxPtyRead(context.Background(), "actor:1",
		&model.SandboxPtyReadRequest{SessionId: "terms-ABCDEFGHIJKLMNOPQRSTUVWXYZ", Cursor: 0, MaxBytes: 256}); err != nil {
		t.Fatalf("read: %v", err)
	}
	var restored persistence.TerminalSession
	db.Where("id = ?", "terms-ABCDEFGHIJKLMNOPQRSTUVWXYZ").First(&restored)
	if restored.Status != "running" || restored.EndedAt != nil {
		t.Fatalf("restored status=%s ended=%v", restored.Status, restored.EndedAt)
	}

	// A reconcile naming the live id keeps the row running.
	proven, err := svc.Reconcile(context.Background(), "actor:1", &model.ReconcileTerminalSessionsRequest{
		ExecutionTarget: model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
		SandboxRef:      "wbox-1",
		LiveSessionIds:  []string{"terms-ABCDEFGHIJKLMNOPQRSTUVWXYZ"},
	})
	if err != nil {
		t.Fatalf("proven reconcile: %v", err)
	}
	if len(proven) != 1 || proven[0].Status != "running" {
		t.Fatalf("proven rows=%+v", proven)
	}
}

type fakeSandboxResolver struct {
	rows []*sandbox.Sandbox
}

func (f *fakeSandboxResolver) ActiveForActor(_ context.Context, _ string) ([]*sandbox.Sandbox, error) {
	return f.rows, nil
}

// Read-only resolution marks only ALLOCATED/DORMANT sandboxes usable and
// never fabricates a ref for REQUESTED/FAILED rows. With no resolver wired it
// fails closed.
func TestResolveActiveSandboxesReadonlyAndFailClosed(t *testing.T) {
	svc := NewTerminalSessionService()
	if _, err := svc.ResolveActiveSandboxes(context.Background(), "actor:1"); err == nil {
		t.Fatal("resolve without a wired resolver must fail closed")
	}

	svc.SetSandboxResolver(&fakeSandboxResolver{rows: []*sandbox.Sandbox{
		{Ref: "wbox-req", ActorPTID: "actor:1", State: sandbox.StateRequested},
		{Ref: "wbox-live", ActorPTID: "actor:1", State: sandbox.StateAllocated},
		{Ref: "wbox-sleep", ActorPTID: "actor:1", State: sandbox.StateDormant},
		{Ref: "wbox-bad", ActorPTID: "actor:1", State: sandbox.StateFailed},
	}})
	resp, err := svc.ResolveActiveSandboxes(context.Background(), "actor:1")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(resp.Sandboxes) != 4 {
		t.Fatalf("want 4 sandboxes, got %d", len(resp.Sandboxes))
	}
	usable := map[string]bool{}
	states := map[string]string{}
	for _, item := range resp.Sandboxes {
		usable[item.SandboxRef] = item.Usable
		states[item.SandboxRef] = item.State
	}
	if usable["wbox-live"] != true || usable["wbox-sleep"] != true {
		t.Fatalf("allocated/dormant must be usable: %+v", usable)
	}
	if usable["wbox-req"] || usable["wbox-bad"] {
		t.Fatalf("requested/failed must not be usable: %+v", usable)
	}
	if states["wbox-live"] != "allocated" || states["wbox-sleep"] != "dormant" {
		t.Fatalf("state vocabulary wrong: %+v", states)
	}
}

// A sandbox create must refuse to carry a device id and require a sandbox ref,
// keeping the two placements mutually exclusive server-side.
func TestSandboxTerminalCreateRejectsMixedIdentity(t *testing.T) {
	db := openTerminalDB(t)
	svc := NewTerminalSessionService()
	svc.SetDB(db)
	svc.SetSandboxPtyBridge(&fakePtyBridge{})

	mixed := sandboxCreateRequest()
	mixed.DeviceId = "dev-1"
	if _, err := svc.Create(context.Background(), "actor:1", mixed); err == nil {
		t.Fatal("sandbox create with device_id must be rejected")
	}
	noRef := sandboxCreateRequest()
	noRef.SandboxRef = ""
	if _, err := svc.Create(context.Background(), "actor:1", noRef); err == nil {
		t.Fatal("sandbox create without sandbox_ref must be rejected")
	}
	var n int64
	db.Model(&persistence.TerminalSession{}).Count(&n)
	if n != 0 {
		t.Fatalf("rejected creates must not persist rows, got %d", n)
	}
}
