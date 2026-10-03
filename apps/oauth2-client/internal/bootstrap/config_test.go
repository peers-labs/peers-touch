package bootstrap

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setCompleteGitHubStorageEnvironment(t *testing.T) {
	t.Helper()
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	t.Setenv("VERCEL", "1")
	t.Setenv("OAUTH_STORAGE_DRIVER", "github")
	t.Setenv("OAUTH_GITHUB_API_BASE_URL", "https://api.github.com")
	t.Setenv("OAUTH_GITHUB_STORAGE_OWNER", "owner")
	t.Setenv("OAUTH_GITHUB_STORAGE_REPO", "repository")
	t.Setenv("OAUTH_GITHUB_STORAGE_BRANCH", "main")
	t.Setenv("OAUTH_GITHUB_APP_ID", "1")
	t.Setenv("OAUTH_GITHUB_APP_INSTALLATION_ID", "2")
	t.Setenv(
		"OAUTH_GITHUB_APP_PRIVATE_KEY_B64",
		base64.StdEncoding.EncodeToString([]byte("invalid-pem-for-config-only")),
	)
	t.Setenv("OAUTH_CREDENTIAL_ACTIVE_KEY_ID", "v1")
	t.Setenv("OAUTH_CREDENTIAL_KEY_V1", key)
	t.Setenv("OAUTH_STORAGE_INDEX_HMAC_KEY", key)
	t.Setenv("OAUTH_AUDIT_HMAC_KEY", key)
}

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

func TestGitHubStorageRejectsIncompleteProductionBootstrap(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
		want  string
	}{
		{
			name: "repository owner",
			key:  "OAUTH_GITHUB_STORAGE_OWNER",
			want: "github_storage_configuration_required",
		},
		{
			name: "repository name",
			key:  "OAUTH_GITHUB_STORAGE_REPO",
			want: "github_storage_configuration_required",
		},
		{
			name: "repository branch",
			key:  "OAUTH_GITHUB_STORAGE_BRANCH",
			want: "github_storage_configuration_required",
		},
		{
			name: "app id",
			key:  "OAUTH_GITHUB_APP_ID",
			want: "github_storage_configuration_required",
		},
		{
			name:  "installation id",
			key:   "OAUTH_GITHUB_APP_INSTALLATION_ID",
			value: "0",
			want:  "invalid_github_app_installation_id",
		},
		{
			name: "private key",
			key:  "OAUTH_GITHUB_APP_PRIVATE_KEY_B64",
			want: "invalid_oauth_github_app_private_key_b64",
		},
		{
			name: "active encryption key id",
			key:  "OAUTH_CREDENTIAL_ACTIVE_KEY_ID",
			want: "oauth_active_encryption_key_required",
		},
		{
			name:  "encryption key ring",
			key:   "OAUTH_CREDENTIAL_KEY_V1",
			value: base64.StdEncoding.EncodeToString(make([]byte, 31)),
			want:  "invalid_oauth_encryption_key",
		},
		{
			name: "storage index hmac",
			key:  "OAUTH_STORAGE_INDEX_HMAC_KEY",
			want: "invalid_oauth_storage_index_hmac_key",
		},
		{
			name: "audit hmac",
			key:  "OAUTH_AUDIT_HMAC_KEY",
			want: "invalid_oauth_audit_hmac_key",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setCompleteGitHubStorageEnvironment(t)
			t.Setenv(test.key, test.value)
			if _, err := LoadStorageConfig(); err == nil || err.Error() != test.want {
				t.Fatalf("expected %s, got %v", test.want, err)
			}
		})
	}
}

func TestBuildOAuthStoreRejectsInvalidGitHubPrivateKey(t *testing.T) {
	setCompleteGitHubStorageEnvironment(t)
	config, err := LoadStorageConfig()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := BuildOAuthStore(config, nil); err == nil ||
		err.Error() != "invalid_github_app_private_key" {
		t.Fatalf("expected invalid private key rejection, got %v", err)
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
