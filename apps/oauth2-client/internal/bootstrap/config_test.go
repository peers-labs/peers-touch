package bootstrap

import (
	"os"
	"path/filepath"
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

func TestVercelRejectsHTTPProviderRedirect(t *testing.T) {
	t.Setenv("VERCEL", "1")
	t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", "bridge-secret")
	t.Setenv("OAUTH_SITES_JSON", `[{
		"site_id":"main",
		"success_url":"https://app.example/success",
		"error_url":"https://app.example/error",
		"allowed_return_to":["peers-touch://oauth/callback"],
		"providers":{"github":{
			"client_id":"client",
			"client_secret":"secret",
			"redirect_uri":"http://broker.example/api/oauth/github/callback"
		}}
	}]`)
	if _, err := LoadSiteRegistry(); err == nil ||
		err.Error() != "production_provider_redirect_https_required" {
		t.Fatalf("expected production HTTPS failure, got %v", err)
	}
}

func TestVercelRejectsMissingOrMemoryStorage(t *testing.T) {
	for name, driver := range map[string]string{
		"missing": "",
		"memory":  "memory",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("VERCEL", "1")
			t.Setenv("OAUTH_STORAGE_DRIVER", driver)
			_, err := LoadStorageConfig()
			if name == "missing" {
				if err == nil || err.Error() != "oauth_storage_driver_required" {
					t.Fatalf("expected missing-driver rejection, got %v", err)
				}
				return
			}
			if err == nil || err.Error() != "memory_storage_forbidden_on_vercel" {
				t.Fatalf("expected Vercel memory rejection, got %v", err)
			}
		})
	}
}

func TestConfigFileAllowedReturnToCanBeOverridden(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "sites.json")
	if err := os.WriteFile(configPath, []byte(`{
		"sites":[{
			"site_id":"main",
			"success_url":"https://app.example/success",
			"error_url":"https://app.example/error",
			"allowed_return_to":["https://stale.example/oauth/callback"],
			"providers":{"github":{"enabled":true}}
		}]
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VERCEL", "")
	t.Setenv("OAUTH_SITES_JSON", "")
	t.Setenv("OAUTH_CONFIG_FILE", configPath)
	t.Setenv("OAUTH_GITHUB_CLIENT_ID", "client")
	t.Setenv("OAUTH_GITHUB_CLIENT_SECRET", "secret")
	t.Setenv("OAUTH_GITHUB_REDIRECT_URI", "https://broker.example/api/oauth/github/callback")
	t.Setenv(
		"OAUTH_ALLOWED_RETURN_TO",
		" peers-touch://oauth/callback?ignored=1 , https://app.example/oauth/callback ",
	)

	registry, err := LoadSiteRegistry()
	if err != nil {
		t.Fatal(err)
	}
	site, ok := registry.Get("main")
	if !ok {
		t.Fatal("configured site not found")
	}
	if len(site.AllowedReturnTo) != 2 ||
		site.AllowedReturnTo[0] != "peers-touch://oauth/callback" ||
		site.AllowedReturnTo[1] != "https://app.example/oauth/callback" {
		t.Fatalf("environment allowlist did not override file values: %#v", site.AllowedReturnTo)
	}
}

func TestGitHubAPIBaseRequiresHTTPSOnVercel(t *testing.T) {
	t.Setenv("VERCEL", "1")
	t.Setenv("OAUTH_STORAGE_DRIVER", "github")
	t.Setenv("OAUTH_GITHUB_API_BASE_URL", "http://github.example")
	if _, err := LoadStorageConfig(); err == nil ||
		err.Error() != "production_github_api_https_required" {
		t.Fatalf("expected production GitHub HTTPS failure, got %v", err)
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

func TestVercelRequiresValidAdminAuthentication(t *testing.T) {
	t.Setenv("VERCEL", "1")
	t.Setenv("OAUTH_ADMIN_USERNAME", "")
	t.Setenv("OAUTH_ADMIN_PASSWORD_HASH", "")
	if _, err := LoadAdminAuthenticator(); err == nil ||
		err.Error() != "admin_auth_configuration_required" {
		t.Fatalf("expected missing admin auth failure, got %v", err)
	}

	t.Setenv("OAUTH_ADMIN_USERNAME", "operator")
	t.Setenv(
		"OAUTH_ADMIN_PASSWORD_HASH",
		"pbkdf2-sha256$100000$MDEyMzQ1Njc4OWFiY2RlZg==$pnq3X8b0RCPy3QPbc4tMRNkzzR3dLJBRf6HfSFzQh1Y=",
	)
	if auth, err := LoadAdminAuthenticator(); err != nil || auth == nil {
		t.Fatalf("valid admin auth rejected: auth=%#v err=%v", auth, err)
	}
}

func TestLocalAdminAuthenticationMayBeDisabled(t *testing.T) {
	t.Setenv("VERCEL", "")
	t.Setenv("OAUTH_ADMIN_USERNAME", "")
	t.Setenv("OAUTH_ADMIN_PASSWORD_HASH", "")
	auth, err := LoadAdminAuthenticator()
	if err != nil || auth != nil {
		t.Fatalf("optional local admin auth was not disabled: auth=%#v err=%v", auth, err)
	}
}
