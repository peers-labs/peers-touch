// Package managed owns Station-wide installation of CLI Agent adapters.
// Executing actors supply their own isolated HOME and caches to shared wrappers.
package managed

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// InstallState is the Station installation state of one CLI adapter.
type InstallState string

const (
	// StateReady means the adapter binary resolves inside the Station's
	// managed runtime root.
	StateReady InstallState = "ready"
	// StateMissing means no installation exists yet; the UI offers an
	// inline download action.
	StateMissing InstallState = "missing"
	// StateInstalling means a job owned by this Manager is running.
	StateInstalling InstallState = "installing"
	// StateFailed means the last install job failed and can be retried.
	StateFailed InstallState = "failed"
	// StateManualRequired means the adapter cannot be installed
	// automatically on this platform; the UI links to the vendor guide.
	StateManualRequired InstallState = "manual_required"
	// StateUnsupported means automatic install is not implemented for
	// the current OS/architecture.
	StateUnsupported InstallState = "unsupported"
)

// InstallKind selects the installation mechanism for an adapter.
type InstallKind string

const (
	KindNPM    InstallKind = "npm"
	KindScript InstallKind = "script"
	KindManual InstallKind = "manual"
)

// Spec describes a managed CLI adapter.
type Spec struct {
	// ProviderID is the Station provider catalog id (e.g. "codex-cli").
	ProviderID string
	// Command is the executable name the wrappers expose on PATH.
	Command string
	// Kind selects npm, vendor script or manual download.
	Kind InstallKind
	// Package is the npm package reference for KindNPM.
	Package string
	// ScriptURL is the vendor install script for KindScript.
	ScriptURL string
	// ScriptCommands lists binaries the vendor script may produce under HOME.
	ScriptCommands []string
	// ManualURL links the vendor installation guide for KindManual or
	// as a fallback link on failure.
	ManualURL string
}

// Snapshot is the installation state surfaced to administrators.
type Snapshot struct {
	State            InstallState `json:"state"`
	InstallSupported bool         `json:"install_supported"`
	JobID            string       `json:"job_id,omitempty"`
	Phase            string       `json:"phase,omitempty"`
	Percent          int          `json:"percent,omitempty"`
	Message          string       `json:"message,omitempty"`
	Error            string       `json:"error,omitempty"`
	ManualURL        string       `json:"manual_url,omitempty"`
	InstalledVersion string       `json:"installed_version,omitempty"`
}

// Job phases are stable strings so the renderer can localize them.
const (
	phaseRuntime  = "runtime"
	phaseDownload = "download"
	phaseInstall  = "install"
	phaseVerify   = "verify"
	phaseActivate = "activate"
)

// Manager installs and tracks Station CLI runtimes. Its zero value is not
// usable; construct it with NewManager.
type Manager struct {
	baseDir string
	// systemPATH is the Station process PATH searched for machine-level
	// binaries after the Station managed bin directory.
	systemPATH string

	mu        sync.Mutex
	runtimeMu sync.Mutex
	jobs      map[string]*Job
	workers   sync.WaitGroup
	stopDone  chan struct{}
	stopping  bool
}

