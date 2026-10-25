package operatorauth

import (
	"crypto/ed25519"
	"testing"
)

func basePrivateHTTPConfig(callback string, allowPrivate bool) Config {
	publicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		panic(err)
	}
	return Config{
		SiteID:           "corpstable",
		Audience:         "client-control-admin",
		Provider:         "github",
		BrokerStartURL:   "https://broker.example/api/oauth/github/start",
		CallbackURL:      callback,
		ConsoleURL:       callback,
		SigningKeys:      map[string]ed25519.PublicKey{"k": publicKey},
		AllowedSubjects:  map[string]struct{}{"github:operator": {}},
		AllowPrivateHTTP: allowPrivate,
	}
}

func TestValidateConfigPrivateHTTPCallback(t *testing.T) {
	cases := []struct {
		name       string
		callback   string
		allow      bool
		shouldPass bool
	}{
		{"private with flag", "http://10.37.221.38:18082/api/admin/auth/callback", true, true},
		{"loopback with flag", "http://127.0.0.1:18082/api/admin/auth/callback", true, true},
		{"private without flag", "http://10.37.221.38:18082/api/admin/auth/callback", false, false},
		{"public ip with flag", "http://8.8.8.8:18082/api/admin/auth/callback", true, false},
		{"domain with flag", "http://corp.internal:18082/api/admin/auth/callback", true, false},
		{"https stays flag free", "https://xconfig.example/api/admin/auth/callback", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateConfig(basePrivateHTTPConfig(tc.callback, tc.allow))
			if tc.shouldPass && err != nil {
				t.Fatalf("expected valid config, got %v", err)
			}
			if !tc.shouldPass && err == nil {
				t.Fatalf("expected invalid config for %s", tc.callback)
			}
		})
	}
}
