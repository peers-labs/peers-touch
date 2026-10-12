package ingest

import "regexp"

// redactionPatterns catches high-entropy secret-looking label values (webhook
// secrets, bearer tokens, generic key assignments) so agent diagnostics never
// leak credentials into stored messages or logs.
var redactionPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)ptsec_[0-9a-f]{16,}`),
	regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._\-]{16,}`),
	regexp.MustCompile(`(?i)(secret|token|password|api[_-]?key|authorization)\s*[:=]\s*\S+`),
}

const redactedMarker = "[REDACTED]"

// RedactSecretLike masks secret-shaped substrings in a label value. Values
// whose key is itself secret-bearing are redacted wholesale by the caller
// path if desired; here we apply content-based masking only.
func RedactSecretLike(key, value string) string {
	for _, pattern := range redactionPatterns {
		value = pattern.ReplaceAllString(value, redactedMarker)
	}
	return value
}
