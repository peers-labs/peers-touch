// Package environment owns private CLI state and explicit child environments.
// Installation is shared; actor state is never shared with the Station account.
package environment

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var keyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func segment(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func ActorRoot(base, actorPTID string) (string, error) {
	if strings.TrimSpace(actorPTID) == "" {
		return "", fmt.Errorf("CLI execution requires an actor PTID")
	}
	return filepath.Join(base, "actors", segment(actorPTID)), nil
}

func ToolRoot(root, providerID string) string {
	return filepath.Join(root, "cli-state", segment(providerID))
}

// ValidateConfiguration is also used at the persistence boundary. Runtime
// repeats it so old stored configuration cannot bypass isolation.
func ValidateConfiguration(values map[string]string) error {
	for key, value := range values {
		upper := strings.ToUpper(key)
		if !keyPattern.MatchString(key) || len(value) > 8192 || strings.ContainsAny(value, "\x00\r\n") {
			return fmt.Errorf("CLI environment contains an invalid entry")
		}
		switch upper {
		case "HOME", "USERPROFILE", "PATH", "TMP", "TEMP", "TMPDIR", "RUST_LOG",
			"CODEX_HOME", "CLAUDE_CONFIG_DIR", "CURSOR_CONFIG_DIR",
			"BASH_ENV", "ENV", "NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "PYTHONHOME",
			"SSL_CERT_DIR", "SSL_CERT_FILE", "SYSTEMROOT", "COMSPEC":
			return fmt.Errorf("CLI environment cannot override execution-owned variables")
		}
		for _, prefix := range []string{"XDG_", "LD_", "DYLD_", "NPM_", "NPM_CONFIG_", "GIT_CONFIG_", "PEERS_TOUCH_",
			"ANTHROPIC_", "OPENAI_", "CODEX_", "CLAUDE_", "CURSOR_"} {
			if strings.HasPrefix(upper, prefix) {
				return fmt.Errorf("CLI environment cannot override execution-owned variables")
			}
		}
		if strings.Contains(upper, "SECRET") || strings.Contains(upper, "TOKEN") ||
			strings.Contains(upper, "PASSWORD") || strings.HasSuffix(upper, "_KEY") {
			return fmt.Errorf("CLI secrets belong in credential storage")
		}
	}
	return nil
}

// Build prepares private directories and returns no inherited credentials,
// login state or shell initialization hooks. PATH locates machine binaries;
// their application state still resolves exclusively inside root.
func Build(root string, pathEntries []string, configured map[string]string) ([]string, error) {
	if !filepath.IsAbs(root) {
		return nil, fmt.Errorf("CLI state root must be absolute")
	}
	if err := ValidateConfiguration(configured); err != nil {
		return nil, err
	}
	dirs := map[string]string{
		"HOME":              filepath.Join(root, "home"),
		"XDG_CONFIG_HOME":   filepath.Join(root, "config"),
		"XDG_CACHE_HOME":    filepath.Join(root, "cache"),
		"XDG_DATA_HOME":     filepath.Join(root, "data"),
		"XDG_STATE_HOME":    filepath.Join(root, "state"),
		"XDG_RUNTIME_DIR":   filepath.Join(root, "runtime"),
		"TMPDIR":            filepath.Join(root, "tmp"),
		"CODEX_HOME":        filepath.Join(root, "codex"),
		"CLAUDE_CONFIG_DIR": filepath.Join(root, "claude"),
		"CURSOR_CONFIG_DIR": filepath.Join(root, "cursor"),
	}
	values := make(map[string]string, len(dirs)+len(configured)+12)
	for key, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("prepare private CLI state: %w", err)
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return nil, err
		}
		values[key] = dir
	}
	for _, key := range []string{"LANG", "LC_ALL", "TZ", "SSL_CERT_DIR", "SSL_CERT_FILE", "SYSTEMROOT"} {
		if value, ok := os.LookupEnv(key); ok {
			values[key] = value
		}
	}
	values["USERPROFILE"] = values["HOME"]
	values["TEMP"], values["TMP"] = values["TMPDIR"], values["TMPDIR"]
	values["GIT_CONFIG_NOSYSTEM"], values["GIT_CONFIG_GLOBAL"] = "1", os.DevNull
	values["NO_COLOR"] = "1"
	// npm rejects loading the same file for user and global configuration.
	// Distinct private paths keep both layers isolated from Station settings.
	values["NPM_CONFIG_USERCONFIG"] = filepath.Join(dirs["XDG_CONFIG_HOME"], "npm-user.npmrc")
	values["NPM_CONFIG_GLOBALCONFIG"] = filepath.Join(dirs["XDG_CONFIG_HOME"], "npm-global.npmrc")
	paths := append([]string{}, pathEntries...)
	if systemPath := os.Getenv("PATH"); systemPath != "" {
		paths = append(paths, systemPath)
	}
	values["PATH"] = strings.Join(paths, string(os.PathListSeparator))
	for key, value := range configured {
		values[key] = value
	}
	result := make([]string, 0, len(values))
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result, nil
}

// Credentials accepts only the documented non-interactive adapter variables.
// Values come from the decrypted Provider envelope, never runtime config.
func Credentials(values map[string]string) ([]string, error) {
	var result []string
	for key, value := range values {
		switch key {
		case "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CURSOR_API_KEY":
		default:
			return nil, fmt.Errorf("CLI credential binding is unsupported")
		}
		if strings.ContainsAny(value, "\x00\r\n") {
			return nil, fmt.Errorf("CLI credential is invalid")
		}
		if value != "" {
			result = append(result, key+"="+value)
		}
	}
	return result, nil
}
