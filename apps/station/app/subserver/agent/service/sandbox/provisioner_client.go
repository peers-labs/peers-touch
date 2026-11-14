package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client is the narrow Station -> provisioner boundary. Only the methods
// needed to ensure an allocated sandbox and run a bounded command are exposed.
type Client interface {
	Probe(ctx context.Context) (available bool, backend string, reason string, err error)
	EnsureAllocated(ctx context.Context, ref, imageRef, volumeRef string) (actualVolumeRef string, err error)
	Exec(ctx context.Context, in ExecCall) (*ExecOutcome, error)
	Dormant(ctx context.Context, ref string) error
	Reconcile(ctx context.Context, refs []string) ([]LiveProof, error)
	Release(ctx context.Context, ref, volumeRef string, keepVolume bool) error
}

// LiveProof is the provisioner truth for one sandbox during reconcile.
type LiveProof struct {
	SandboxRef string `json:"sandbox_ref"`
	Exists     bool   `json:"exists"`
	Running    bool   `json:"running"`
}

// ExecCall is one bounded command (mirrors provisionerd's ExecRequest).
type ExecCall struct {
	SandboxRef     string   `json:"sandbox_ref"`
	Command        string   `json:"command"`
	Args           []string `json:"args"`
	Cwd            string   `json:"cwd"`
	Env            []string `json:"env"`
	Stdin          []byte   `json:"stdin"`
	MaxOutputBytes int      `json:"max_output_bytes"`
}

// ExecOutcome is the OS truth of a command. Non-zero exit / OS refusal are
// outcomes, not Go errors.
type ExecOutcome struct {
	ExitCode  int    `json:"exit_code"`
	Signal    int    `json:"signal,omitempty"`
	OSErrno   string `json:"os_errno,omitempty"`
	Stdout    []byte `json:"stdout"`
	Stderr    []byte `json:"stderr"`
	Truncated bool   `json:"truncated,omitempty"`
}

// HTTPClient talks to an independent workspace-sandbox-provisionerd.
type HTTPClient struct {
	baseURL     string
	bearerToken string
	http        *http.Client
}

func NewHTTPClient(baseURL string, timeout time.Duration) *HTTPClient {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &HTTPClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: timeout},
	}
}

// WithBearerToken installs the shared Station↔provisioner secret. When the
// provisioner is configured with SANDBOX_PROVISIONER_TOKEN it requires this on
// every /v1 call; an empty token means the sidecar is running unauthenticated
// (dev cell), so the client simply omits the header.
func (c *HTTPClient) WithBearerToken(token string) *HTTPClient {
	c.bearerToken = strings.TrimSpace(token)
	return c
}

func (c *HTTPClient) postJSON(ctx context.Context, path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearerToken)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("provisioner unreachable: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("provisioner %s returned %d: %s", path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("provisioner bad response: %w", err)
		}
	}
	return nil
}

func (c *HTTPClient) Probe(ctx context.Context) (bool, string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/healthz", nil)
	if err != nil {
		return false, "", "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return false, "", "", fmt.Errorf("provisioner unreachable: %w", err)
	}
	defer resp.Body.Close()
	var pr struct {
		Available bool   `json:"available"`
		Backend   string `json:"backend"`
		Reason    string `json:"reason"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&pr); err != nil {
		return false, "", "", err
	}
	return pr.Available, pr.Backend, pr.Reason, nil
}

func (c *HTTPClient) EnsureAllocated(ctx context.Context, ref, imageRef, volumeRef string) (string, error) {
	var h struct {
		SandboxRef  string `json:"SandboxRef"`
		Container   string `json:"Container"`
		BackendKind string `json:"BackendKind"`
		VolumeRef   string `json:"VolumeRef"`
	}
	if err := c.postJSON(ctx, "/v1/sandboxes/allocate", map[string]string{
		"sandbox_ref": ref, "image_ref": imageRef, "volume_ref": volumeRef,
	}, &h); err != nil {
		return "", err
	}
	return h.VolumeRef, nil
}

func (c *HTTPClient) Exec(ctx context.Context, in ExecCall) (*ExecOutcome, error) {
	var out ExecOutcome
	if err := c.postJSON(ctx, "/v1/sandboxes/exec", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *HTTPClient) Release(ctx context.Context, ref, volumeRef string, keepVolume bool) error {
	return c.postJSON(ctx, "/v1/sandboxes/release", map[string]any{
		"sandbox_ref": ref, "volume_ref": volumeRef, "keep_volume": keepVolume,
	}, nil)
}

func (c *HTTPClient) Dormant(ctx context.Context, ref string) error {
	return c.postJSON(ctx, "/v1/sandboxes/dormant", map[string]string{
		"sandbox_ref": ref,
	}, nil)
}

func (c *HTTPClient) Reconcile(ctx context.Context, refs []string) ([]LiveProof, error) {
	var resp struct {
		Proofs []LiveProof `json:"proofs"`
	}
	if err := c.postJSON(ctx, "/v1/sandboxes/reconcile", map[string]any{
		"sandbox_refs": refs,
	}, &resp); err != nil {
		return nil, err
	}
	return resp.Proofs, nil
}
