package federation

import (
	"errors"
	"net/url"
	"strings"
)

// CanonicalStationOrigin validates one root HTTP(S) Station origin.
func CanonicalStationOrigin(raw string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Hostname() == "" ||
		parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" {
		return "", errors.New("Station origin is not canonical")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}
