package service

import (
	"encoding/json"
	"regexp"
	"strings"
)

const diagnosticRedactedValue = "[REDACTED]"

var (
	diagnosticBearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+`)
	diagnosticEmailPattern  = regexp.MustCompile(`(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`)
	diagnosticPOSIXPath     = regexp.MustCompile(`(?:^|[\s"'=:])/(?:Users|home|private|var|tmp)/[^\s"',}]+`)
	diagnosticWindowsPath   = regexp.MustCompile(`(?i)\b[A-Z]:\\(?:[^\\\s"']+\\)*[^\\\s"']+`)
)

func redactDiagnosticText(value string) string {
	if strings.TrimSpace(value) == "" {
		return value
	}

	var decoded interface{}
	if json.Unmarshal([]byte(value), &decoded) == nil {
		encoded, err := json.Marshal(redactDiagnosticValue(decoded))
		if err == nil {
			return string(encoded)
		}
	}

	redacted := diagnosticBearerPattern.ReplaceAllString(value, diagnosticRedactedValue)
	redacted = diagnosticEmailPattern.ReplaceAllString(redacted, diagnosticRedactedValue)
	redacted = diagnosticPOSIXPath.ReplaceAllStringFunc(redacted, redactPathMatch)
	return diagnosticWindowsPath.ReplaceAllString(redacted, diagnosticRedactedValue)
}

func redactDiagnosticValue(value interface{}) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		redacted := make(map[string]interface{}, len(typed))
		for key, item := range typed {
			if isDiagnosticSecretKey(key) || isDiagnosticPathKey(key) || isDiagnosticPIIKey(key) {
				redacted[key] = diagnosticRedactedValue
				continue
			}
			redacted[key] = redactDiagnosticValue(item)
		}
		return redacted
	case []interface{}:
		redacted := make([]interface{}, len(typed))
		for index, item := range typed {
			redacted[index] = redactDiagnosticValue(item)
		}
		return redacted
	case string:
		return redactDiagnosticText(typed)
	default:
		return value
	}
}

func isDiagnosticSecretKey(key string) bool {
	normalized := strings.ToLower(key)
	return strings.Contains(normalized, "api_key") ||
		strings.Contains(normalized, "apikey") ||
		strings.Contains(normalized, "authorization") ||
		strings.Contains(normalized, "bearer") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "private_key") ||
		strings.Contains(normalized, "credential") ||
		normalized == "token" ||
		strings.HasSuffix(normalized, "_token") ||
		strings.Contains(normalized, "access_token") ||
		strings.Contains(normalized, "refresh_token") ||
		strings.Contains(normalized, "session_token") ||
		strings.Contains(normalized, "encryption_key") ||
		strings.Contains(normalized, "encryption_nonce")
}

func isDiagnosticPathKey(key string) bool {
	normalized := strings.ToLower(key)
	return normalized == "path" ||
		strings.HasSuffix(normalized, "_path") ||
		strings.Contains(normalized, "workspace_root") ||
		strings.Contains(normalized, "runtime_home")
}

func isDiagnosticPIIKey(key string) bool {
	normalized := strings.ToLower(key)
	return normalized == "email" ||
		normalized == "phone" ||
		normalized == "phone_number" ||
		normalized == "address"
}

func redactPathMatch(match string) string {
	if len(match) > 0 {
		switch match[0] {
		case ' ', '\t', '\n', '"', '\'', '=', ':':
			return match[:1] + diagnosticRedactedValue
		}
	}
	return diagnosticRedactedValue
}
