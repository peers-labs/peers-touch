package sandboxprov

import (
	"errors"
	"strings"
	"testing"
)

func validSpec() SecuritySpec {
	return SecuritySpec{
		NonRoot: true, NoNewPrivileges: true, ReadOnlyRootfs: true,
		DropCapabilities: []string{"ALL"}, SeccompProfile: "",
		IsolateStationNet:    true,
		EgressHostAllowlist:  []string{"pypi.org"},
		WorkspaceMountTarget: "/workspace",
		RunUID:               10001, RunGID: 10001,
		Quota: Quota{MemoryBytes: 256 << 20, PidsLimit: 128, CPUMillis: 1000},
	}
}

func TestValidateImage(t *testing.T) {
	allowedID := "sha256:" + strings.Repeat("c", 64)
	p := Policy{
		AllowedRepositories: []string{"registry.example.com/peers/sandboxes"},
		AllowedImageIDs:     []string{allowedID},
	}
	digest := "@sha256:" + strings.Repeat("a", 64)

	cases := []struct {
		name    string
		image   string
		wantErr error
	}{
		{"allowed pinned", "registry.example.com/peers/sandboxes/ubuntu:24.04" + digest, nil},
		{"sub-repo allowed", "registry.example.com/peers/sandboxes/tools/go:1.24" + digest, nil},
		{"mutable tag rejected", "registry.example.com/peers/sandboxes/ubuntu:latest", ErrPolicyRejected},
		{"non-allowlisted repo", "docker.io/library/ubuntu:latest" + digest, ErrPolicyRejected},
		{"bad digest length", "registry.example.com/peers/sandboxes/ubuntu@sha256:deadbeef", ErrPolicyRejected},
		{"allowed bare image id", allowedID, nil},
		{"non-allowlisted image id", "sha256:" + strings.Repeat("d", 64), ErrPolicyRejected},
		{"malformed image id", "sha256:short", ErrPolicyRejected},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := p.ValidateImage(c.image)
			if c.wantErr == nil && err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if c.wantErr != nil && !errors.Is(err, c.wantErr) {
				t.Fatalf("err = %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestValidateSpecFailClosed(t *testing.T) {
	p := Policy{IsolatedNetwork: "wbox-isolated", MaxQuota: Quota{MemoryBytes: 1 << 30, PidsLimit: 512}}

	t.Run("valid", func(t *testing.T) {
		if err := p.ValidateSpec(validSpec()); err != nil {
			t.Fatalf("unexpected: %v", err)
		}
	})

	breakEach := map[string]func(s *SecuritySpec){
		"root allowed":          func(s *SecuritySpec) { s.NonRoot = false },
		"new privs allowed":     func(s *SecuritySpec) { s.NoNewPrivileges = false },
		"writable rootfs":       func(s *SecuritySpec) { s.ReadOnlyRootfs = false },
		"uid zero":              func(s *SecuritySpec) { s.RunUID = 0 },
		"missing cap drop ALL":  func(s *SecuritySpec) { s.DropCapabilities = []string{"NET_RAW"} },
		"no memory quota":       func(s *SecuritySpec) { s.Quota.MemoryBytes = 0 },
		"no pids quota":         func(s *SecuritySpec) { s.Quota.PidsLimit = 0 },
		"bad mount target":      func(s *SecuritySpec) { s.WorkspaceMountTarget = "/home" },
		"isolation without net": func(s *SecuritySpec) { s.IsolateStationNet = true },
	}
	base := validSpec()
	for name, mutate := range breakEach {
		t.Run(name, func(t *testing.T) {
			s := base
			mutate(&s)
			pp := p
			if name == "isolation without net" {
				pp.IsolatedNetwork = ""
			}
			if !errors.Is(pp.ValidateSpec(s), ErrWeakIsolation) {
				t.Fatalf("expected ErrWeakIsolation")
			}
		})
	}

	t.Run("quota ceiling", func(t *testing.T) {
		s := validSpec()
		s.Quota.MemoryBytes = 2 << 30
		if !errors.Is(p.ValidateSpec(s), ErrPolicyRejected) {
			t.Fatalf("expected policy rejection for oversized quota")
		}
	})
}

func TestValidateRequestRequiresRefs(t *testing.T) {
	p := Policy{AllowedRepositories: []string{"r"}, IsolatedNetwork: "n"}
	req := AllocRequest{ImageRef: "r/img@sha256:" + strings.Repeat("b", 64), Security: validSpec()}
	if err := p.Validate(req); !errors.Is(err, ErrPolicyRejected) {
		t.Fatalf("missing refs should be rejected, got %v", err)
	}
}
