package bootstrap

import (
	"encoding/base64"
	"testing"
)

const operatorLoginTestCallback = "/api/admin/auth/callback"

func operatorLoginTestSecrets(t *testing.T) (string, string) {
	t.Helper()
	seed := base64.StdEncoding.EncodeToString(make([]byte, 32))
	secret := base64.StdEncoding.EncodeToString(make([]byte, 32))
	return seed, secret
}

func setSiteScopedOperatorEnv(t *testing.T, siteID string, callbackURL string, allowPrivate string) {
	t.Helper()
	seed, secret := operatorLoginTestSecrets(t)
	prefix := "OAUTH_OPERATOR_LOGIN_" + operatorLoginSiteEnvSegment(siteID) + "_"
	t.Setenv(prefix+"AUDIENCE", "client-control-admin")
	t.Setenv(prefix+"CALLBACK_URL", callbackURL)
	t.Setenv(prefix+"SIGNING_KEY_ID", "operator-login-test")
	t.Setenv(prefix+"SIGNING_PRIVATE_KEY_B64", seed)
	t.Setenv(prefix+"REDEEM_SECRET_B64", secret)
	t.Setenv(prefix+"ALLOW_PRIVATE_HTTP", allowPrivate)
}

func TestSiteScopedOperatorLoginAllowsPrivateIPCallback(t *testing.T) {
	t.Setenv("OAUTH_OPERATOR_LOGIN_SITE_ID", "default")
	setSiteScopedOperatorEnv(t, "corpstable", "http://10.37.221.38:18082"+operatorLoginTestCallback, "1")

	config, err := buildOperatorLoginConfig("corpstable", nil)
	if err != nil {
		t.Fatalf("private-IP operator callback rejected: %v", err)
	}
	if config == nil {
		t.Fatal("expected site-scoped operator config, got nil")
	}
	if config.CallbackURL != "http://10.37.221.38:18082"+operatorLoginTestCallback {
		t.Fatalf("unexpected callback %q", config.CallbackURL)
	}
}

func TestSiteScopedOperatorLoginRejectsHTTPCallbackWithoutFlag(t *testing.T) {
	t.Setenv("OAUTH_OPERATOR_LOGIN_SITE_ID", "default")
	setSiteScopedOperatorEnv(t, "corpstable", "http://10.37.221.38:18082"+operatorLoginTestCallback, "")

	_, err := buildOperatorLoginConfig("corpstable", nil)
	if err == nil || err.Error() != "invalid_operator_login_configuration" {
		t.Fatalf("expected configuration error for unflagged HTTP callback, got %v", err)
	}
}

func TestPrivateHTTPRejectsNonPrivateHosts(t *testing.T) {
	t.Setenv("OAUTH_OPERATOR_LOGIN_SITE_ID", "default")
	for _, callbackURL := range []string{
		"http://corp.internal.example:18082" + operatorLoginTestCallback,
		"http://8.8.8.8:18082" + operatorLoginTestCallback,
		"http://[fc00::1]:18082" + operatorLoginTestCallback,
		"http://10.37.221.38:18082" + operatorLoginTestCallback + "?next=/",
	} {
		setSiteScopedOperatorEnv(t, "corpstable", callbackURL, "1")
		if _, err := buildOperatorLoginConfig("corpstable", nil); err == nil {
			t.Fatalf("expected rejection for %q", callbackURL)
		}
	}
}

func TestPrivateHTTPAcceptsLoopbackAndLinkLocalV4(t *testing.T) {
	t.Setenv("OAUTH_OPERATOR_LOGIN_SITE_ID", "default")
	for _, callbackURL := range []string{
		"http://127.0.0.1:18082" + operatorLoginTestCallback,
		"http://192.168.1.2:18082" + operatorLoginTestCallback,
		"http://169.254.10.1:18082" + operatorLoginTestCallback,
		"http://[::1]:18082" + operatorLoginTestCallback,
	} {
		setSiteScopedOperatorEnv(t, "corpstable", callbackURL, "true")
		if _, err := buildOperatorLoginConfig("corpstable", nil); err != nil {
			t.Fatalf("expected acceptance for %q, got %v", callbackURL, err)
		}
	}
}

func TestGenericOperatorBlockDoesNotLeakAcrossSites(t *testing.T) {
	t.Setenv("OAUTH_OPERATOR_LOGIN_SITE_ID", "default")
	t.Setenv("OAUTH_OPERATOR_LOGIN_AUDIENCE", "client-control-admin")
	t.Setenv("OAUTH_OPERATOR_LOGIN_CALLBACK_URL", "https://xconfig.example/api/admin/auth/callback")
	t.Setenv("OAUTH_OPERATOR_LOGIN_SIGNING_KEY_ID", "operator-login-test")
	seed, secret := operatorLoginTestSecrets(t)
	t.Setenv("OAUTH_OPERATOR_LOGIN_SIGNING_PRIVATE_KEY_B64", seed)
	t.Setenv("OAUTH_OPERATOR_LOGIN_REDEEM_SECRET_B64", secret)

	config, err := buildOperatorLoginConfig("corpstable", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if config != nil {
		t.Fatalf("generic operator block leaked into unmatching site: %+v", config)
	}
}

func TestHTTPSOperatorCallbackStaysFlagFree(t *testing.T) {
	raw := &rawOperatorLogin{
		Audience:             "client-control-admin",
		CallbackURL:          "https://xconfig.example/api/admin/auth/callback",
		SigningKeyID:         "operator-login-test",
		SigningPrivateKeyB64: base64.StdEncoding.EncodeToString(make([]byte, 32)),
		RedeemSecretB64:      base64.StdEncoding.EncodeToString(make([]byte, 32)),
	}
	config, err := buildOperatorLoginConfig("default", raw)
	if err != nil {
		t.Fatalf("HTTPS callback rejected without private-HTTP flag: %v", err)
	}
	if config == nil {
		t.Fatal("expected operator config")
	}
}
