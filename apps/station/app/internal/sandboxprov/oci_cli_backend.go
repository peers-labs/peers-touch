package sandboxprov

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
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
	name := containerName(req.SandboxRef)
	handle := &Handle{SandboxRef: req.SandboxRef, Container: name,
		BackendKind: BackendOCILinux, VolumeRef: vol}

	exists, running, err := b.inspectState(context.Background(), req.SandboxRef)
	if err != nil {
		return nil, err
	}
	if exists {
		// Idempotent re-attach when live; cold-start (docker start) when the
		// container was parked DORMANT. The workspace volume survives either
		// way, so no `docker run` is attempted against an existing name.
		if !running {
			if out, err := b.run(context.Background(), b.docker, "start", name); err != nil {
				return nil, fmt.Errorf("docker start (cold-start): %w: %s", err, strings.TrimSpace(string(out)))
			}
		}
		return handle, nil
	}

	// Ensure the named volume exists (idempotent), then run.
	if _, err := b.run(context.Background(), b.docker, "volume", "create", vol); err != nil {
		return nil, fmt.Errorf("create workspace volume: %w", err)
	}
	args := runArgs(req, b.policy.IsolatedNetwork)
	if out, err := b.run(context.Background(), b.docker, args...); err != nil {
		return nil, fmt.Errorf("docker run: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return handle, nil
}

// inspectState reports (exists, running) for a ref without treating a missing
// container as an error. docker inspect prints "No such object/container" on
// stderr with exit 1 when the name is absent.
func (b *OCICLIBBackend) inspectState(ctx context.Context, ref string) (bool, bool, error) {
	out, err := b.run(ctx, b.docker, "inspect", "-f", "{{.State.Running}}", containerName(ref))
	if err == nil {
		return true, strings.TrimSpace(string(out)) == "true", nil
	}
	if isNoSuchContainer(out) {
		return false, false, nil
	}
	return false, false, fmt.Errorf("inspect sandbox: %w: %s", err, strings.TrimSpace(string(out)))
}

func isNoSuchContainer(out []byte) bool {
	text := strings.ToLower(string(out))
	return strings.Contains(text, "no such object") ||
		strings.Contains(text, "no such container")
}

// execArgs builds `docker exec` flags. Workload stays unprivileged; cwd/env
// are bounded and supplied explicitly rather than inherited from the host.
func execArgs(req ExecRequest) []string {
	args := []string{"exec", "-i"}
	if req.Cwd != "" {
		args = append(args, "-w", req.Cwd)
	}
	for _, e := range req.Env {
		args = append(args, "-e", e)
	}
	args = append(args, containerName(req.SandboxRef), req.Command)
	args = append(args, req.Args...)
	return args
}

const defaultMaxExecOutput = 256 * 1024

// Exec runs one bounded command inside the running container. A non-zero exit
// or an OS refusal is returned as an ExecResult (not a Go error) so callers
// persist honest bounded bytes/exit code. Infrastructure failures (container
// gone, daemon error, timeout) are returned as errors and must fail closed.
func (b *OCICLIBBackend) Exec(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	if strings.TrimSpace(req.SandboxRef) == "" || strings.TrimSpace(req.Command) == "" {
		return nil, fmt.Errorf("%w: sandbox_ref and command are required", ErrPolicyRejected)
	}
	maxOut := req.MaxOutputBytes
	if maxOut <= 0 {
		maxOut = defaultMaxExecOutput
	}

	_, running, err := b.inspectState(ctx, req.SandboxRef)
	if err != nil {
		return nil, err
	}
	if !running {
		return nil, fmt.Errorf("%w: %s", ErrNotRunning, req.SandboxRef)
	}

	cmd := exec.CommandContext(ctx, b.docker, execArgs(req)...)
	var stdout, stderr boundedBuffer
	stdout.limit = maxOut
	stderr.limit = maxOut
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if len(req.Stdin) > 0 {
		cmd.Stdin = bytes.NewReader(req.Stdin)
	}
	runErr := cmd.Run()

	res := &ExecResult{
		Stdout:    stdout.bytes(),
		Stderr:    stderr.bytes(),
		Truncated: stdout.truncated || stderr.truncated,
	}
	if runErr == nil {
		res.ExitCode = 0
		return res, nil
	}
	var exitErr *exec.ExitError
	if errors.As(runErr, &exitErr) {
		res.ExitCode = exitErr.ExitCode()
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			if status.Signaled() {
				res.Signal = int(status.Signal())
			}
		}
		res.OSErrno = inferErrno(res.Stderr)
		return res, nil
	}
	// CLI/daemon/timeout failure, not a command result: fail closed.
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return nil, fmt.Errorf("sandbox exec timed out: %w", ctx.Err())
	}
	return nil, fmt.Errorf("docker exec: %w: %s", runErr, strings.TrimSpace(string(res.Stderr)))
}

// Dormant stops a live container while keeping its workspace volume. A missing
// container is idempotent success (already gone); Station marks its row from
// the returned reconcile truth rather than assuming the stop happened.
func (b *OCICLIBBackend) Dormant(ctx context.Context, ref string) error {
	name := containerName(ref)
	out, err := b.run(ctx, b.docker, "stop", "--time", "5", name)
	if err != nil {
		if isNoSuchContainer(out) {
			return nil
		}
		return fmt.Errorf("docker stop: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Inspect returns live truth per ref for reconciliation.
func (b *OCICLIBBackend) Inspect(ctx context.Context, refs []string) ([]LiveProof, error) {
	proofs := make([]LiveProof, 0, len(refs))
	for _, ref := range refs {
		exists, running, err := b.inspectState(ctx, ref)
		if err != nil {
			return nil, err
		}
		proofs = append(proofs, LiveProof{SandboxRef: ref, Exists: exists, Running: running})
	}
	return proofs, nil
}

var (
	errnoEACCES = regexp.MustCompile(`(?i)permission denied|operation not permitted`)
	errnoENOENT = regexp.MustCompile(`(?i)no such file or directory`)
	errnoEROFS  = regexp.MustCompile(`(?i)read-only file system`)
)

// inferErrno best-effort maps common OS refusal text. It never fabricates a
// value: unknown text returns an empty errno and the raw stderr is preserved.
func inferErrno(stderr []byte) string {
	switch {
	case errnoEROFS.Match(stderr):
		return "EROFS"
	case errnoEACCES.Match(stderr):
		return "EACCES"
	case errnoENOENT.Match(stderr):
		return "ENOENT"
	default:
		return ""
	}
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
