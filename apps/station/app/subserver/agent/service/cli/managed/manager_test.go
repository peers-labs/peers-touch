package managed

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/environment"
)

func TestStationCatalogAndManualMachineInstallation(t *testing.T) {
	manager := newManagerForTest(t.TempDir(), "")
	if len(Specs()) != 4 {
		t.Fatal("all four adapters must remain discoverable")
	}
	trae, err := manager.Start(context.Background(), "trae-cli")
	if err != nil || trae.State != StateManualRequired || trae.JobID != "" || trae.ManualURL == "" {
		t.Fatalf("manual adapter = %+v, %v", trae, err)
	}
	for _, id := range []string{"codex-cli", "cursor-cli", "claude-cli"} {
		if snapshot := manager.Snapshot(id, ""); snapshot.State != StateMissing || !snapshot.InstallSupported {
			t.Fatalf("fresh %s = %+v", id, snapshot)
		}
	}
	writeExecutable(t, filepath.Join(manager.Root(), "machine", "traecli"), "#!/bin/sh\nexit 0\n")
	manager.systemPATH = filepath.Join(manager.Root(), "machine")
	if snapshot := manager.Snapshot("trae-cli", ""); snapshot.State != StateReady {
		t.Fatalf("machine TRAE installation = %+v", snapshot)
	}
}

func provisionFakeNode(t *testing.T, manager *Manager, command string) {
	t.Helper()
	env := newInstallEnv(manager.Root())
	nodeOS, nodeArch, err := nodePlatform()
	if err != nil {
		t.Skip(err)
	}
	writeExecutable(t, filepath.Join(env.nodeDir, "bin", "node"), "#!/bin/sh\nexit 0\n")
	npmScript := `#!/usr/bin/env bash
set -euo pipefail
package="${@: -1}"
name="${package%@*}"
mkdir -p "node_modules/$name" node_modules/.bin
printf '{"version":"1.2.3"}' > "node_modules/$name/package.json"
cat > node_modules/.bin/FAKE_COMMAND <<'BIN'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then echo 'fake 1.2.3'; else
  if [ -f "$HOME/actor-marker" ]; then cat "$HOME/actor-marker"; else printf '%s' "$1" > "$HOME/actor-marker"; fi
fi
BIN
chmod +x node_modules/.bin/FAKE_COMMAND
`
	writeExecutable(t, filepath.Join(env.nodeDir, "bin", "npm"), strings.ReplaceAll(npmScript, "FAKE_COMMAND", command))
	if err := writeJSON(filepath.Join(env.nodeDir, ".receipt.json"), nodeReceipt{
		Version: pinnedNodeVersion, OS: nodeOS, Arch: nodeArch,
	}); err != nil {
		t.Fatal(err)
	}
}

