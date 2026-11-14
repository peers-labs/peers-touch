package sandbox

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// ToolRunner executes the agent's local-* tool set inside an allocated
// workspace sandbox. It is the WORKSPACE_SANDBOX analogue of the Desktop
// device tool bridge (TW-D4): every effect is bounded, confined to the
// workspace root, and reported with real exit codes and content digests.
//
// User philosophy: the same tool names and approval surface are used on both
// targets; the user sees WHERE it ran (placement) and the OS-level result.
// There is no shell string interpolation: write content travels via stdin and
// file edit is computed in Go, so tool arguments cannot inject commands.
type ToolRunner struct {
	exec *Executor
}

func NewToolRunner(exec *Executor) *ToolRunner { return &ToolRunner{exec: exec} }

// shellAllowlist matches tool_registry_service.local_shell_exec. Commands run
// directly via exec argv (no `/bin/sh -c`), so args cannot spawn subshells
// beyond what the binary itself does inside the isolated workspace.
var shellAllowlist = map[string]struct{}{
	"find": {}, "grep": {}, "rg": {}, "cat": {}, "ls": {},
	"make": {}, "pnpm": {}, "npm": {}, "go": {}, "cargo": {}, "git": {},
}

const maxFileContentBytes = 64 * 1024
const maxToolOutputBytes = 256 * 1024

// ToolResult is the D4-isomorphic bounded result.
type ToolResult struct {
	ExitCode  int
	OSErrno   string
	Stdout    []byte
	Stderr    []byte
	Truncated bool
	BeforeSHA string // content sha256 before a write/edit ("" if file did not exist)
	AfterSHA  string // content sha256 after a write/edit
	Changed   bool   // write/edit changed content
}

// RunTool executes one local-* tool call inside the sandbox of placement.
func (r *ToolRunner) RunTool(ctx context.Context, actorPTID, agentID string, placement *model.ExecutionPlacement, toolName string, rawArgs json.RawMessage) (*ToolResult, error) {
	if placement.Target != model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX || placement.SandboxRef == "" {
		return nil, newTargetForbidden("sandbox tool called without a WORKSPACE_SANDBOX placement")
	}
	root := strings.TrimSpace(placement.WorkspaceRoot)
	if root == "" {
		root = SandboxWorkspaceRoot
	}
	switch toolName {
	case "local_shell_exec", "local_shell_safe":
		return r.runShell(ctx, actorPTID, agentID, placement, rawArgs)
	case "local_file_read":
		return r.runRead(ctx, actorPTID, agentID, placement, root, rawArgs)
	case "local_file_write":
		return r.runWrite(ctx, actorPTID, agentID, placement, root, rawArgs)
	case "local_file_edit":
		return r.runEdit(ctx, actorPTID, agentID, placement, root, rawArgs)
	default:
		return nil, newToolUnsupported(toolName)
	}
}

// RunAgentTool is the Station tool-execution entry point for one authorized,
// readiness-checked local-* call bound to a workspace.sandbox.* capability.
// It lazily ensures the per-(actor, agent, workspace) sandbox is live, builds
// the audited placement (sandbox_ref plus the exact capability/binding the
// gate admitted), and runs the tool. It never executes locally and never falls
// back to the desktop.
func (r *ToolRunner) RunAgentTool(
	ctx context.Context,
	actorPTID, agentID string,
	capabilityID, bindingID string,
	bindingRevision uint64,
	toolName string,
	rawArgs json.RawMessage,
) (*ToolResult, error) {
	if _, ok := SandboxCapabilityForTool(toolName); !ok {
		return nil, newToolUnsupported(toolName)
	}
	row, err := r.exec.EnsureSandbox(ctx, actorPTID, agentID, SandboxWorkspaceRoot)
	if err != nil {
		return nil, err
	}
	placement := &model.ExecutionPlacement{
		Target:          model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
		SandboxRef:      row.Ref,
		WorkspaceRoot:   SandboxWorkspaceRoot,
		CapabilityId:    capabilityID,
		BindingId:       bindingID,
		BindingRevision: bindingRevision,
	}
	return r.RunTool(ctx, actorPTID, agentID, placement, toolName, rawArgs)
}

