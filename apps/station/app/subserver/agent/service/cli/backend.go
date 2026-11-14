package cli

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// backendLaunch owns the connection projection. User argv/env never competes
// with these fields, and credentials are supplied only through child env.
func backendLaunch(adapter, baseURL, modelID string, credentials map[string]string) ([]string, []string, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL != "" {
		parsed, err := url.Parse(baseURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") ||
			parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, nil, fmt.Errorf("CLI backend URL must be an HTTP endpoint without credentials or query")
		}
	}
	switch adapter {
	case "codex":
		if baseURL == "" && credentials["CODEX_API_KEY"] == "" {
			return nil, nil, nil
		}
		if baseURL == "" {
			baseURL = "https://api.openai.com/v1"
		}
		var args []string
		for _, entry := range [][2]string{
			{"model_provider", "station"},
			{"model_providers.station.name", "Station"},
			{"model_providers.station.base_url", baseURL},
			{"model_providers.station.env_key", "CODEX_API_KEY"},
			{"model_providers.station.wire_api", "responses"},
		} {
			args = append(args, "-c", entry[0]+"="+strconv.Quote(entry[1]))
		}
		return args, nil, nil
	case "claude":
		var env []string
		if baseURL != "" {
			env = append(env, "ANTHROPIC_BASE_URL="+baseURL)
		}
		if key := credentials["ANTHROPIC_API_KEY"]; key != "" {
			env = append(env, "ANTHROPIC_AUTH_TOKEN="+key)
		}
		if modelID != "" && modelID != "default" {
			for _, key := range []string{"ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"} {
				env = append(env, key+"="+modelID)
			}
		}
		return nil, env, nil
	default:
		if baseURL != "" {
			return nil, nil, fmt.Errorf("CLI adapter does not support a custom endpoint")
		}
		return nil, nil, nil
	}
}
