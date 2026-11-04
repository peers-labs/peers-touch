package sandboxprov

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
)

func TestRunArgsSecurityTranslation(t *testing.T) {
	req := AllocRequest{
		SandboxRef: "wbox-AbC/123", ImageRef: "registry.example.com/peers/sandboxes/u:24.04@sha256:" + strings.Repeat("c", 64),
		VolumeRef: "vol-x", Security: validSpec(),
	}
	args := runArgs(req, "wbox-isolated")
	joined := strings.Join(args, " ")

	mustContain := []string{
		"--user 10001:10001",
		"--read-only",
		"--security-opt no-new-privileges",
		"--cap-drop ALL",
		"--network wbox-isolated",
		"--pids-limit 128",
		"--memory 268435456",
		"wbox-vol-wbox-abc-123:/workspace",
		"sleep infinity",
	}
	for _, m := range mustContain {
		if !strings.Contains(joined, m) {
			t.Fatalf("docker args missing %q\n%s", m, joined)
		}
	}
	if strings.Contains(joined, "--privileged") {
		t.Fatalf("must never pass --privileged")
	}
	// Container name is deterministic and sanitized.
	if !strings.Contains(joined, "--name wbox-wbox-abc-123") {
		t.Fatalf("bad name in args: %s", joined)
	}
}

func TestAllocatePolicyRejectsBeforeRuntime(t *testing.T) {
	p := Policy{AllowedRepositories: []string{"r"}, IsolatedNetwork: "n"}
	b := NewOCICLIBBackend(p).WithRunner(func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
		t.Fatalf("runtime must not be called when policy rejects")
		return nil, nil
	})
	// Mutable tag -> rejected without any docker invocation.
	_, err := b.Allocate(AllocRequest{SandboxRef: "x", VolumeRef: "v", ImageRef: "r/u:latest", Security: validSpec()})
	if !errors.Is(err, ErrPolicyRejected) {
		t.Fatalf("err = %v", err)
	}
}

func TestAllocateIdempotentReattach(t *testing.T) {
	p := Policy{AllowedRepositories: []string{"r"}, IsolatedNetwork: "n"}
	calls := []string{}
	b := NewOCICLIBBackend(p).WithRunner(func(ctx context.Context, name string, args ...string) ([]byte, error) {
		calls = append(calls, args[0])
		// First inspect reports running -> re-attach, no run/volume create.
		if args[0] == "inspect" {
			return []byte("true\n"), nil
		}
		return []byte("ok"), nil
	})
	h, err := b.Allocate(AllocRequest{
		SandboxRef: "ref1", VolumeRef: "vol1",
		ImageRef: "r/u:1@sha256:" + strings.Repeat("d", 64), Security: validSpec(),
	})
	if err != nil {
		t.Fatalf("allocate: %v", err)
	}
	if h.Container != "wbox-ref1" || h.VolumeRef != "vol1" {
		t.Fatalf("handle = %+v", h)
	}
	for _, c := range calls {
		if c == "run" || c == "volume" {
			t.Fatalf("reattach must not run/create, calls=%v", calls)
		}
	}
}

func TestReleaseToleratesMissingAndDeletesVolume(t *testing.T) {
	var ran [][]string
	b := NewOCICLIBBackend(Policy{}).WithRunner(func(ctx context.Context, _ string, args ...string) ([]byte, error) {
		ran = append(ran, args)
		if args[0] == "rm" {
			return nil, errors.New("Error: No such container: wbox-x")
		}
		return []byte("ok"), nil
	})
	if err := b.Release("x", "", false); err != nil {
		t.Fatalf("release: %v", err)
	}
	if len(ran) != 2 || ran[0][0] != "rm" || ran[1][0] != "volume" || ran[1][2] != "wbox-vol-x" {
		t.Fatalf("unexpected calls: %v", ran)
	}
}

func TestProbeMissingRuntimeGivesReason(t *testing.T) {
	b := NewOCICLIBBackend(Policy{}).WithDockerBinary("/nonexistent-docker-binary-xyz")
	ok, reason := b.Probe()
	if ok {
		t.Fatalf("expected unavailable")
	}
	if reason == "" {
		t.Fatalf("unavailable probe must give a reason")
	}
}

func TestProbeDaemonUnreachable(t *testing.T) {
	// docker binary exists in PATH here; force the version call to fail to
	// emulate a reachable CLI with no daemon.
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker CLI not present in this environment")
	}
	b := NewOCICLIBBackend(Policy{}).WithRunner(func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
		return nil, errors.New("cannot connect to the Docker daemon")
	})
	ok, reason := b.Probe()
	if ok || !strings.Contains(reason, "unreachable") {
		t.Fatalf("ok=%v reason=%q", ok, reason)
	}
}
