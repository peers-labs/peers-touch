// Package sandboxprov is the workspace-sandbox-provisioner core (WE-20261104).
//
// It is the ONLY component that holds a container runtime handle. Station
// never imports or embeds it. The package is deliberately stdlib-only and
// contains no Station business/database logic. The phase-1 OCI backend drives
// the docker CLI; the Backend interface lets a containerd/microVM backend
// replace it without changing callers.
package sandboxprov

import (
	"context"
	"errors"
)

// SecuritySpec is the platform-independent security intent. Every backend
// MUST translate all of it into strong native primitives. If a backend cannot
// satisfy any field, Allocate fails closed (no weak-isolation downgrade).
type SecuritySpec struct {
	NonRoot             bool
	NoNewPrivileges     bool
	ReadOnlyRootfs      bool
	DropCapabilities    []string
	SeccompProfile      string
	IsolateStationNet   bool
	EgressHostAllowlist []string
	Quota               Quota
	// WorkspaceMountTarget is fixed to /workspace inside the container.
	WorkspaceMountTarget string
	// ContainerRunUID/GID run the workload unprivileged (must be non-zero).
	RunUID int
	RunGID int
}

type Quota struct {
	CPUMillis   int64
	MemoryBytes int64
	PidsLimit   int64
}

// AllocRequest is a validated allocation request.
type AllocRequest struct {
	SandboxRef string
	ActorPTID  string
	ImageRef   string
	VolumeRef  string
	Security   SecuritySpec
}

// Handle identifies a running/allocated sandbox on the backend.
type Handle struct {
	SandboxRef  string
	Container   string
	BackendKind string
	VolumeRef   string
}

var (
	// ErrUnavailable means the host has no usable container runtime.
	ErrUnavailable = errors.New("sandboxprov: container runtime unavailable")
	// ErrPolicyRejected means the image/spec is not allowed (never attempt run).
	ErrPolicyRejected = errors.New("sandboxprov: policy rejected request")
	// ErrWeakIsolation means a backend could not provide the required spec.
	ErrWeakIsolation = errors.New("sandboxprov: backend cannot provide strong isolation")
	// ErrNotRunning means exec targeted a sandbox with no live container.
	ErrNotRunning = errors.New("sandboxprov: sandbox container is not running")
)

// ExecRequest is a one-shot command inside a running sandbox.
type ExecRequest struct {
	SandboxRef string
	Command    string
	Args       []string
	Cwd        string
	// Env is an allowlist of NAME=value entries provisioned by the caller.
	Env []string
	// MaxOutputBytes bounds captured stdout+stderr separately.
	MaxOutputBytes int
}

// ExecResult carries the OS-level truth of one command. A non-zero exit or an
// OS refusal is NOT an error at the protocol level: it is a normal result so
// callers persist the bounded bytes/exit code/digest honestly.
type ExecResult struct {
	ExitCode  int
	Signal    int
	OSErrno   string
	Stdout    []byte
	Stderr    []byte
	Truncated bool
}

// Backend is the ExecutorBackend SPI. Host-OS variance lives only in
// implementations of this interface.
type Backend interface {
	Kind() string
	// Probe reports runtime availability without allocating anything.
	Probe() (available bool, reason string)
	// Allocate creates (or re-attaches) the sandbox container for a ref.
	Allocate(req AllocRequest) (*Handle, error)
	// Exec runs one bounded command inside the running sandbox.
	Exec(ctx context.Context, req ExecRequest) (*ExecResult, error)
	// Release removes the container; deleteVolume also removes the volume.
	Release(ref, volumeRef string, keepVolume bool) error
}
