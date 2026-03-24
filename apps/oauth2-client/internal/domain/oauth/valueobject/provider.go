package valueobject

import "strings"

type Provider string

const (
	ProviderGitHub Provider = "github"
	ProviderGoogle Provider = "google"
	ProviderWeixin Provider = "weixin"
)

func ParseProvider(raw string) (Provider, bool) {
	p := Provider(strings.ToLower(strings.TrimSpace(raw)))
	switch p {
	case ProviderGitHub, ProviderGoogle, ProviderWeixin:
		return p, true
	default:
		return "", false
	}
}
