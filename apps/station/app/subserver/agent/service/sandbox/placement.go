// Package sandbox implements Station-side resolution and allocation for the
// WORKSPACE_SANDBOX execution target (WE-20261104).
//
// Station decides WHERE an executional tool call runs and records the sandbox
// allocation; it never executes the command and never owns a container runtime
// handle. The actual executor behind a sandbox_ref is the independent
// workspace-sandbox-provisioner (wired in WE-S3/S4).
package sandbox

import (
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// Capability id families. Local device capabilities execute on the Desktop
// Rust worker (TW-D4/D5); sandbox capabilities execute in a provisioned
// workspace sandbox (WE-20261104).
const (
	SandboxExecuteCapability = "workspace.sandbox.execute"
	SandboxPtyCapability     = "workspace.sandbox.pty"

	// Per-tool sandbox capabilities keep the same approval granularity as the
	// desktop local tools while routing execution to the Station executor.
	SandboxCapabilityFilesystemRead  = "workspace.sandbox.filesystem.read"
	SandboxCapabilityFilesystemWrite = "workspace.sandbox.filesystem.write"
	SandboxCapabilityFilesystemEdit  = "workspace.sandbox.filesystem.edit"
	SandboxCapabilityShellAllowlist  = "workspace.sandbox.shell.allowlist"

	CapabilityFilesystemRead  = "filesystem.read"
	CapabilityFilesystemList  = "filesystem.list"
	CapabilityFilesystemWrite = "filesystem.write"
	CapabilityFilesystemEdit  = "filesystem.edit"
	CapabilityShellAllowlist  = "shell.allowlist"
)

// sandboxCapabilityPrefix is the WE-D04 execution-surface namespace. Every
// capability id under it executes inside a provisioned workspace sandbox.
const sandboxCapabilityPrefix = "workspace.sandbox."

// SandboxWorkspaceRoot is the in-container mount point of the persistent
// workspace volume and the confinement root for every sandbox tool call.
const SandboxWorkspaceRoot = "/workspace"

// SandboxCapabilityForTool maps a Station-routed local-* tool to its sandbox
// execution-surface capability id. Only the tools the ToolRunner actually
// implements are returned; anything else is not sandbox-routable.
func SandboxCapabilityForTool(toolName string) (string, bool) {
	switch toolName {
	case "local_file_read":
		return SandboxCapabilityFilesystemRead, true
	case "local_file_write":
		return SandboxCapabilityFilesystemWrite, true
	case "local_file_edit":
		return SandboxCapabilityFilesystemEdit, true
	case "local_shell_exec", "local_shell_safe":
		return SandboxCapabilityShellAllowlist, true
	default:
		return "", false
	}
}

// ResolvedCapability is one authorized, already readiness-checked binding that
// backs an executional tool call in the current turn.
type ResolvedCapability struct {
	CapabilityID string
	BindingID    string
	Revision     uint64
	// Ready is the admission-time readiness decision (capability READY gate).
	Ready bool
	// SandboxRef/WorkspaceRoot are populated only for sandbox-family bindings.
	SandboxRef    string
	WorkspaceRoot string
}

// IsSandboxFamily reports whether a capability id executes in a sandbox. The
// whole workspace.sandbox.* execution surface (umbrella gate, PTY, and the
// per-tool filesystem/shell capabilities) is sandbox-routed.
func IsSandboxFamily(capabilityID string) bool {
	return strings.HasPrefix(strings.TrimSpace(capabilityID), sandboxCapabilityPrefix)
}

// IsLocalDeviceFamily reports whether a capability id executes on the Desktop
// device worker.
func IsLocalDeviceFamily(capabilityID string) bool {
	switch capabilityID {
	case CapabilityFilesystemRead, CapabilityFilesystemList,
		CapabilityFilesystemWrite, CapabilityFilesystemEdit,
		CapabilityShellAllowlist:
		return true
	default:
		return false
	}
}

// ResolvePlacement derives the single execution placement for one turn from
// its authorized executional capabilities.
//
// Rules (WE-D04):
//   - local-device family only -> DESKTOP_DEVICE (no readiness needed here; the
//     existing device lease/dispatch gates still apply).
//   - sandbox family -> WORKSPACE_SANDBOX; a READY binding with a non-empty
//     sandbox_ref is required, otherwise SANDBOX_NOT_READY.
//   - both families in one turn -> SANDBOX_EXECUTION_TARGET_FORBIDDEN (mixed
//     execution targets are never allowed; the caller must split the turn).
//   - no executional capability -> UNSPECIFIED placement (non-execution turn).
func ResolvePlacement(caps []ResolvedCapability) (*model.ExecutionPlacement, error) {
	var local, sandbox bool
	var readySandbox *ResolvedCapability
	for i := range caps {
		c := caps[i]
		switch {
		case IsSandboxFamily(c.CapabilityID):
			sandbox = true
			if c.Ready && c.SandboxRef != "" && readySandbox == nil {
				readySandbox = &caps[i]
			}
		case IsLocalDeviceFamily(c.CapabilityID):
			local = true
		}
	}

	if sandbox && local {
		return nil, newTargetForbidden(
			"one turn mixes desktop-device and workspace-sandbox capabilities")
	}
	if !sandbox && !local {
		// Non-execution turn: caller should not dispatch an executional tool.
		return &model.ExecutionPlacement{Target: model.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED}, nil
	}
	if local {
		return &model.ExecutionPlacement{Target: model.ExecutionTarget_EXECUTION_TARGET_DESKTOP_DEVICE}, nil
	}

	if readySandbox == nil {
		return nil, newNotReady(
			"workspace sandbox binding is not READY or has no sandbox_ref")
	}
	c := *readySandbox
	return &model.ExecutionPlacement{
		Target:          model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX,
		SandboxRef:      c.SandboxRef,
		WorkspaceRoot:   c.WorkspaceRoot,
		CapabilityId:    c.CapabilityID,
		BindingId:       c.BindingID,
		BindingRevision: c.Revision,
	}, nil
}

// Guard is the fail-closed admission check used by tool dispatch before a
// WORKSPACE_SANDBOX call is sent to the provisioner.
type Guard struct {
	probe Probe
}

// Probe reports provisioner availability. S2 ships an unavailable
// implementation until the real provisioner client lands in WE-S3/S4.
type Probe func() (available bool, backendKind string, reason string)

func NewGuard(probe Probe) *Guard { return &Guard{probe: probe} }

// Admit validates a resolved sandbox placement against live provisioner
// availability. It never substitutes the desktop: an unavailable/not-ready
// sandbox is a hard failure (WE-D04).
func (g *Guard) Admit(placement *model.ExecutionPlacement) error {
	if placement.Target != model.ExecutionTarget_EXECUTION_TARGET_WORKSPACE_SANDBOX {
		return nil
	}
	if placement.SandboxRef == "" || placement.BindingId == "" {
		return newNotReady("sandbox placement is missing sandbox_ref/binding_id")
	}
	if g == nil || g.probe == nil {
		return newUnavailable("sandbox provisioner is not configured")
	}
	available, _, reason := g.probe()
	if !available {
		return newUnavailable(reason)
	}
	return nil
}

func newUnavailable(reason string) *errcode.BizError {
	return errcode.New(errcode.AgentSandboxUnavailable, http.StatusServiceUnavailable,
		errcode.AgentSandboxUnavailableLocaleKey, nil).
		WithDetail("reason_code", reason)
}

func newNotReady(reason string) *errcode.BizError {
	return errcode.New(errcode.AgentSandboxNotReady, http.StatusConflict,
		errcode.AgentSandboxNotReadyLocaleKey, nil).
		WithDetail("reason_code", reason)
}

func newTargetForbidden(reason string) *errcode.BizError {
	return errcode.New(errcode.AgentSandboxExecutionTargetForbidden, http.StatusUnprocessableEntity,
		errcode.AgentSandboxExecutionTargetForbiddenLocaleKey, nil).
		WithDetail("reason_code", reason)
}
