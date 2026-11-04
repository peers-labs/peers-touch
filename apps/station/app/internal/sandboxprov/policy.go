package sandboxprov

import (
	"fmt"
	"regexp"
	"strings"
)

// Policy enforces what Allocate may request, independent of the backend.
// Policy is configuration owned by the provisioner deployment; Station
// request bodies can never widen it.
type Policy struct {
	// AllowedRepositories are exact repository prefixes, e.g.
	// "registry.example.com/peers/sandboxes".
	AllowedRepositories []string
	// NetworkName is the isolated network sandboxes must join when
	// IsolateStationNet is set (never the station/postgres network).
	IsolatedNetwork string
	// MaxQuota is the ceiling a request may ask for.
	MaxQuota Quota
}

// digestImageRE matches image refs pinned by @sha256:<64hex>.
var digestImageRE = regexp.MustCompile(`^(.+)@sha256:[0-9a-f]{64}$`)

// ValidateImage requires a whitelisted repository AND a digest pin. Mutable
// tags (even latest) are rejected so a sandbox can't silently change code.
func (p Policy) ValidateImage(imageRef string) error {
	m := digestImageRE.FindStringSubmatch(strings.TrimSpace(imageRef))
	if m == nil {
		return fmt.Errorf("%w: image must be pinned by @sha256 digest: %q", ErrPolicyRejected, imageRef)
	}
	repo := m[1]
	for _, allowed := range p.AllowedRepositories {
		if repo == allowed || strings.HasPrefix(repo, allowed+"/") {
			return nil
		}
	}
	return fmt.Errorf("%w: repository not allowlisted: %q", ErrPolicyRejected, repo)
}

// ValidateSpec enforces the fail-closed security baseline. A backend that
// cannot meet the spec must refuse rather than run weakly.
func (p Policy) ValidateSpec(s SecuritySpec) error {
	if !s.NonRoot {
		return fmt.Errorf("%w: NonRoot must be true", ErrWeakIsolation)
	}
	if !s.NoNewPrivileges {
		return fmt.Errorf("%w: NoNewPrivileges must be true", ErrWeakIsolation)
	}
	if !s.ReadOnlyRootfs {
		return fmt.Errorf("%w: ReadOnlyRootfs must be true", ErrWeakIsolation)
	}
	if s.RunUID == 0 {
		return fmt.Errorf("%w: RunUID must be non-zero", ErrWeakIsolation)
	}
	if s.WorkspaceMountTarget == "" || s.WorkspaceMountTarget != "/workspace" {
		return fmt.Errorf("%w: workspace must mount at /workspace", ErrWeakIsolation)
	}
	if s.IsolateStationNet {
		if strings.TrimSpace(p.IsolatedNetwork) == "" {
			return fmt.Errorf("%w: isolation requested but no isolated network configured", ErrWeakIsolation)
		}
	}
	if !dropsAll(s.DropCapabilities) {
		return fmt.Errorf("%w: must drop ALL capabilities", ErrWeakIsolation)
	}
	if s.Quota.MemoryBytes <= 0 || s.Quota.PidsLimit <= 0 {
		return fmt.Errorf("%w: memory and pids quota are required", ErrWeakIsolation)
	}
	if p.MaxQuota.MemoryBytes > 0 && s.Quota.MemoryBytes > p.MaxQuota.MemoryBytes {
		return fmt.Errorf("%w: memory %d exceeds ceiling %d", ErrPolicyRejected, s.Quota.MemoryBytes, p.MaxQuota.MemoryBytes)
	}
	if p.MaxQuota.PidsLimit > 0 && s.Quota.PidsLimit > p.MaxQuota.PidsLimit {
		return fmt.Errorf("%w: pids %d exceeds ceiling %d", ErrPolicyRejected, s.Quota.PidsLimit, p.MaxQuota.PidsLimit)
	}
	return nil
}

// Validate enforces image + spec before any runtime contact.
func (p Policy) Validate(req AllocRequest) error {
	if strings.TrimSpace(req.SandboxRef) == "" || strings.TrimSpace(req.VolumeRef) == "" {
		return fmt.Errorf("%w: sandbox_ref and volume_ref are required", ErrPolicyRejected)
	}
	if err := p.ValidateImage(req.ImageRef); err != nil {
		return err
	}
	return p.ValidateSpec(req.Security)
}

func dropsAll(drop []string) bool {
	for _, c := range drop {
		if strings.EqualFold(strings.TrimSpace(c), "ALL") {
			return true
		}
	}
	return false
}