// Job is one in-flight or terminal installation attempt.
type Job struct {
	ID         string `json:"id"`
	ProviderID string `json:"provider_id"`
	State      InstallState
	Phase      string
	Percent    int
	Message    string
	Error      string
	StartedAt  time.Time `json:"started_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	cancel context.CancelFunc
}

func (j *Job) snapshot() Snapshot {
	return Snapshot{
		State:   j.State,
		JobID:   j.ID,
		Phase:   j.Phase,
		Percent: j.Percent,
		Message: j.Message,
		Error:   j.Error,
	}
}

// progress reports bounded phase advancement. Callers report monotonic
// percentages within a phase; the phase itself owns a fixed slice of the
// overall progress bar.
type progress struct {
	job *Job
	mu  *sync.Mutex
}

func (p *progress) report(phase string, percentInPhase int, message string) {
	percentInPhase = clampInt(percentInPhase, 0, 100)
	overall := phaseBase[phase] + int(float64(phaseWidth[phase])*float64(percentInPhase)/100.0)
	p.mu.Lock()
	defer p.mu.Unlock()
	if overall < p.job.Percent {
		overall = p.job.Percent
	}
	p.job.Phase = phase
	p.job.Percent = clampInt(overall, 0, 100)
	p.job.Message = message
	p.job.UpdatedAt = time.Now().UTC()
}

var phaseBase = map[string]int{
	phaseRuntime:  0,
	phaseDownload: 15,
	phaseInstall:  30,
	phaseVerify:   88,
	phaseActivate: 96,
}

var phaseWidth = map[string]int{
	phaseRuntime:  15,
	phaseDownload: 15,
	phaseInstall:  58,
	phaseVerify:   8,
	phaseActivate: 4,
}

// NewManager creates a Manager whose Station installation lives under baseDir.
// baseDir is typically the same persistent root that owns agent workspaces.
func NewManager(baseDir string) *Manager {
	return &Manager{
		baseDir:    filepath.Clean(strings.TrimSpace(baseDir)),
		systemPATH: os.Getenv("PATH"),
		jobs:       make(map[string]*Job),
	}
}

// newManagerForTest builds a Manager with an explicit system PATH so unit
// tests stay deterministic on developer machines.
func newManagerForTest(baseDir, systemPATH string) *Manager {
	manager := NewManager(baseDir)
	manager.systemPATH = systemPATH
	return manager
}

// Root returns the persistent Station installation root.
func (m *Manager) Root() string {
	return filepath.Join(m.baseDir, "station-managed")
}

// BinDir returns the wrapper directory that must lead PATH when executing a
// CLI adapters with the requesting actor's private environment.
func (m *Manager) BinDir() string {
	return filepath.Join(m.Root(), "bin")
}

// Specs returns the supported adapter catalog in stable order.
func Specs() []Spec {
	return []Spec{
		{
			ProviderID: "trae-cli",
			Command:    "traecli",
			Kind:       KindManual,
			ManualURL:  "https://www.trae.ai",
		},
		{
			ProviderID: "codex-cli",
			Command:    "codex",
			Kind:       KindNPM,
			Package:    "@openai/codex@latest",
			ManualURL:  "https://developers.openai.com/codex",
		},
		{
			ProviderID: "cursor-cli",
			Command:    "cursor-agent",
			Kind:       KindScript,
			ScriptURL:  "https://cursor.com/install",
			// Cursor's installer has shipped both binary names; the
			// activator picks whichever the script produced.
			ScriptCommands: []string{"cursor-agent", "agent"},
			ManualURL:      "https://cursor.com",
		},
		{
			ProviderID: "claude-cli",
			Command:    "claude",
			Kind:       KindNPM,
			Package:    "@anthropic-ai/claude-code@latest",
			ManualURL:  "https://www.anthropic.com/claude-code",
		},
	}
}

// FindSpec returns the adapter spec for a provider id.
func FindSpec(providerID string) (Spec, bool) {
	for _, spec := range Specs() {
		if spec.ProviderID == providerID {
			return spec, true
		}
	}
	return Spec{}, false
}

// Snapshot returns the current installation state without mutating anything.
func (m *Manager) Snapshot(providerID, jobID string) Snapshot {
	spec, ok := FindSpec(providerID)
	if !ok {
		return Snapshot{State: StateUnsupported}
	}
	snapshot := Snapshot{
		InstallSupported: spec.Kind != KindManual,
		ManualURL:        spec.ManualURL,
	}

	m.mu.Lock()
	job := m.jobs[providerID]
	if job != nil && (jobID == "" || job.ID == jobID) && job.State == StateInstalling {
		current := job.snapshot()
		m.mu.Unlock()
		current.InstallSupported = snapshot.InstallSupported
		current.ManualURL = snapshot.ManualURL
		return current
	}
	var failed Snapshot
	if job != nil && job.State == StateFailed {
		failed = job.snapshot()
	}
	m.mu.Unlock()

	if failed.State == StateFailed {
		failed.InstallSupported = snapshot.InstallSupported
		failed.ManualURL = snapshot.ManualURL
		failed.InstalledVersion = installedVersion(m.Root(), spec)
		return failed
	}
	if wrapperReady(m.Root(), spec.Command) {
		snapshot.State = StateReady
		snapshot.InstalledVersion = installedVersion(m.Root(), spec)
		return snapshot
	}
	// A machine-level install on the Station PATH (for example a
	// host-mounted traecli in container deployments) is a binary baseline
	// shared by every actor. Managed wrappers lead PATH; private execution
	// state is required for either binary source.
	if m.systemCommandAvailable(spec.Command) {
		snapshot.State = StateReady
		return snapshot
	}
	if spec.Kind == KindManual {
		snapshot.State = StateManualRequired
		return snapshot
	}
	if !platformSupported(spec) {
		snapshot.State = StateUnsupported
		return snapshot
	}
	snapshot.State = StateMissing
	return snapshot
}

// Start begins a background installation. It is idempotent while a job is
// already running: the existing job is returned. Manual adapters never start
// a job and return the manual_required snapshot instead.
func (m *Manager) Start(parent context.Context, providerID string) (Snapshot, error) {
	spec, ok := FindSpec(providerID)
	if !ok {
		return Snapshot{State: StateUnsupported}, fmt.Errorf("unsupported CLI adapter: %s", providerID)
	}
	if spec.Kind == KindManual {
		return m.Snapshot(providerID, ""), nil
	}
	if !platformSupported(spec) {
		return Snapshot{State: StateUnsupported, ManualURL: spec.ManualURL}, nil
	}
	if err := os.MkdirAll(m.Root(), 0o700); err != nil {
		return Snapshot{}, fmt.Errorf("create managed runtime root: %w", err)
	}

	key := providerID
	m.mu.Lock()
	if m.stopping {
		m.mu.Unlock()
		return Snapshot{}, fmt.Errorf("CLI installation service is stopping")
	}
	if existing := m.jobs[key]; existing != nil && existing.State == StateInstalling {
		snapshot := existing.snapshot()
		m.mu.Unlock()
		snapshot.InstallSupported = true
		snapshot.ManualURL = spec.ManualURL
		return snapshot, nil
	}
	job := &Job{
		ID:         newJobID(),
		ProviderID: providerID,
		State:      StateInstalling,
		Phase:      phaseRuntime,
		Percent:    0,
		Message:    "preparing managed runtime",
		StartedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(parent))
	job.cancel = cancel
	m.jobs[key] = job
	m.workers.Add(1)
	snapshot := job.snapshot()
	m.mu.Unlock()
	go func() {
		defer m.workers.Done()
		defer cancel()
		m.runInstall(ctx, job, spec)
	}()
	snapshot.InstallSupported = true
	snapshot.ManualURL = spec.ManualURL
	return snapshot, nil
}

// Stop rejects new jobs, cancels existing jobs and waits for their staged files
// and process groups to be released.
func (m *Manager) Stop(ctx context.Context) error {
	m.mu.Lock()
	if !m.stopping {
		m.stopping = true
		m.stopDone = make(chan struct{})
		for _, job := range m.jobs {
			if job.State == StateInstalling && job.cancel != nil {
				job.cancel()
			}
		}
		done := m.stopDone
		go func() { m.workers.Wait(); close(done) }()
	}
	done := m.stopDone
	m.mu.Unlock()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Resume reopens the service only after all previous jobs have terminated.
func (m *Manager) Resume() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.stopping {
		return nil
	}
	select {
	case <-m.stopDone:
	default:
		return fmt.Errorf("previous CLI installation is still stopping")
	}
	m.stopping = false
	m.stopDone = nil
	return nil
}

func (m *Manager) runInstall(ctx context.Context, job *Job, spec Spec) {
	reporter := &progress{job: job, mu: &m.mu}
	installErr := m.install(ctx, spec, reporter)

	m.mu.Lock()
	defer m.mu.Unlock()
	job.UpdatedAt = time.Now().UTC()
	if installErr != nil {
		job.State = StateFailed
		job.Error = installErr.Error()
		if errors.Is(ctx.Err(), context.Canceled) {
			job.Error = "installation cancelled"
		}
		return
	}
	job.State = StateReady
	job.Phase = ""
	job.Percent = 100
	job.Message = "installed"
	job.Error = ""
}

func (m *Manager) install(
	ctx context.Context,
	spec Spec,
	reporter *progress,
) error {
	root := m.Root()
	env := newInstallEnv(root)
	switch spec.Kind {
	case KindNPM:
		m.runtimeMu.Lock()
		runtimeErr := ensureNodeRuntime(ctx, root, env, reporter)
		m.runtimeMu.Unlock()
		if runtimeErr != nil {
			return runtimeErr
		}
		return installNPMTool(ctx, root, env, spec, reporter)
	case KindScript:
		return installScriptTool(ctx, root, env, spec, reporter)
	default:
		return fmt.Errorf("adapter %s does not support automatic installation", spec.ProviderID)
	}
}

// systemCommandAvailable reports whether command resolves against the
// Station process PATH without consulting managed roots.
func (m *Manager) systemCommandAvailable(command string) bool {
	if strings.TrimSpace(command) == "" || filepath.IsAbs(command) {
		return false
	}
	for _, dir := range filepath.SplitList(m.systemPATH) {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		candidate := filepath.Join(dir, command)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return true
		}
	}
	return false
}

func newJobID() string {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("job-%d", time.Now().UnixNano())
	}
	return "job-" + hex.EncodeToString(raw[:])
}

func platformSupported(spec Spec) bool {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return false
	}
	switch runtime.GOARCH {
	case "amd64", "arm64":
	default:
		return false
	}
	return true
}

func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}
