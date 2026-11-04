package managed

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/environment"
)

// installEnv is private installation state. Wrappers never export this state
// into an actor invocation.
type installEnv struct {
	root     string
	binDir   string
	nodeDir  string
	stateDir string
	npmCache string
}

func newInstallEnv(root string) *installEnv {
	return &installEnv{
		root: root, binDir: filepath.Join(root, "bin"), nodeDir: filepath.Join(root, "node"),
		stateDir: filepath.Join(root, "install-state"), npmCache: filepath.Join(root, "install-state", "cache", "npm"),
	}
}

func (e *installEnv) npmBinary() string {
	return filepath.Join(e.nodeDir, "bin", "npm")
}

func (e *installEnv) commandEnv() ([]string, error) {
	return environment.Build(e.stateDir, []string{filepath.Join(e.nodeDir, "bin")}, nil)
}

func wrapperReady(root, command string) bool {
	info, err := os.Stat(filepath.Join(root, "bin", command))
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}

func installedVersion(root string, spec Spec) string {
	if spec.Kind != KindNPM || spec.Package == "" {
		return ""
	}
	packageName := strings.TrimSpace(spec.Package)
	if at := strings.LastIndex(packageName, "@"); at > 0 {
		packageName = packageName[:at]
	}
	raw, err := os.ReadFile(filepath.Join(root, "tools", spec.ProviderID, "current", "node_modules",
		filepath.FromSlash(packageName), "package.json"))
	if err != nil {
		return ""
	}
	var payload struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	return strings.TrimSpace(payload.Version)
}
