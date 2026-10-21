package service

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
)

var retiredAgentPromptConfigKeys = map[string]struct{}{
	"agentConfigPrompt":   {},
	"agent_config_prompt": {},
	"agents":              {},
	"agentsMd":            {},
	"agents_md":           {},
	"identity":            {},
	"soul":                {},
	"soulMd":              {},
	"soul_md":             {},
	"systemPrompt":        {},
	"system_prompt":       {},
}

func normalizeAgentConfigJSON(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	var config map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &config); err != nil || config == nil {
		return "", errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"config_json must be a JSON object",
			err,
		)
	}
	for key := range retiredAgentPromptConfigKeys {
		if _, exists := config[key]; exists {
			return "", errcode.New(
				errcode.AgentInvalidRequest,
				http.StatusBadRequest,
				"config_json contains retired Agent prompt aliases",
				nil,
			)
		}
	}
	normalized, err := json.Marshal(config)
	if err != nil {
		return "", errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to encode Agent config",
			err,
		)
	}
	return string(normalized), nil
}
