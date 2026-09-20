package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

func EncodeModelCapabilityFlags(flags map[string]bool) (json.RawMessage, error) {
	if flags == nil {
		return nil, nil
	}

	canonical := make(map[string]bool, len(flags))
	for name, enabled := range flags {
		capabilityID := normalizeRuntimeCapabilityID(name)
		if capabilityID == "" || capabilityID != strings.TrimSpace(name) {
			return nil, fmt.Errorf("unsupported model capability %q", name)
		}
		canonical[capabilityID] = enabled
	}

	encoded, err := json.Marshal(canonical)
	if err != nil {
		return nil, fmt.Errorf("encode model capabilities: %w", err)
	}
	return encoded, nil
}

func DecodeModelCapabilityFlags(raw json.RawMessage) (map[string]bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}

	flags, err := parseModelCapabilityFlags(raw)
	if err != nil {
		return nil, fmt.Errorf("decode model capabilities: %w", err)
	}
	return map[string]bool(flags), nil
}

func ModelCapabilityFlagsFromNames(names []string) (map[string]bool, error) {
	flags := make(map[string]bool, len(names))
	for _, name := range names {
		capabilityID := normalizeRuntimeCapabilityID(name)
		if capabilityID == "" || capabilityID != strings.TrimSpace(name) {
			return nil, fmt.Errorf("unsupported model capability %q", name)
		}
		flags[capabilityID] = true
	}
	return flags, nil
}
