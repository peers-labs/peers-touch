package logrus

import (
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	ls "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

// PackageFilter defines include/exclude patterns for package names.
// Patterns support exact match and simple prefix match when ending with '*'.
type PackageFilter struct {
	Include []string
	Exclude []string
}

func (pf PackageFilter) match(pattern, s string) bool {
	if pattern == "" {
		return false
	}
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(s, strings.TrimSuffix(pattern, "*"))
	}
	return s == pattern
}

// AllowPackage returns true if the package is allowed by the filter.
func (pf PackageFilter) AllowPackage(pkgPath string) bool {
	// deny-first strategy
	for _, p := range pf.Exclude {
		if pf.match(p, pkgPath) {
			return false
		}
	}
	if len(pf.Include) == 0 {
		return true
	}
	for _, p := range pf.Include {
		if pf.match(p, pkgPath) {
			return true
		}
	}
	return false
}

// FilteringFormatter wraps an inner formatter and suppresses output
// when the entry caller package does not satisfy the filter.
type FilteringFormatter struct {
	Inner  ls.Formatter
	Filter PackageFilter
}

func (f FilteringFormatter) Format(entry *ls.Entry) ([]byte, error) {
	// if no filter configured, delegate
	if len(f.Filter.Include) == 0 && len(f.Filter.Exclude) == 0 {
		return f.Inner.Format(entry)
	}

	pkgPath := callerPackagePath(entry)
	if !f.Filter.AllowPackage(pkgPath) {
		// suppress output entirely
		return []byte{}, nil
	}
	// enrich fields with pkg info for easier filtering/inspection downstream
	if entry.Data != nil {
		tail := tailPackage(pkgPath)
		entry.Data["pkg"] = tail
		entry.Data["pkg_path"] = pkgPath
	}
	return f.Inner.Format(entry)
}

// PackageFieldHook injects pkg and pkg_path fields into entries.
type PackageFieldHook struct {
	PkgPathReplacer map[string]string
}

func (h *PackageFieldHook) Levels() []ls.Level { return ls.AllLevels }

func (h *PackageFieldHook) Fire(e *ls.Entry) error {
	pkgPath := callerPackagePath(e)
	if e.Data != nil {
		e.Data["pkg"] = tailPackage(pkgPath)
		e.Data["pkg_path"] = replacePkgPath(pkgPath, h.PkgPathReplacer)
	}
	return nil
}

// callerPackagePath extracts the full package path from entry.Caller.Function.
func callerPackagePath(entry *ls.Entry) string {
	if entry == nil || entry.Caller == nil {
		return ""
	}
	fn := entry.Caller.Function
	// strip method/function suffix after last dot
	if idx := strings.LastIndex(fn, "."); idx != -1 {
		fn = fn[:idx]
	}
	// normalize path separators
	fn = filepath.ToSlash(fn)
	return fn
}

func tailPackage(pkgPath string) string {
	if pkgPath == "" {
		return ""
	}
	// take last segment after slash
	if idx := strings.LastIndex(pkgPath, "/"); idx != -1 {
		return pkgPath[idx+1:]
	}
	// fall back to raw path
	return pkgPath
}

// replacePkgPath replaces package path prefixes based on the replacer map.
// Matches longest prefix first to avoid conflicts.
func replacePkgPath(pkgPath string, replacer map[string]string) string {
	if len(replacer) == 0 {
		return pkgPath
	}

	// Sort keys by length (longest first) for proper prefix matching
	keys := make([]string, 0, len(replacer))
	for k := range replacer {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return len(keys[i]) > len(keys[j])
	})

	// Try to match and replace
	for _, prefix := range keys {
		if strings.HasPrefix(pkgPath, prefix) {
			replacement := replacer[prefix]
			return replacement + strings.TrimPrefix(pkgPath, prefix)
		}
	}

	return pkgPath
}

// ensure we reference runtime to prevent trimming in certain builds
var _ = runtime.Callers
