package bootstrap

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"testing"
)

func TestBuildContainerInLocalMemoryMode(t *testing.T) {
	t.Setenv("VERCEL", "")
	t.Setenv("OAUTH_STORAGE_DRIVER", "memory")
	t.Setenv("OAUTH_SITES_JSON", `[{
		"site_id":"main",
		"success_url":"https://app.example/success",
		"error_url":"https://app.example/error",
		"allowed_return_to":["peers-touch://oauth/callback"],
		"bridge_secret":"bridge-secret",
		"providers":{"github":{
			"client_id":"client",
			"client_secret":"secret",
			"redirect_uri":"https://broker.example/api/oauth/github/callback"
		}}
	}]`)
	t.Setenv("OAUTH_ADMIN_USERNAME", "")
	t.Setenv("OAUTH_ADMIN_PASSWORD_HASH", "")

	container, err := BuildContainer()
	if err != nil {
		t.Fatal(err)
	}
	if container.Handler == nil || container.Admin == nil || container.Store == nil {
		t.Fatalf("incomplete local container: %#v", container)
	}
	if container.Maintenance != nil {
		t.Fatalf("memory mode unexpectedly exposed maintenance: %#v", container.Maintenance)
	}
}

func TestStorageHTTPClientIsBounded(t *testing.T) {
	if timeout := storageHTTPClient().Timeout; timeout <= 0 {
		t.Fatalf("storage HTTP timeout must be positive, got %s", timeout)
	}
}

func productionPrivateKey(t *testing.T) string {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	privateDER := x509.MarshalPKCS1PrivateKey(privateKey)
	privatePEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privateDER,
	})
	return base64.StdEncoding.EncodeToString(privatePEM)
}

func setCompleteProductionBootstrapEnvironment(t *testing.T, privateKey string) {
	t.Helper()
	setCompleteGitHubStorageEnvironment(t)
	t.Setenv("OAUTH_GITHUB_APP_PRIVATE_KEY_B64", privateKey)
	t.Setenv("OAUTH_SITES_JSON", `[{
		"site_id":"main",
		"success_url":"https://app.example/success",
		"error_url":"https://app.example/error",
		"allowed_return_to":["peers-touch://oauth/callback"],
		"bridge_secret":"bridge-secret",
		"providers":{"github":{
			"client_id":"client",
			"client_secret":"secret",
			"redirect_uri":"https://broker.example/api/oauth/github/callback"
		}}
	}]`)
	t.Setenv("OAUTH_ADMIN_USERNAME", "operator")
	t.Setenv(
		"OAUTH_ADMIN_PASSWORD_HASH",
		"pbkdf2-sha256$100000$MDEyMzQ1Njc4OWFiY2RlZg==$pnq3X8b0RCPy3QPbc4tMRNkzzR3dLJBRf6HfSFzQh1Y=",
	)
}

func TestBuildContainerRejectsIncompleteProductionBootstrap(t *testing.T) {
	privateKey := productionPrivateKey(t)
	tests := []struct {
		name  string
		key   string
		value string
		want  string
	}{
		{name: "repository owner", key: "OAUTH_GITHUB_STORAGE_OWNER", want: "github_storage_configuration_required"},
		{name: "repository name", key: "OAUTH_GITHUB_STORAGE_REPO", want: "github_storage_configuration_required"},
		{name: "repository branch", key: "OAUTH_GITHUB_STORAGE_BRANCH", want: "github_storage_configuration_required"},
		{name: "app id", key: "OAUTH_GITHUB_APP_ID", want: "github_storage_configuration_required"},
		{name: "installation id", key: "OAUTH_GITHUB_APP_INSTALLATION_ID", value: "0", want: "invalid_github_app_installation_id"},
		{name: "private key encoding", key: "OAUTH_GITHUB_APP_PRIVATE_KEY_B64", want: "invalid_oauth_github_app_private_key_b64"},
		{name: "private key pem", key: "OAUTH_GITHUB_APP_PRIVATE_KEY_B64", value: base64.StdEncoding.EncodeToString([]byte("not-pem")), want: "invalid_github_app_private_key"},
		{name: "active encryption key id", key: "OAUTH_CREDENTIAL_ACTIVE_KEY_ID", want: "oauth_active_encryption_key_required"},
		{name: "encryption key ring", key: "OAUTH_CREDENTIAL_KEY_V1", value: base64.StdEncoding.EncodeToString(make([]byte, 31)), want: "invalid_oauth_encryption_key"},
		{name: "storage index hmac", key: "OAUTH_STORAGE_INDEX_HMAC_KEY", want: "invalid_oauth_storage_index_hmac_key"},
		{name: "invalid storage index hmac", key: "OAUTH_STORAGE_INDEX_HMAC_KEY", value: base64.StdEncoding.EncodeToString(make([]byte, 31)), want: "invalid_oauth_storage_index_hmac_key"},
		{name: "audit hmac", key: "OAUTH_AUDIT_HMAC_KEY", want: "invalid_oauth_audit_hmac_key"},
		{name: "invalid audit hmac", key: "OAUTH_AUDIT_HMAC_KEY", value: base64.StdEncoding.EncodeToString(make([]byte, 31)), want: "invalid_oauth_audit_hmac_key"},
		{name: "admin username", key: "OAUTH_ADMIN_USERNAME", want: "admin_auth_configuration_required"},
		{name: "admin digest", key: "OAUTH_ADMIN_PASSWORD_HASH", want: "admin_auth_configuration_required"},
		{name: "invalid admin digest", key: "OAUTH_ADMIN_PASSWORD_HASH", value: "not-a-password-hash", want: "invalid_admin_password_hash"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setCompleteProductionBootstrapEnvironment(t, privateKey)
			t.Setenv(test.key, test.value)
			if _, err := BuildContainer(); err == nil || err.Error() != test.want {
				t.Fatalf("expected %s, got %v", test.want, err)
			}
		})
	}
}

func TestBuildContainerValidatesCompleteProductionBootstrap(t *testing.T) {
	setCompleteProductionBootstrapEnvironment(t, productionPrivateKey(t))
	container, err := BuildContainer()
	if err != nil {
		t.Fatal(err)
	}
	if container.Handler == nil ||
		container.Admin == nil ||
		container.Store == nil ||
		container.Maintenance == nil {
		t.Fatalf("incomplete production container: %#v", container)
	}
}
