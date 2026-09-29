package bootstrap

import (
	"strings"
	"testing"
)

func TestVercelRequiresBridgeSecretAndReturnAllowlist(t *testing.T) {
	t.Setenv("VERCEL", "1")
	t.Setenv("OAUTH_SITES_JSON", `[{
		"site_id":"main",
		"success_url":"https://app.example/success",
		"error_url":"https://app.example/error",
		"providers":{"github":{
			"client_id":"client",
			"client_secret":"secret",
			"redirect_uri":"https://broker.example/api/oauth/github/callback"
		}}
	}]`)
	if _, err := LoadSiteRegistry(); err == nil || !strings.Contains(err.Error(), "production_bridge_secret_required") {
		t.Fatalf("expected bridge-secret failure, got %v", err)
	}

	t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", "bridge-secret")
	if _, err := LoadSiteRegistry(); err == nil || !strings.Contains(err.Error(), "production_return_to_allowlist_required") {
		t.Fatalf("expected return allowlist failure, got %v", err)
	}

	t.Setenv("OAUTH_SITES_JSON", `[{
		"site_id":"main",
		"success_url":"https://app.example/success",
		"error_url":"https://app.example/error",
		"allowed_return_to":["peers-touch://oauth/callback"],
		"providers":{"github":{
			"client_id":"client",
			"client_secret":"secret",
			"redirect_uri":"https://broker.example/api/oauth/github/callback"
		}}
	}]`)
	if _, err := LoadSiteRegistry(); err != nil {
		t.Fatalf("valid production sites rejected: %v", err)
	}
}

func TestVercelRejectsMemoryStorage(t *testing.T) {
	t.Setenv("VERCEL", "1")
	t.Setenv("OAUTH_STORAGE_DRIVER", "memory")
	if _, err := LoadStorageConfig(); err == nil || err.Error() != "memory_storage_forbidden_on_vercel" {
		t.Fatalf("expected Vercel memory rejection, got %v", err)
	}
}

func TestSitesJSONStoresNormalizedValues(t *testing.T) {
	t.Setenv("VERCEL", "")
	t.Setenv("OAUTH_SITES_JSON", `[{
		"site_id":" main ",
		"success_url":" https://app.example/success ",
		"error_url":" https://app.example/error ",
		"allowed_return_to":[" peers-touch://oauth/callback?ignored=1 "],
		"providers":{" github ":{
			"client_id":" client ",
			"client_secret":" secret ",
			"redirect_uri":" https://broker.example/api/oauth/github/callback ",
			"scope":" read:user "
		}}
	}]`)

	registry, err := LoadSiteRegistry()
	if err != nil {
		t.Fatal(err)
	}
	site, ok := registry.Get("main")
	if !ok {
		t.Fatal("normalized site id not found")
	}
	if site.SuccessURL != "https://app.example/success" ||
		site.ErrorURL != "https://app.example/error" ||
		len(site.AllowedReturnTo) != 1 ||
		site.AllowedReturnTo[0] != "peers-touch://oauth/callback" {
		t.Fatalf("site values were not normalized: %#v", site)
	}
	provider, ok := site.Providers["github"]
	if !ok {
		t.Fatal("normalized provider not found")
	}
	if provider.ClientID != "client" ||
		provider.ClientSecret != "secret" ||
		provider.RedirectURI != "https://broker.example/api/oauth/github/callback" ||
		provider.Scope != "read:user" {
		t.Fatalf("provider values were not normalized: %#v", provider)
	}
}
