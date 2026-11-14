package sandbox

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"time"
)

// Real-provisioner integration tests. They exercise the Station Go HTTP
// client's JSON wire contract against an actual provisioner + container (the
// unit tests use in-process fakes and the bash gates hit the provisioner
// without the Go client; nothing else covers this seam end to end).
//
// Enabled only when PEERS_SANDBOX_INTEGRATION=1:
//
//	PEERS_SANDBOX_INTEGRATION=1 \
//	PEERS_SANDBOX_PROVISIONER_URL=http://127.0.0.1:18090 \
//	PEERS_SANDBOX_IMAGE=sha256<id> \
//	go test ./subserver/agent/service/sandbox -run Integration -count=1 -v
func integrationClient(t *testing.T) (*HTTPClient, string, string) {
	t.Helper()
	if os.Getenv("PEERS_SANDBOX_INTEGRATION") != "1" {
		t.Skip("set PEERS_SANDBOX_INTEGRATION=1 to run real-provisioner integration tests")
	}
	url := os.Getenv("PEERS_SANDBOX_PROVISIONER_URL")
	image := os.Getenv("PEERS_SANDBOX_IMAGE")
	if url == "" || image == "" {
		t.Fatal("PEERS_SANDBOX_PROVISIONER_URL and PEERS_SANDBOX_IMAGE are required")
	}
	return NewHTTPClient(url, 30*time.Second), url, image
}

func integrationRef() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "goitest" + hex.EncodeToString(b)
}

func liveProofs(ref string) []string { return []string{ref} }

func waitRunning(ctx context.Context, t *testing.T, c *HTTPClient, ref string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		proofs, err := c.Reconcile(ctx, liveProofs(ref))
		if err == nil && len(proofs) == 1 && proofs[0].Running {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("sandbox %s never running: %v", ref, ctx.Err())
		case <-time.After(200 * time.Millisecond):
		}
	}
	t.Fatalf("sandbox %s never reported running", ref)
}

// TestIntegrationExecAndLifecycle verifies allocate, a bounded exec, dormant
// and reconcile over the real HTTP wire.
func TestIntegrationExecAndLifecycle(t *testing.T) {
	client, _, image := integrationClient(t)
	ctx := context.Background()
	ref := integrationRef()
	defer func() { _ = client.Release(ctx, ref, "", true) }()

	if _, err := client.EnsureAllocated(ctx, ref, image, ""); err != nil {
		t.Fatalf("allocate: %v", err)
	}
	waitRunning(ctx, t, client, ref)

	out, err := client.Exec(ctx, ExecCall{
		SandboxRef:     ref,
		Command:        "cat",
		Args:           []string{"/etc/hostname"},
		MaxOutputBytes: 4096,
	})
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if out.ExitCode != 0 || len(out.Stdout) == 0 {
		t.Fatalf("unexpected exec outcome: exit=%d stdout=%q stderr=%q", out.ExitCode, out.Stdout, out.Stderr)
	}

	// DORMANT then cold-start via allocate, exactly as Station reconcile does.
	if err := client.Dormant(ctx, ref); err != nil {
		t.Fatalf("dormant: %v", err)
	}
	if proofs, err := client.Reconcile(ctx, liveProofs(ref)); err != nil || proofs[0].Running {
		t.Fatalf("expected stopped after dormant: %+v err=%v", proofs, err)
	}
	if _, err := client.EnsureAllocated(ctx, ref, image, ""); err != nil {
		t.Fatalf("cold start allocate: %v", err)
	}
	waitRunning(ctx, t, client, ref)
}

// TestIntegrationPtyBridge verifies the interactive PTY wire: open, write,
// read the echo back, signal and close.
func TestIntegrationPtyBridge(t *testing.T) {
	client, _, image := integrationClient(t)
	ctx := context.Background()
	ref := integrationRef()
	pty := "it1"
	defer func() {
		_ = client.ClosePty(ctx, ref, pty)
		_ = client.Release(ctx, ref, "", true)
	}()

	if _, err := client.EnsureAllocated(ctx, ref, image, ""); err != nil {
		t.Fatalf("allocate: %v", err)
	}
	waitRunning(ctx, t, client, ref)

	if err := client.OpenPty(ctx, PtyOpen{
		SandboxRef: ref, PtyID: pty, Command: "sh", Cols: 80, Rows: 24,
	}); err != nil {
		t.Fatalf("open pty: %v", err)
	}
	if err := client.WritePty(ctx, ref, pty, []byte("echo GOPTY-$((6*7))\n")); err != nil {
		t.Fatalf("write pty: %v", err)
	}

	var screen string
	deadline := time.Now().Add(8 * time.Second)
	var cursor uint64
	for time.Now().Before(deadline) {
		read, err := client.ReadPty(ctx, ref, pty, cursor, 8192)
		if err != nil {
			t.Fatalf("read pty: %v", err)
		}
		cursor = read.NextCursor
		screen += string(read.Data)
		if strings.Contains(screen, "GOPTY-42") {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if !strings.Contains(screen, "GOPTY-42") {
		t.Fatalf("pty echo missing, screen=%q", screen)
	}

	// SIGKILL the isolated process group, then close.
	if err := client.SignalPty(ctx, ref, pty, 9); err != nil {
		t.Fatalf("signal pty: %v", err)
	}
	if err := client.ClosePty(ctx, ref, pty); err != nil {
		t.Fatalf("close pty: %v", err)
	}
}
