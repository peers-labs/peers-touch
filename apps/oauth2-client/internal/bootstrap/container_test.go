package bootstrap

import "testing"

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