// toolResultEnvelope is the stable, model-facing JSON rendering of one bounded
// sandbox execution. It is the WORKSPACE_SANDBOX analogue of the desktop D4
// bounded result: real exit code / errno / streams and file-change facts, with
// no success fabrication (a non-zero exit is reported, not raised).
type toolResultEnvelope struct {
	ExitCode  int    `json:"exit_code"`
	OSErrno   string `json:"os_errno,omitempty"`
	Stdout    string `json:"stdout,omitempty"`
	Stderr    string `json:"stderr,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	BeforeSHA string `json:"before_sha,omitempty"`
	AfterSHA  string `json:"after_sha,omitempty"`
	Changed   bool   `json:"changed,omitempty"`
}

// ModelOutput renders the bounded result the model (and tool card) receives.
func (r *ToolResult) ModelOutput() string {
	envelope := toolResultEnvelope{
		ExitCode:  r.ExitCode,
		OSErrno:   r.OSErrno,
		Stdout:    strings.ToValidUTF8(string(r.Stdout), ""),
		Stderr:    strings.ToValidUTF8(string(r.Stderr), ""),
		Truncated: r.Truncated,
		BeforeSHA: r.BeforeSHA,
		AfterSHA:  r.AfterSHA,
		Changed:   r.Changed,
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func (r *ToolRunner) runShell(ctx context.Context, actor, agent string, p *model.ExecutionPlacement, raw json.RawMessage) (*ToolResult, error) {
	var a struct {
		Command string   `json:"command"`
		Args    []string `json:"args"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, newInvalidToolArgs(err.Error())
	}
	base := path.Base(a.Command)
	if _, ok := shellAllowlist[base]; !ok {
		return nil, newToolDenied("command not in shell allowlist: " + base)
	}
	out, err := r.exec.EnsureAndRun(ctx, actor, agent, p.WorkspaceRoot, p, ExecCall{
		Command: base, Args: a.Args, MaxOutputBytes: maxToolOutputBytes,
	})
	if err != nil {
		return nil, err
	}
	return &ToolResult{ExitCode: out.ExitCode, OSErrno: out.OSErrno, Stdout: out.Stdout, Stderr: out.Stderr, Truncated: out.Truncated}, nil
}

func (r *ToolRunner) runRead(ctx context.Context, actor, agent string, p *model.ExecutionPlacement, root string, raw json.RawMessage) (*ToolResult, error) {
	var a struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, newInvalidToolArgs(err.Error())
	}
	abs, err := confine(root, a.Path)
	if err != nil {
		return nil, err
	}
	out, err := r.exec.EnsureAndRun(ctx, actor, agent, p.WorkspaceRoot, p, ExecCall{
		Command: "cat", Args: []string{abs}, MaxOutputBytes: maxToolOutputBytes,
	})
	if err != nil {
		return nil, err
	}
	return &ToolResult{ExitCode: out.ExitCode, OSErrno: out.OSErrno, Stdout: out.Stdout, Stderr: out.Stderr, Truncated: out.Truncated}, nil
}

func (r *ToolRunner) runWrite(ctx context.Context, actor, agent string, p *model.ExecutionPlacement, root string, raw json.RawMessage) (*ToolResult, error) {
	var a struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, newInvalidToolArgs(err.Error())
	}
	if len(a.Content) > maxFileContentBytes {
		return nil, newInvalidToolArgs("content exceeds 64KiB")
	}
	abs, err := confine(root, a.Path)
	if err != nil {
		return nil, err
	}
	before, _ := r.readFile(ctx, actor, agent, p, abs)
	if err := r.ensureParent(ctx, actor, agent, p, abs); err != nil {
		return nil, err
	}
	content := []byte(a.Content)
	if err := r.writeFile(ctx, actor, agent, p, abs, content); err != nil {
		return nil, err
	}
	return &ToolResult{
		BeforeSHA: shaOf(before), AfterSHA: shaOf(content),
		Changed: string(before) != string(content), ExitCode: 0,
	}, nil
}

