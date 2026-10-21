package service_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginpkg"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
)

func openDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:catalog-%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(persistence.AllModels()...); err != nil {
		t.Fatal(err)
	}
	// Shared-cache in-memory SQLite uses table-level locks across
	// connections; serializing the test pool keeps multi-statement
	// transactions and out-of-tx vault writes deadlock-free.
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	return db
}

// buildEcho compiles the shared echo plugin testdata into a package directory
// layout and returns the source directory to import.
func buildEchoPackage(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("subprocess tests unix-only")
	}
	_, thisFile, _, _ := runtime.Caller(0)
	echoSrc := filepath.Join(filepath.Dir(thisFile), "..", "pluginruntime", "testdata", "echo", "main.go")

	src := filepath.Join(t.TempDir(), "echo-pkg", "bin")
	if err := os.MkdirAll(src, 0o700); err != nil {
		t.Fatal(err)
	}
	binPath := filepath.Join(src, "plugin")
	cmd := exec.Command("go", "build", "-o", binPath, echoSrc)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build echo: %v\n%s", err, b)
	}
	pkgRoot := filepath.Dir(src)
	manifest := fmt.Sprintf(`{
		"schemaVersion":1,"id":"echo","name":"Echo","version":"0.1.0",
		"providerKind":"echo",
		"entry":{"%s":{"path":"bin/plugin"}},
		"capabilities":["messaging.receive"],
		"protocol":{"min":1,"max":1}}`, pluginpkg.PlatformKey())
	if err := os.WriteFile(filepath.Join(pkgRoot, "plugin.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	return pkgRoot
}

func newCatalog(t *testing.T) (*channelsvc.Catalog, string) {
	installRoot := filepath.Join(t.TempDir(), "installed")
	installer, err := pluginpkg.NewInstaller(installRoot)
	if err != nil {
		t.Fatal(err)
	}
	return channelsvc.NewCatalog(openDB(t), installer), installRoot
}

func TestImportEnableDisable(t *testing.T) {
	catalog, _ := newCatalog(t)
	ctx := context.Background()

	view, err := catalog.ImportFromDirectory(ctx, buildEchoPackage(t))
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if view.Lifecycle != "registered" || view.Enabled {
		t.Fatalf("new import must be registered/disabled: %+v", view)
	}

	enabled, err := catalog.Enable(ctx, "echo")
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if enabled.Lifecycle != "active" || !enabled.Enabled {
		t.Fatalf("expected active, got %+v", enabled)
	}

	disabled, err := catalog.Disable(ctx, "echo")
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if disabled.Lifecycle != "disabled" || disabled.Enabled {
		t.Fatalf("expected disabled, got %+v", disabled)
	}
}

func TestEnableBadPluginMarksFailedNotActive(t *testing.T) {
	installRoot := filepath.Join(t.TempDir(), "installed")
	installer, _ := pluginpkg.NewInstaller(installRoot)
	db := openDB(t)
	catalog := channelsvc.NewCatalog(db, installer)
	ctx := context.Background()

	// Register a row pointing at a non-runnable path.
	bad := persistence.ChannelPlugin{
		ID: "broken", Name: "Broken", Version: "1", ProviderKind: "echo",
		RootDir: "/nonexistent", ExecPath: "/nonexistent/plugin",
		ProtocolMin: 1, ProtocolMax: 1, Enabled: false, Lifecycle: "registered",
		InstalledAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := db.Create(&bad).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.Enable(ctx, "broken"); err == nil {
		t.Fatal("expected enable to fail for missing executable")
	}
	view, _ := catalog.Get("broken")
	if view.Lifecycle != "failed" || view.Enabled {
		t.Fatalf("expected failed/disabled, got %+v", view)
	}
}

func TestDeleteRemovesProcessAndRecord(t *testing.T) {
	catalog, _ := newCatalog(t)
	ctx := context.Background()
	if _, err := catalog.ImportFromDirectory(ctx, buildEchoPackage(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.Enable(ctx, "echo"); err != nil {
		t.Fatal(err)
	}
	if err := catalog.Delete(ctx, "echo"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := catalog.Get("echo"); !errorsIs(err, channelsvc.ErrPluginNotFound) {
		t.Fatalf("expected not found after delete, got %v", err)
	}
}

func TestRecoverActiveRestartsEnabled(t *testing.T) {
	installRoot := filepath.Join(t.TempDir(), "installed")
	installer, _ := pluginpkg.NewInstaller(installRoot)
	db := openDB(t)
	// Catalog A: import + enable.
	catalogA := channelsvc.NewCatalog(db, installer)
	ctx := context.Background()
	if _, err := catalogA.ImportFromDirectory(ctx, buildEchoPackage(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := catalogA.Enable(ctx, "echo"); err != nil {
		t.Fatal(err)
	}
	// Simulate Station restart: new catalog over same DB, no in-memory process.
	catalogB := channelsvc.NewCatalog(db, installer)
	if failures := catalogB.RecoverActive(ctx); len(failures) != 0 {
		t.Fatalf("recover: %v", failures)
	}
	view, _ := catalogB.Get("echo")
	if view.Lifecycle != "active" {
		t.Fatalf("expected recovery to active, got %+v", view)
	}
}

func TestUnexpectedCrashMarksFailed(t *testing.T) {
	catalog, _ := newCatalog(t)
	ctx := context.Background()
	if _, err := catalog.ImportFromDirectory(ctx, buildEchoPackage(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.Enable(ctx, "echo"); err != nil {
		t.Fatal(err)
	}
	state := catalog.RunningStateForTest("echo")
	if state == nil {
		t.Fatal("expected running state")
	}
	if err := state.KillForTest(); err != nil {
		t.Fatalf("kill: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		view, _ := catalog.Get("echo")
		if view.Lifecycle == "failed" {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("plugin was not marked failed after crash")
}

func errorsIs(err, target error) bool {
	return err == target || (err != nil && err.Error() == target.Error())
}
