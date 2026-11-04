package cli

import (
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/environment"
)

func TestBackendLaunchBindsProtocolAndKeepsSecretsOutOfArgv(t *testing.T) {
	args, env, err := backendLaunch("codex", "https://models.example/api/v3/", "endpoint-model", map[string]string{"CODEX_API_KEY": "private-key"})
	joined := strings.Join(args, "\n")
	if err != nil || len(env) != 0 || !strings.Contains(joined, `base_url="https://models.example/api/v3"`) ||
		!strings.Contains(joined, `wire_api="responses"`) || !strings.Contains(joined, `env_key="CODEX_API_KEY"`) ||
		strings.Contains(joined, "private-key") {
		t.Fatal("Codex backend projection did not preserve the explicit source")
	}
	args, env, err = backendLaunch("claude", "https://models.example/anthropic", "endpoint-model", map[string]string{"ANTHROPIC_API_KEY": "private-key"})
	joined = strings.Join(env, "\n")
	if err != nil || len(args) != 0 || !strings.Contains(joined, "ANTHROPIC_AUTH_TOKEN=private-key") ||
		!strings.Contains(joined, "ANTHROPIC_DEFAULT_HAIKU_MODEL=endpoint-model") ||
		!strings.Contains(joined, "ANTHROPIC_BASE_URL=https://models.example/anthropic") {
		t.Fatal("Claude submodels or authentication escaped the selected source")
	}
	for _, endpoint := range []string{"https://key@example.com/v1", "https://example.com/?token=secret", "file:///tmp/config"} {
		if _, _, err := backendLaunch("codex", endpoint, "model", nil); err == nil {
			t.Fatal("accepted a non-endpoint URL")
		}
	}
	if _, _, err := backendLaunch("cursor", "https://models.example", "model", nil); err == nil {
		t.Fatal("unsupported adapter accepted an external source")
	}
}

func TestBackendLaunchRejectsAlternateConfigurationEntrypoints(t *testing.T) {
	for _, key := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "OPENAI_BASE_URL", "CODEX_PROFILE", "CLAUDE_CONFIG_DIR"} {
		if environment.ValidateConfiguration(map[string]string{key: "override"}) == nil {
			t.Errorf("accepted backend override %s", key)
		}
	}
	for _, argument := range []string{"--settings=override.json", "--model=other", "-cmodel_provider=other", "--resume", "--system-prompt=other", "--cwd=/tmp"} {
		if ValidateStartupArgs([]string{argument}) == nil {
			t.Errorf("accepted configuration override %s", argument)
		}
	}
}
