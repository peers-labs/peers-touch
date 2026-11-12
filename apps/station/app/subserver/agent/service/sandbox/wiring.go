package sandbox

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Station wiring environment. These are Station's own locator/limit knobs;
// the security template and image allowlist stay provisioner-owned and are
// configured on the provisioner side (never sent in a request body).
const (
	envProvisionerURL = "PEERS_SANDBOX_PROVISIONER_URL"
	envDefaultImage   = "PEERS_SANDBOX_DEFAULT_IMAGE"
	envMaxActive      = "PEERS_SANDBOX_MAX_ACTIVE_PER_ACTOR"
	// envProvisionerToken is the shared bearer secret for the provisioner
	// control surface. Must match the sidecar's SANDBOX_PROVISIONER_TOKEN.
	envProvisionerToken = "PEERS_SANDBOX_PROVISIONER_TOKEN"

	defaultProvisionerURL    = "http://workspace-sandbox-provisioner:8090"
	defaultMaxActivePerActor = 8
	provisionerCallTimeout   = 60 * time.Second
)

// NewStationToolRunnerFromEnv builds the Station-side WORKSPACE_SANDBOX
// execution chain (GORM store -> allocator -> provisioner HTTP client ->
// executor -> tool runner) from environment configuration. It is the single
// wiring seam used at Station boot.
//
// DefaultImage has no fallback: an unpinned deployment fails closed at the
// provisioner image allowlist rather than silently running a mutable tag.
func NewStationToolRunnerFromEnv(db *gorm.DB) *ToolRunner {
	executor, _ := newStationExecutorFromEnv(db)
	return NewToolRunner(executor)
}

// NewStationTerminalBridgeFromEnv builds the interactive PTY proxy sharing the
// same provisioner client/lifecycle as the one-shot tool runner.
func NewStationTerminalBridgeFromEnv(db *gorm.DB) *TerminalBridge {
	executor, client := newStationExecutorFromEnv(db)
	return NewTerminalBridge(executor, client)
}

// NewStationResolverFromEnv builds the read-only allocation resolver used by
// the terminal placement picker. It only opens the GORM store; no provisioner
// client is constructed because resolution performs no backend side effects.
func NewStationResolverFromEnv(db *gorm.DB) *Resolver {
	return NewResolver(NewGormStore(db))
}

func newStationExecutorFromEnv(db *gorm.DB) (*Executor, *HTTPClient) {
	provisionerURL := strings.TrimSpace(os.Getenv(envProvisionerURL))
	if provisionerURL == "" {
		provisionerURL = defaultProvisionerURL
	}
	maxActive := defaultMaxActivePerActor
	if raw := strings.TrimSpace(os.Getenv(envMaxActive)); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			maxActive = parsed
		}
	}
	store := NewGormStore(db)
	allocator := NewAllocator(store, Quota{MaxActivePerActor: maxActive}, newSandboxRef, nil)
	client := NewHTTPClient(provisionerURL, provisionerCallTimeout).
		WithBearerToken(os.Getenv(envProvisionerToken))
	executor := NewExecutor(ExecutorConfig{
		Allocator:    allocator,
		Client:       client,
		DefaultImage: strings.TrimSpace(os.Getenv(envDefaultImage)),
	})
	return executor, client
}

// newSandboxRef returns an unpredictable sandbox identifier ("wbox-" + 32 hex
// chars). Sandbox refs are unguessable so a turn can only address a sandbox it
// was explicitly allocated.
func newSandboxRef() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is not recoverable; fail fast rather than issue a
		// guessable ref.
		panic("sandbox: cannot read cryptographic randomness: " + err.Error())
	}
	return "wbox-" + hex.EncodeToString(b)
}
