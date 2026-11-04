// Package sandboxprov is the workspace-sandbox-provisioner core (WE-20261104).
//
// It is the ONLY component that holds a container runtime handle. Station
// never imports or embeds it. The package is deliberately stdlib-only and
// contains no Station business/database logic. The phase-1 OCI backend drives
// the docker CLI; the Backend interface lets a containerd/microVM backend
// replace it without changing callers.
package sandboxprov

import (
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
)

// Backend is the ExecutorBackend SPI. Host-OS variance lives only in
// implementations of this interface.
type Backend interface {
	Kind() string
	// Probe reports runtime availability without allocating anything.
	Probe() (available bool, reason string)
	// Allocate creates (or re-attaches) the sandbox container for a ref.
	Allocate(req AllocRequest) (*Handle, error)
	// Release removes the container; deleteVolume also removes the volume.
	Release(ref, volumeRef string, keepVolume bool) error
}
