package sandboxprov

import (
	"context"
	"strings"
	"testing"
)

func TestExecArgs(t *testing.T) {
	args := execArgs(ExecRequest{
		SandboxRef: "ref1", Command: "grep", Args: []string{"status=ok", "f.txt"},
		Cwd: "/workspace", Env: []string{"CI=1", "NO_COLOR=1"},
	})
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"exec -i", "-w /workspace", "-e CI=1", "-e NO_COLOR=1",
		"wbox-ref1 grep status=ok f.txt",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %s", want, joined)
		}
	}
	// Never attach a TTY or run as root implicitly.
	if strings.Contains(joined, "-u root") || strings.Contains(joined, "--privileged") {
		t.Fatalf("exec args must not escalate: %s", joined)
	}
}

func TestInferErrno(t *testing.T) {
	cases := map[string]string{
		"/: Permission denied":                  "EACCES",
		"mkdir /sys/x: Read-only file system":   "EROFS",
		"cat: /nope: No such file or directory": "ENOENT",
		"some weird output":                     "",
	}
	for in, want := range cases {
		if got := inferErrno([]byte(in)); got != want {
			t.Fatalf("inferErrno(%q)=%q want %q", in, got, want)
		}
	}
}

func TestBoundedBuffer(t *testing.T) {
	var b boundedBuffer
	b.limit = 4
	n, err := b.Write([]byte("hello world"))
	if err != nil || n != 11 {
		t.Fatalf("write n=%d err=%v", n, err)
	}
	if string(b.bytes()) != "hell" || !b.truncated {
		t.Fatalf("buf=%q truncated=%v", b.bytes(), b.truncated)
	}
}

func TestExecValidation(t *testing.T) {
	b := NewOCICLIBBackend(Policy{}).WithDockerBinary("/nonexistent-docker-binary-xyz")
	// Missing ref/command rejected as policy before any runtime contact.
	if _, err := b.Exec(context.Background(), ExecRequest{}); err == nil {
		t.Fatalf("expected rejection of empty exec request")
	}
}
