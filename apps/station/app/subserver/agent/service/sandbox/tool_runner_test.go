package sandbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// scriptedClient emulates minimal in-sandbox file semantics in Go: a virtual
// file map plus passthrough for allowlisted commands. It records ExecCalls so
// tests can assert content goes via stdin and paths stay inside /workspace.
type scriptedClient struct {
	files      map[string][]byte
	calls      []ExecCall
	shellCalls []ExecCall
}

func (c *scriptedClient) Probe(context.Context) (bool, string, string, error) {
	return true, "oci_linux", "", nil
}
func (c *scriptedClient) EnsureAllocated(_ context.Context, _, _, _ string) (string, error) {
	return "vol-1", nil
}
func (c *scriptedClient) Exec(_ context.Context, in ExecCall) (*ExecOutcome, error) {
	c.calls = append(c.calls, in)
	// File/system emulation takes precedence over shell passthrough (cat is in
	// both the shell allowlist and the file-read tool set).
	switch in.Command {
	case "cat":
		if len(in.Args) != 1 {
			return &ExecOutcome{ExitCode: 2}, nil
		}
		content, ok := c.files[in.Args[0]]
		if !ok {
			return &ExecOutcome{ExitCode: 1, OSErrno: "ENOENT", Stderr: []byte("No such file")}, nil
		}
		return &ExecOutcome{ExitCode: 0, Stdout: content}, nil
	case "mkdir":
		return &ExecOutcome{ExitCode: 0}, nil
	case "sh":
		path := in.Args[len(in.Args)-1] // sh -c 'cat > "$1"' -- <path>
		c.files[path] = append([]byte(nil), in.Stdin...)
		return &ExecOutcome{ExitCode: 0}, nil
	}
	if isAllowlistBin(in.Command) {
		c.shellCalls = append(c.shellCalls, in)
		if in.Command == "grep" {
			return &ExecOutcome{ExitCode: 1}, nil // honest non-match
		}
		return &ExecOutcome{ExitCode: 0, Stdout: []byte("ok")}, nil
	}
	return nil, fmt.Errorf("unexpected command %q", in.Command)
}
func (c *scriptedClient) Release(context.Context, string, string, bool) error { return nil }

func isAllowlistBin(c string) bool {
	_, ok := shellAllowlist[c]
	return ok
}

