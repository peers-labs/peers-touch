package sandboxprov

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

const BackendOCILinux = "oci_linux"

// CommandRunner abstracts process execution so the docker flag translation can
// be unit tested without a daemon. The production runner calls os/exec.
type CommandRunner func(ctx context.Context, name string, args ...string) ([]byte, error)

func execRunner(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// OCICLIBBackend is the phase-1 Linux backend: it drives the docker CLI on the
// host that the provisioner runs on. Sandboxes are sibling containers (the
// provisioner itself holds the socket; Station does not).
type OCICLIBBackend struct {
	policy Policy
	docker string
	run    CommandRunner
}

func NewOCICLIBBackend(policy Policy) *OCICLIBBackend {
	return &OCICLIBBackend{policy: policy, docker: "docker", run: execRunner}
}

// WithRunner swaps the process runner (tests only).
func (b *OCICLIBBackend) WithRunner(r CommandRunner) *OCICLIBBackend { b.run = r; return b }

// WithDockerBinary overrides the docker binary lookup path (tests only).
func (b *OCICLIBBackend) WithDockerBinary(p string) *OCICLIBBackend { b.docker = p; return b }

func (b *OCICLIBBackend) Kind() string { return BackendOCILinux }

func (b *OCICLIBBackend) Probe() (bool, string) {
	if _, err := exec.LookPath(b.docker); err != nil {
		return false, "docker CLI not found"
	}
	out, err := b.run(context.Background(), b.docker, "version", "--format", "{{.Server.Version}}")
	if err != nil {
		return false, "docker daemon unreachable: " + strings.TrimSpace(string(out))
	}
	if strings.TrimSpace(string(out)) == "" {
		return false, "docker daemon returned no version"
	}
	return true, ""
}

func containerName(ref string) string { return "wbox-" + sanitize(ref) }
func volumeName(ref string) string    { return "wbox-vol-" + sanitize(ref) }

func sanitize(ref string) string {
	r := strings.NewReplacer(":", "-", "/", "-", "@", "-", " ", "-")
	return r.Replace(strings.ToLower(ref))
}

// runArgs translates SecuritySpec into docker run flags. It is the single
// place the fail-closed template becomes native primitives.
func runArgs(req AllocRequest, netName string) []string {
	s := req.Security
	args := []string{
		"run", "-d",
		"--name", containerName(req.SandboxRef),
		"--restart", "no",
		"--user", fmt.Sprintf("%d:%d", s.RunUID, s.RunGID),
		"--read-only",
		"--security-opt", "no-new-privileges",
		"--cap-drop", "ALL",
	}
	if s.SeccompProfile != "" {
		args = append(args, "--security-opt", "seccomp="+s.SeccompProfile)
	}
	if s.IsolateStationNet {
		args = append(args, "--network", netName)
	} else {
		args = append(args, "--network", "none")
	}
	if s.Quota.MemoryBytes > 0 {
		args = append(args, "--memory", strconv.FormatInt(s.Quota.MemoryBytes, 10))
		args = append(args, "--memory-swap", strconv.FormatInt(s.Quota.MemoryBytes, 10))
	}
	if s.Quota.PidsLimit > 0 {
		args = append(args, "--pids-limit", strconv.FormatInt(s.Quota.PidsLimit, 10))
	}
	if s.Quota.CPUMillis > 0 {
		args = append(args, "--cpus", strconv.FormatFloat(float64(s.Quota.CPUMillis)/1000.0, 'f', 3, 64))
	}
	args = append(args,
		"-v", volumeName(req.SandboxRef)+":"+s.WorkspaceMountTarget,
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
		req.ImageRef,
		"sleep", "infinity",
	)
	return args
}

func (b *OCICLIBBackend) Allocate(req AllocRequest) (*Handle, error) {
	if err := b.policy.Validate(req); err != nil {
		return nil, err
	}
	vol := req.VolumeRef
	if vol == "" {
		vol = volumeName(req.SandboxRef)
	}
	// Idempotent: if the container already exists and is running, re-attach.
	inspectArgs := []string{"inspect", "-f", "{{.State.Running}}", containerName(req.SandboxRef)}
	out, err := b.run(context.Background(), b.docker, inspectArgs...)
	if err == nil && strings.TrimSpace(string(out)) == "true" {
		return &Handle{SandboxRef: req.SandboxRef, Container: containerName(req.SandboxRef),
			BackendKind: BackendOCILinux, VolumeRef: vol}, nil
	}

	// Ensure the named volume exists (idempotent), then run.
	if _, err := b.run(context.Background(), b.docker, "volume", "create", vol); err != nil {
		return nil, fmt.Errorf("create workspace volume: %w", err)
	}
	args := runArgs(req, b.policy.IsolatedNetwork)
	if out, err := b.run(context.Background(), b.docker, args...); err != nil {
		return nil, fmt.Errorf("docker run: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return &Handle{SandboxRef: req.SandboxRef, Container: containerName(req.SandboxRef),
		BackendKind: BackendOCILinux, VolumeRef: vol}, nil
}

func (b *OCICLIBBackend) Release(ref, volumeRef string, keepVolume bool) error {
	name := containerName(ref)
	if _, err := b.run(context.Background(), b.docker, "rm", "-f", name); err != nil {
		// A missing container is fine on release; the volume is the decision.
		if !strings.Contains(strings.ToLower(err.Error()), "no such container") {
			return fmt.Errorf("docker rm: %w", err)
		}
	}
	if !keepVolume {
		vol := volumeRef
		if vol == "" {
			vol = volumeName(ref)
		}
		if _, err := b.run(context.Background(), b.docker, "volume", "rm", vol); err != nil {
			if !strings.Contains(strings.ToLower(err.Error()), "no such volume") {
				return fmt.Errorf("docker volume rm: %w", err)
			}
		}
	}
	return nil
}
