package version

import (
	_ "embed"
	"strings"
)

// VERSION is the single source of truth for the OAuth broker semantic
// version (major.minor.patch). Bump the patch component per release
// with `make oauth-version-bump`.
//
//go:embed VERSION
var rawVersion string

// Version returns the trimmed major.minor.patch release identifier.
func Version() string {
	return strings.TrimSpace(rawVersion)
}