func newToolRunnerFixture() (*ToolRunner, *scriptedClient) {
	store := newFakeStore()
	seq := 0
	alloc := NewAllocator(store, Quota{MaxActivePerActor: 10},
		func() string { seq++; return "wbox" }, func() time.Time { return time.Now() })
	fc := &scriptedClient{files: map[string][]byte{}}
	ex := NewExecutor(ExecutorConfig{Allocator: alloc, Client: fc,
		DefaultImage: "r/u@sha256:" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
	return NewToolRunner(ex), fc
}

func TestConfine(t *testing.T) {
	cases := []struct {
		rel, want string
		ok        bool
	}{
		{"a/b.txt", "/workspace/a/b.txt", true},
		{"./a.txt", "/workspace/a.txt", true},
		{"../escape", "", false},
		{"a/../../b", "", false},
		{"/etc/passwd", "", false},
	}
	for _, c := range cases {
		got, err := confine("/workspace", c.rel)
		if c.ok && err != nil {
			t.Fatalf("confine(%q) err: %v", c.rel, err)
		}
		if c.ok && got != c.want {
			t.Fatalf("confine(%q)=%q want %q", c.rel, got, c.want)
		}
		if !c.ok && err == nil {
			t.Fatalf("confine(%q) expected rejection, got %q", c.rel, got)
		}
	}
}

func TestToolRunnerShellAllowlist(t *testing.T) {
	tr, fc := newToolRunnerFixture()
	p := placementFor("wbox")
	args, _ := json.Marshal(map[string]any{"command": "grep", "args": []string{"x", "f"}})
	res, err := tr.RunTool(context.Background(), "a", "g", p, "local_shell_exec", args)
	if err != nil {
		t.Fatalf("grep: %v", err)
	}
	if res.ExitCode != 1 {
		t.Fatalf("grep exit = %d, want honest 1", res.ExitCode)
	}
	bad, _ := json.Marshal(map[string]any{"command": "bash", "args": []string{"-c", "rm -rf /"}})
	_, err = tr.RunTool(context.Background(), "a", "g", p, "local_shell_exec", bad)
	if bizErr(t, err).Code != errcode.AgentSandboxPermissionDenied {
		t.Fatalf("non-allowlist command code=%v", bizErr(t, err).Code)
	}
	if len(fc.shellCalls) != 1 {
		t.Fatalf("bash must not be executed, calls=%d", len(fc.shellCalls))
	}
}

func TestToolRunnerWriteViaStdinAndDigest(t *testing.T) {
	tr, fc := newToolRunnerFixture()
	p := placementFor("wbox")
	args, _ := json.Marshal(map[string]any{"path": "src/app.txt", "content": "hello"})
	res, err := tr.RunTool(context.Background(), "a", "g", p, "local_file_write", args)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if res.BeforeSHA != "" || res.Changed != true || res.AfterSHA == "" {
		t.Fatalf("write result=%+v", res)
	}
	// Content must travel via stdin, and the path is inside /workspace.
	var found bool
	for _, c := range fc.calls {
		if c.Command == "sh" {
			found = true
			if string(c.Stdin) != "hello" {
				t.Fatalf("stdin content=%q", c.Stdin)
			}
			if c.Args[len(c.Args)-1] != "/workspace/src/app.txt" {
				t.Fatalf("write path=%v", c.Args)
			}
		}
	}
	if !found {
		t.Fatalf("no stdin write recorded")
	}
}

func TestToolRunnerEditUniqueOccurrence(t *testing.T) {
	tr, fc := newToolRunnerFixture()
	fc.files["/workspace/f.txt"] = []byte("fail and fail")
	p := placementFor("wbox")
	// Two occurrences -> rejected without write.
	amb, _ := json.Marshal(map[string]any{"path": "f.txt", "old_string": "fail", "new_string": "ok"})
	if _, err := tr.RunTool(context.Background(), "a", "g", p, "local_file_edit", amb); bizErr(t, err).Code != errcode.AgentSandboxPermissionDenied {
		t.Fatalf("ambiguous edit code=%v", bizErr(t, err).Code)
	}
	// Unique occurrence -> rewritten via stdin; before/after sha differ.
	okArgs, _ := json.Marshal(map[string]any{"path": "f.txt", "old_string": "fail and fail", "new_string": "ok and fail"})
	res, err := tr.RunTool(context.Background(), "a", "g", p, "local_file_edit", okArgs)
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if !res.Changed || res.BeforeSHA == res.AfterSHA {
		t.Fatalf("edit result=%+v", res)
	}
	if string(fc.files["/workspace/f.txt"]) != "ok and fail" {
		t.Fatalf("content=%q", fc.files["/workspace/f.txt"])
	}
}

func TestToolRunnerRejectsNonSandboxPlacement(t *testing.T) {
	tr, _ := newToolRunnerFixture()
	bad := &model.ExecutionPlacement{Target: model.ExecutionTarget_EXECUTION_TARGET_DESKTOP_DEVICE}
	args, _ := json.Marshal(map[string]any{"command": "ls"})
	_, err := tr.RunTool(context.Background(), "a", "g", bad, "local_shell_exec", args)
	if bizErr(t, err).Code != errcode.AgentSandboxExecutionTargetForbidden {
		t.Fatalf("code=%v", bizErr(t, err).Code)
	}
}

func TestToolRunnerUnknownTool(t *testing.T) {
	tr, _ := newToolRunnerFixture()
	_, err := tr.RunTool(context.Background(), "a", "g", placementFor("wbox"), "rm_rf", json.RawMessage(`{}`))
	if bizErr(t, err).Code != errcode.AgentToolUnknown {
		t.Fatalf("code=%v", bizErr(t, err).Code)
	}
}

var _ = errors.New
