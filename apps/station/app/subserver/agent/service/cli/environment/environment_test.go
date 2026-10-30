package environment

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrivateEnvironmentRejectsOverridesAndDoesNotInheritAuthentication(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	t.Setenv("CODEX_API_KEY", "station-key-must-not-leak")
	t.Setenv("BASH_ENV", "/station/init.sh")
	t.Setenv("XDG_CONFIG_HOME", "/station/config")
	alice, err := ActorRoot(root, "ptid:person:alice/../../escape")
	if err != nil {
		t.Fatal(err)
	}
	bob, _ := ActorRoot(root, "ptid:person:bob")
	if alice == bob || filepath.Dir(alice) != filepath.Join(root, "actors") {
		t.Fatal("actor identity escaped or collided")
	}
	entries, err := Build(ToolRoot(alice, "codex-cli"), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]string{}
	for _, entry := range entries {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	if values["HOME"] == root || values["CODEX_API_KEY"] != "" || values["BASH_ENV"] != "" ||
		values["XDG_CONFIG_HOME"] == "/station/config" {
		t.Fatal("private CLI environment inherited Station state")
	}
	for _, key := range []string{"HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "TMPDIR", "CODEX_HOME", "CLAUDE_CONFIG_DIR"} {
		info, err := os.Stat(values[key])
		if err != nil || info.Mode().Perm() != 0o700 {
			t.Fatalf("%s directory is not private: %v", key, err)
		}
	}
	for _, key := range []string{"HOME", "TMPDIR", "XDG_CACHE_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR",
		"CURSOR_CONFIG_DIR", "PATH", "BASH_ENV", "NODE_OPTIONS", "LD_PRELOAD", "NPM_CONFIG_USERCONFIG", "ANTHROPIC_API_KEY"} {
		if _, err := Build(ToolRoot(alice, "codex-cli"), nil, map[string]string{key: "override"}); err == nil {
			t.Fatalf("reserved environment variable accepted: %s", key)
		}
	}
}