func (r *ToolRunner) runEdit(ctx context.Context, actor, agent string, p *model.ExecutionPlacement, root string, raw json.RawMessage) (*ToolResult, error) {
	var a struct {
		Path      string `json:"path"`
		OldString string `json:"old_string"`
		NewString string `json:"new_string"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, newInvalidToolArgs(err.Error())
	}
	abs, err := confine(root, a.Path)
	if err != nil {
		return nil, err
	}
	current, readErr := r.readFile(ctx, actor, agent, p, abs)
	if readErr != nil {
		return nil, readErr
	}
	count := strings.Count(string(current), a.OldString)
	if count != 1 {
		return nil, newToolDenied(fmt.Sprintf("old_string must occur exactly once, found %d", count))
	}
	updated := strings.Replace(string(current), a.OldString, a.NewString, 1)
	if len(updated) > maxFileContentBytes {
		return nil, newInvalidToolArgs("result exceeds 64KiB")
	}
	if err := r.writeFile(ctx, actor, agent, p, abs, []byte(updated)); err != nil {
		return nil, err
	}
	return &ToolResult{
		BeforeSHA: shaOf(current), AfterSHA: shaOf([]byte(updated)),
		Changed: a.OldString != a.NewString, ExitCode: 0,
	}, nil
}

// readFile cats an absolute path; a missing file yields nil content with no
// error so write can create it. Other failures are returned.
func (r *ToolRunner) readFile(ctx context.Context, actor, agent string, p *model.ExecutionPlacement, abs string) ([]byte, error) {
	out, err := r.exec.EnsureAndRun(ctx, actor, agent, p.WorkspaceRoot, p, ExecCall{
		Command: "cat", Args: []string{abs}, MaxOutputBytes: maxFileContentBytes + 1,
	})
	if err != nil {
		return nil, err
	}
	if out.ExitCode != 0 {
		if out.OSErrno == "ENOENT" {
			return nil, nil
		}
		return nil, newToolDenied("read failed: " + strings.TrimSpace(string(out.Stderr)))
	}
	if len(out.Stdout) > maxFileContentBytes {
		return nil, newInvalidToolArgs("file exceeds 64KiB")
	}
	return out.Stdout, nil
}

func (r *ToolRunner) ensureParent(ctx context.Context, actor, agent string, p *model.ExecutionPlacement, abs string) error {
	dir := path.Dir(abs)
	out, err := r.exec.EnsureAndRun(ctx, actor, agent, p.WorkspaceRoot, p, ExecCall{
		Command: "mkdir", Args: []string{"-p", dir}, MaxOutputBytes: 4096,
	})
	if err != nil {
		return err
	}
	if out.ExitCode != 0 {
		return newToolDenied("mkdir failed: " + strings.TrimSpace(string(out.Stderr)))
	}
	return nil
}

// writeFile streams content on stdin to `cat > "$1"`; the path is a positional
// argument, never interpolated, and bytes never touch argv or a shell command
// line.
func (r *ToolRunner) writeFile(ctx context.Context, actor, agent string, p *model.ExecutionPlacement, abs string, content []byte) error {
	out, err := r.exec.EnsureAndRun(ctx, actor, agent, p.WorkspaceRoot, p, ExecCall{
		Command: "sh",
		Args:    []string{"-c", "cat > \"$1\"", "--", abs},
		Stdin:   content,
	})
	if err != nil {
		return err
	}
	if out.ExitCode != 0 {
		return newToolDenied("write failed: " + strings.TrimSpace(string(out.Stderr)))
	}
	return nil
}

// confine resolves a workspace-relative path to an absolute path inside root
// and rejects absolute inputs or traversal that escapes the workspace.
func confine(root, rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", newInvalidToolArgs("path is required")
	}
	if path.IsAbs(rel) {
		return "", newToolDenied("absolute paths are not allowed; use workspace-relative paths")
	}
	cleanRoot := path.Clean(root)
	joined := path.Clean(path.Join(cleanRoot, rel))
	if joined != cleanRoot && !strings.HasPrefix(joined, cleanRoot+"/") {
		return "", newToolDenied("path escapes the workspace root")
	}
	return joined, nil
}

func shaOf(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func newToolUnsupported(tool string) *errcode.BizError {
	return errcode.New(errcode.AgentToolUnknown, 422, errcode.AgentToolUnknownLocaleKey, nil).
		WithDetail("tool_id", tool)
}

func newInvalidToolArgs(reason string) *errcode.BizError {
	return errcode.New(errcode.AgentInvalidRequest, 400,
		errcode.AgentSandboxInvalidArgsLocaleKey, nil).
		WithDetail("reason_code", reason)
}

func newToolDenied(reason string) *errcode.BizError {
	return errcode.New(errcode.AgentSandboxPermissionDenied, 422,
		errcode.AgentSandboxPermissionDeniedLocaleKey, nil).WithDetail("reason_code", reason)
}