func writeExecutable(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func (m *Manager) startJobForTest(spec Spec) *Job {
	job := &Job{ID: "job-test", ProviderID: spec.ProviderID, State: StateInstalling,
		Phase: phaseRuntime, StartedAt: time.Now(), UpdatedAt: time.Now()}
	m.jobs[spec.ProviderID] = job
	return job
}

func TestNPMInstallationIsSharedWhileExecutionStateIsPrivate(t *testing.T) {
	// Shell metacharacters in an installation path must remain literal.
	root := filepath.Join(t.TempDir(), "owner'$(touch poisoned)`echo unsafe`")
	manager := newManagerForTest(root, "")
	spec, _ := FindSpec("codex-cli")
	provisionFakeNode(t, manager, spec.Command)
	job := manager.startJobForTest(spec)
	manager.runInstall(context.Background(), job, spec)
	snapshot := manager.Snapshot(spec.ProviderID, "")
	if snapshot.State != StateReady || snapshot.InstalledVersion != "1.2.3" {
		t.Fatalf("installed snapshot = %+v", snapshot)
	}
	if _, err := os.Stat(filepath.Join(root, "poisoned")); !os.IsNotExist(err) {
		t.Fatal("wrapper evaluated its installation path")
	}
	wrapper := filepath.Join(manager.BinDir(), spec.Command)
	run := func(actor, marker string) string {
		t.Helper()
		state, err := environment.ActorRoot(root, actor)
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(wrapper, marker)
		cmd.Env, err = environment.Build(environment.ToolRoot(state, spec.ProviderID), nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	}
	if out := run("ptid:person:alice", "alice"); out != "" {
		t.Fatalf("first Alice invocation inherited state: %q", out)
	}
	if out := run("ptid:person:bob", "bob"); out != "" {
		t.Fatalf("Bob inherited Alice state: %q", out)
	}
	if out := run("ptid:person:alice", "ignored"); out != "alice" {
		t.Fatalf("Alice state did not persist privately: %q", out)
	}
}

func TestScriptInstallationActivatesRelocatableVendorBinary(t *testing.T) {
	manager := newManagerForTest(t.TempDir(), "")
	spec, _ := FindSpec("cursor-cli")
	stub := "#!/bin/sh\nmkdir -p \"$HOME/.local/bin\" \"$HOME/.local/lib/tool\"\nprintf '#!/bin/sh\\necho cursor-0.1.0\\n' > \"$HOME/.local/lib/tool/agent\"\nchmod +x \"$HOME/.local/lib/tool/agent\"\nln -s \"$HOME/.local/lib/tool/agent\" \"$HOME/.local/bin/agent\"\n"
	original := downloadText
	downloadText = func(context.Context, string) (string, error) { return stub, nil }
	t.Cleanup(func() { downloadText = original })
	job := manager.startJobForTest(spec)
	manager.runInstall(context.Background(), job, spec)
	if snapshot := manager.Snapshot(spec.ProviderID, ""); snapshot.State != StateReady {
		t.Fatalf("script install = %+v", snapshot)
	}
	if _, err := os.Stat(filepath.Join(manager.Root(), "node")); !os.IsNotExist(err) {
		t.Fatal("native installer must not download an unrelated Node runtime")
	}
	raw, err := os.ReadFile(filepath.Join(manager.BinDir(), spec.Command))
	if err != nil || strings.Contains(string(raw), "export HOME=") {
		t.Fatal("shared script wrapper overrides actor HOME")
	}
}

func TestFailedUpgradePreservesPriorActivationAndExposesFailure(t *testing.T) {
	manager := newManagerForTest(t.TempDir(), "")
	spec, _ := FindSpec("codex-cli")
	provisionFakeNode(t, manager, spec.Command)
	job := manager.startJobForTest(spec)
	manager.runInstall(context.Background(), job, spec)
	current := filepath.Join(manager.Root(), "tools", spec.ProviderID, "current")
	previous, err := os.Readlink(current)
	if err != nil {
		t.Fatal(err)
	}
	staging, err := os.MkdirTemp(filepath.Join(manager.Root(), "tools"), ".failed-upgrade-")
	if err != nil {
		t.Fatal(err)
	}
	err = activateTool(context.Background(), newInstallEnv(manager.Root()), spec, staging,
		func(path string, _ *installEnv, _ Spec) error {
			return os.WriteFile(path, []byte("#!/bin/sh\nexit 1\n"), 0o755)
		})
	if err == nil {
		t.Fatal("bad wrapper passed activation verification")
	}
	if restored, err := os.Readlink(current); err != nil || restored != previous {
		t.Fatalf("previous activation was not restored: %q %v", restored, err)
	}
	if err := probeCommand(context.Background(), filepath.Join(manager.BinDir(), spec.Command),
		newInstallEnv(manager.Root()), nil); err != nil {
		t.Fatalf("previous wrapper no longer runs: %v", err)
	}
	job.State, job.Error = StateFailed, "test upgrade failure"
	if snapshot := manager.Snapshot(spec.ProviderID, ""); snapshot.State != StateFailed ||
		snapshot.Error != job.Error || snapshot.InstalledVersion != "1.2.3" {
		t.Fatalf("upgrade failure must retain installed version and retry state: %+v", snapshot)
	}
}

func TestInstallJobDeduplicatesAtStationScope(t *testing.T) {
	manager := newManagerForTest(t.TempDir(), "")
	spec, _ := FindSpec("codex-cli")
	job := manager.startJobForTest(spec)
	first, err := manager.Start(context.Background(), spec.ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Start(context.Background(), spec.ProviderID)
	if err != nil || first.JobID != job.ID || second.JobID != job.ID || len(manager.jobs) != 1 {
		t.Fatalf("install job was not deduplicated: %+v %+v %v", first, second, err)
	}
}

func TestManagerStopClosesWorkersBeforeResume(t *testing.T) {
	manager := newManagerForTest(t.TempDir(), "")
	provisionFakeNode(t, manager, "codex")
	env := newInstallEnv(manager.Root())
	started := filepath.Join(env.nodeDir, "bin", "installer-started")
	writeExecutable(t, env.npmBinary(), "#!/bin/sh\n: > \"$(dirname \"$0\")/installer-started\"\nsleep 30\n")
	if _, err := manager.Start(context.Background(), "codex-cli"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		if _, err := os.Stat(started); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("installer did not start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := manager.Stop(ctx); err != nil {
		t.Fatalf("installer shutdown failed: %v", err)
	}
	if snapshot := manager.Snapshot("codex-cli", ""); snapshot.State != StateFailed {
		t.Fatalf("cancelled job did not settle: %+v", snapshot)
	}
	if _, err := manager.Start(context.Background(), "codex-cli"); err == nil {
		t.Fatal("stopped Manager accepted a new job")
	}
	staged, _ := filepath.Glob(filepath.Join(manager.Root(), "tools", ".codex-cli-install-*"))
	if len(staged) != 0 {
		t.Fatal("cancelled installation retained staged files")
	}
	if err := manager.Resume(); err != nil {
		t.Fatal(err)
	}
	provisionFakeNode(t, manager, "codex")
	if _, err := manager.Start(context.Background(), "codex-cli"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Stop(context.Background()) })
	deadline = time.Now().Add(time.Second)
	for manager.Snapshot("codex-cli", "").State == StateInstalling {
		if time.Now().After(deadline) {
			t.Fatal("retry did not settle")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if manager.Snapshot("codex-cli", "").State != StateReady {
		t.Fatal("retry did not activate a verified adapter")
	}
}
