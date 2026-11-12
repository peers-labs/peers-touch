// Command workspace-sandbox-provisionerd is the independent sidecar that owns
// the container runtime for WORKSPACE_SANDBOX execution (WE-20261104 WE-S3).
//
// It runs as a separate deployment unit (its own compose service). Only this
// process mounts the container runtime socket; Station talks to it over a
// narrow typed HTTP API. Phase 1 exposes Probe/Allocate/Release; Exec arrives
// in WE-S4 and PTY in WE-S6. Configuration is environment-driven; Station
// request bodies can never widen the image allowlist or security template.
package main

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/internal/sandboxprov"
)

// bearerAuth guards the mutating /v1 control surface. When SANDBOX_PROVISIONER
// TOKEN is provisioned, every /v1/* request must present an exact
// "Authorization: Bearer <token>"; /healthz stays open for liveness probes.
// When no token is configured (dev cell) the surface is unauthenticated and a
// prominent warning is logged — network placement is the only boundary there.
func bearerAuth(want string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if want == "" || !strings.HasPrefix(r.URL.Path, "/v1/") {
			next.ServeHTTP(w, r)
			return
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 || got == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "provisioner: missing or invalid bearer token",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

type config struct {
	listen        string
	policy        sandboxprov.Policy
	bearerToken   string
	defaultRunUID int
	defaultRunGID int
	memBytes      int64
	pids          int64
	cpuMillis     int64
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func splitNonEmpty(v string) []string {
	var out []string
	for _, part := range strings.Split(strings.TrimSpace(v), ",") {
		if s := strings.TrimSpace(part); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func envInt(key string, def int64) int64 {
	if v, err := strconv.ParseInt(strings.TrimSpace(os.Getenv(key)), 10, 64); err == nil && v > 0 {
		return v
	}
	return def
}

func loadConfig() config {
	return config{
		listen:      env("PROVISIONER_LISTEN", ":8090"),
		bearerToken: strings.TrimSpace(os.Getenv("SANDBOX_PROVISIONER_TOKEN")),
		policy: sandboxprov.Policy{
			AllowedRepositories: splitNonEmpty(os.Getenv("SANDBOX_ALLOWED_REPOS")),
			AllowedImageIDs:     splitNonEmpty(os.Getenv("SANDBOX_ALLOWED_IMAGE_IDS")),
			IsolatedNetwork:     env("SANDBOX_ISOLATED_NETWORK", "wbox-isolated"),
			MaxQuota: sandboxprov.Quota{
				MemoryBytes: envInt("SANDBOX_MAX_MEMORY_BYTES", 1<<30),
				PidsLimit:   envInt("SANDBOX_MAX_PIDS", 512),
				CPUMillis:   envInt("SANDBOX_MAX_CPU_MILLIS", 4000),
			},
		},
		defaultRunUID: int(envInt("SANDBOX_RUN_UID", 10001)),
		defaultRunGID: int(envInt("SANDBOX_RUN_GID", 10001)),
		memBytes:      envInt("SANDBOX_DEFAULT_MEMORY_BYTES", 256<<20),
		pids:          envInt("SANDBOX_DEFAULT_PIDS", 128),
		cpuMillis:     envInt("SANDBOX_DEFAULT_CPU_MILLIS", 1000),
	}
}

func main() {
	cfg := loadConfig()
	backend := sandboxprov.NewOCICLIBBackend(cfg.policy)
	pty := sandboxprov.NewPtyManager()

	if ok, reason := backend.Probe(); !ok {
		log.Printf("provisioner starting but runtime probe FAILED: %s (all sandbox calls will fail closed)", reason)
	} else {
		log.Printf("provisioner runtime probe OK backend=%s", backend.Kind())
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		ok, reason := backend.Probe()
		writeJSON(w, map[string]any{"available": ok, "backend": backend.Kind(), "reason": reason})
	})

	// POST /v1/sandboxes/allocate
	mux.HandleFunc("/v1/sandboxes/allocate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRef string `json:"sandbox_ref"`
			ImageRef   string `json:"image_ref"`
			VolumeRef  string `json:"volume_ref"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		// The security template is provisioner-owned; callers cannot set it.
		req := sandboxprov.AllocRequest{
			SandboxRef: in.SandboxRef, ImageRef: in.ImageRef, VolumeRef: in.VolumeRef,
			Security: sandboxprov.SecuritySpec{
				NonRoot: true, NoNewPrivileges: true, ReadOnlyRootfs: true,
				DropCapabilities:     []string{"ALL"},
				IsolateStationNet:    true,
				WorkspaceMountTarget: "/workspace",
				RunUID:               cfg.defaultRunUID, RunGID: cfg.defaultRunGID,
				Quota: sandboxprov.Quota{MemoryBytes: cfg.memBytes, PidsLimit: cfg.pids, CPUMillis: cfg.cpuMillis},
			},
		}
		h, err := backend.Allocate(req)
		if err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, h)
	})

	// POST /v1/sandboxes/exec
	mux.HandleFunc("/v1/sandboxes/exec", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in sandboxprov.ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		res, err := backend.Exec(r.Context(), in)
		if err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, res)
	})

	// POST /v1/ptys/open
	mux.HandleFunc("/v1/ptys/open", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in sandboxprov.PtyOpenRequest
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		pid, err := pty.Open(r.Context(), in)
		if err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]any{"pty_id": in.PtyID, "pid": pid})
	})

	// POST /v1/ptys/write
	mux.HandleFunc("/v1/ptys/write", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRef string `json:"sandbox_ref"`
			PtyID      string `json:"pty_id"`
			DataB64    string `json:"data_b64"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		data, err := base64.StdEncoding.DecodeString(in.DataB64)
		if err != nil {
			http.Error(w, "bad base64", http.StatusBadRequest)
			return
		}
		if err := pty.Write(r.Context(), in.SandboxRef, in.PtyID, data); err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]any{"bytes_written": len(data)})
	})

	// POST /v1/ptys/read
	mux.HandleFunc("/v1/ptys/read", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in sandboxprov.PtyReadRequest
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		result, err := pty.Read(r.Context(), in)
		if err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]any{
			"data_b64":    base64.StdEncoding.EncodeToString(result.Data),
			"next_cursor": result.NextCursor,
			"truncated":   result.Truncated,
			"pid":         result.Pid,
			"state":       result.State,
			"exit_code":   result.ExitCode,
		})
	})

	// POST /v1/ptys/resize
	mux.HandleFunc("/v1/ptys/resize", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRef string `json:"sandbox_ref"`
			PtyID      string `json:"pty_id"`
			Cols       uint32 `json:"cols"`
			Rows       uint32 `json:"rows"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := pty.Resize(r.Context(), in.SandboxRef, in.PtyID, in.Cols, in.Rows); err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"resized": true})
	})

	// POST /v1/ptys/signal
	mux.HandleFunc("/v1/ptys/signal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRef string `json:"sandbox_ref"`
			PtyID      string `json:"pty_id"`
			Signal     int    `json:"signal"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := pty.Signal(r.Context(), in.SandboxRef, in.PtyID, in.Signal); err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"signaled": true})
	})

	// POST /v1/ptys/close
	mux.HandleFunc("/v1/ptys/close", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRef string `json:"sandbox_ref"`
			PtyID      string `json:"pty_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := pty.Close(r.Context(), in.SandboxRef, in.PtyID); err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"closed": true})
	})

	// POST /v1/sandboxes/dormant  {"sandbox_ref"} — stop, keep volume.
	mux.HandleFunc("/v1/sandboxes/dormant", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRef string `json:"sandbox_ref"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := backend.Dormant(r.Context(), strings.TrimSpace(in.SandboxRef)); err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"dormant": true})
	})

	// POST /v1/sandboxes/reconcile  {"sandbox_refs":[...]} — per-ref truth.
	mux.HandleFunc("/v1/sandboxes/reconcile", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRefs []string `json:"sandbox_refs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		proofs, err := backend.Inspect(r.Context(), in.SandboxRefs)
		if err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]any{"proofs": proofs})
	})

	// POST /v1/sandboxes/release  {"sandbox_ref","volume_ref","keep_volume"}
	mux.HandleFunc("/v1/sandboxes/release", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			SandboxRef string `json:"sandbox_ref"`
			VolumeRef  string `json:"volume_ref"`
			KeepVolume bool   `json:"keep_volume"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := backend.Release(in.SandboxRef, in.VolumeRef, in.KeepVolume); err != nil {
			writePolicyError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"released": true})
	})

	srv := &http.Server{
		Addr:              cfg.listen,
		Handler:           bearerAuth(cfg.bearerToken, mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
	if cfg.bearerToken == "" {
		log.Printf("WARNING: no SANDBOX_PROVISIONER_TOKEN set — /v1 control surface is UNAUTHENTICATED; network placement is the only boundary")
	} else {
		log.Printf("provisioner bearer auth ENABLED on /v1/* (healthz stays open)")
	}
	log.Printf("workspace-sandbox-provisionerd listening on %s (isolated_net=%s repos=%d)",
		cfg.listen, cfg.policy.IsolatedNetwork, len(cfg.policy.AllowedRepositories))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("provisioner server: %v", err)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writePolicyError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, sandboxprov.ErrPolicyRejected):
		status = http.StatusUnprocessableEntity
	case errors.Is(err, sandboxprov.ErrUnavailable):
		status = http.StatusServiceUnavailable
	case errors.Is(err, sandboxprov.ErrWeakIsolation):
		status = http.StatusInternalServerError // fail closed, never downgrade
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
