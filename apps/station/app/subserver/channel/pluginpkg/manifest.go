// Package pluginpkg defines the dynamic channel-plugin package format,
// manifest schema and install-time validation (lint). Plugins are external
// processes imported at runtime; they are never compiled into Station.
package pluginpkg

import (
	"encoding/json"
	"fmt"
	"runtime"
	"strings"
)

// Manifest is the plugin descriptor (plugin.json at the package root).
type Manifest struct {
	// SchemaVersion is the manifest format version supported by the host.
	SchemaVersion int `json:"schemaVersion"`
	// ID is a stable lowercase identifier, unique within a Station.
	ID string `json:"id"`
	// Name/Description are human-readable and may be localized by the UI later.
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Version     string `json:"version"`
	// ProviderKind names the messaging platform, e.g. "lark". It is opaque to
	// the host; capabilities declare what the plugin can actually do.
	ProviderKind string `json:"providerKind"`
	// Entry maps the host GOOS/GOARCH key ("linux/amd64") to a relative
	// executable path inside the package.
	Entry map[string]Entrypoint `json:"entry"`
	// Capabilities are reviewed against an allow-list at install time.
	Capabilities []string `json:"capabilities,omitempty"`
	// ConfigSchema is an optional JSON-schema fragment the UI/host validates.
	ConfigSchema map[string]any `json:"configSchema,omitempty"`
	// Protocol declares the stdio JSON-RPC contract range the plugin speaks.
	Protocol ProtocolRange `json:"protocol"`
	// Provenance records where the package came from. It is attribution, not
	// a security boundary.
	Provenance Provenance `json:"provenance,omitempty"`
}

// Entrypoint names the executable relative to the package root.
type Entrypoint struct {
	Path string `json:"path"`
	// Args are fixed, non-user-supplied arguments prepended on launch.
	Args []string `json:"args,omitempty"`
}

// ProtocolRange is the host/plugin negotiated contract range.
type ProtocolRange struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// Provenance is non-secret attribution for an imported package.
type Provenance struct {
	Source     string `json:"source,omitempty"`     // "directory" | "archive"
	ImportedAt string `json:"importedAt,omitempty"` // RFC3339
}

// CurrentSchemaVersion is the manifest version this host writes/accepts.
const CurrentSchemaVersion = 1

// knownCapabilities is the install-time allow-list. A plugin requesting an
// unknown capability is rejected. Capabilities are coarse by design for fp-01;
// later feature points refine per-platform scopes.
var knownCapabilities = map[string]struct{}{
	"messaging.send":         {},
	"messaging.receive":      {},
	"messaging.longconn":     {},
	"messaging.rich-content": {},
	"messaging.resources":    {},
	"messaging.cards":        {},
	"messaging.groups":       {},
	"directory.read":         {},
	"runtimecard.render":     {},
}

// PlatformKey returns the entry lookup key for the running host.
func PlatformKey() string { return runtime.GOOS + "/" + runtime.GOARCH }

// Lint validates the manifest and resolves the entrypoint for this platform.
// It performs no filesystem work; install handles path safety.
func (m Manifest) Lint() (Entrypoint, error) {
	var problems []string
	if m.SchemaVersion != CurrentSchemaVersion {
		problems = append(problems, fmt.Sprintf("schemaVersion must be %d", CurrentSchemaVersion))
	}
	if !isValidID(m.ID) {
		problems = append(problems, "id must be 2-64 chars: lowercase letters, digits, dash")
	}
	if strings.TrimSpace(m.Name) == "" {
		problems = append(problems, "name is required")
	}
	if strings.TrimSpace(m.Version) == "" {
		problems = append(problems, "version is required")
	}
	if !isValidID(m.ProviderKind) {
		problems = append(problems, "providerKind must be a valid id")
	}
	if m.Protocol.Min < 1 || m.Protocol.Max < m.Protocol.Min {
		problems = append(problems, "protocol range invalid")
	}
	entry, ok := m.Entry[PlatformKey()]
	if !ok {
		problems = append(problems, "no executable entry for platform "+PlatformKey())
	} else if strings.TrimSpace(entry.Path) == "" {
		problems = append(problems, "entry path is empty")
	}
	for _, capName := range m.Capabilities {
		if _, ok := knownCapabilities[capName]; !ok {
			problems = append(problems, "unknown capability: "+capName)
		}
	}
	if len(problems) > 0 {
		return Entrypoint{}, &LintError{Problems: problems}
	}
	return entry, nil
}

func isValidID(id string) bool {
	id = strings.TrimSpace(id)
	if len(id) < 2 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
		default:
			return false
		}
	}
	return true
}

// LintError reports every manifest problem at once.
type LintError struct{ Problems []string }

func (e *LintError) Error() string {
	return "invalid plugin manifest: " + strings.Join(e.Problems, "; ")
}

// ParseManifest decodes and lints raw plugin.json.
func ParseManifest(raw []byte) (Manifest, Entrypoint, error) {
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return Manifest{}, Entrypoint{}, &LintError{Problems: []string{"manifest is not valid JSON: " + err.Error()}}
	}
	entry, err := m.Lint()
	if err != nil {
		return m, Entrypoint{}, err
	}
	return m, entry, nil
}
