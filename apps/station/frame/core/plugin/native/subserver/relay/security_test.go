package relay

import (
	"context"
	"crypto/tls"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestDiscoveryControlRoutesUseRoutePublishCredential(t *testing.T) {
	t.Parallel()

	routePublishCalls := 0
	mountConnectCalls := 0
	marker := func(calls *int) server.Wrapper {
		return func(next server.EndpointHandler) server.EndpointHandler {
			return func(
				ctx context.Context,
				req server.Request,
				resp server.Response,
			) error {
				(*calls)++
				return next(ctx, req, resp)
			}
		}
	}
	subserver := &SubServer{
		opts:                   &Options{},
		mountJWTWrapper:        marker(&mountConnectCalls),
		routePublishJWTWrapper: marker(&routePublishCalls),
	}

	for _, handler := range newRelayHandler(subserver).handlers() {
		if handler.Path() != "/api/v1/relay/routes" &&
			handler.Path() != "/api/v1/relay/grants" {
			continue
		}
		wrappers := handler.Wrappers()
		if len(wrappers) == 0 {
			t.Fatalf("%s has no authentication wrapper", handler.Path())
		}
		err := wrappers[len(wrappers)-1](
			func(context.Context, server.Request, server.Response) error {
				return nil
			},
		)(context.Background(), nil, nil)
		if err != nil {
			t.Fatalf("%s wrapper probe: %v", handler.Path(), err)
		}
	}
	if routePublishCalls != 2 {
		t.Fatalf("route publish wrapper calls = %d, want 2", routePublishCalls)
	}
	if mountConnectCalls != 0 {
		t.Fatalf("mount connect wrapper handled discovery control routes")
	}
}

func TestValidateRelaySecurityOptions(t *testing.T) {
	t.Parallel()

	valid := validRelaySecurityOptions(t)
	material, err := validateRelaySecurityOptions(valid)
	if err != nil {
		t.Fatalf("valid relay security options: %v", err)
	}
	if len(material.operatorKey) < minimumOperatorKeyBytes {
		t.Fatalf(
			"operator key length = %d, want at least %d",
			len(material.operatorKey),
			minimumOperatorKeyBytes,
		)
	}
	if len(material.signingKey) < minimumOperatorKeyBytes {
		t.Fatalf(
			"signing key length = %d, want at least %d",
			len(material.signingKey),
			minimumOperatorKeyBytes,
		)
	}

	tests := []struct {
		name   string
		mutate func(*Options)
	}{
		{
			name: "missing signing key",
			mutate: func(options *Options) {
				options.SigningKeyFile = ""
			},
		},
		{
			name: "shared signing and operator key",
			mutate: func(options *Options) {
				options.SigningKeyFile = options.OperatorKeyFile
			},
		},
		{
			name: "shared signing and operator key material",
			mutate: func(options *Options) {
				content, err := os.ReadFile(options.OperatorKeyFile)
				if err != nil {
					t.Fatalf("read operator key: %v", err)
				}
				if err := os.WriteFile(options.SigningKeyFile, content, 0o600); err != nil {
					t.Fatalf("write signing key: %v", err)
				}
			},
		},
		{
			name: "missing operator audience",
			mutate: func(options *Options) {
				options.OperatorAudience = ""
			},
		},
		{
			name: "plaintext public listener",
			mutate: func(options *Options) {
				options.StreamListenAddr = ":4501"
			},
		},
		{
			name: "plaintext public origin",
			mutate: func(options *Options) {
				options.PublicBaseURL = "http://relay.example.test"
			},
		},
		{
			name: "implicit plaintext",
			mutate: func(options *Options) {
				options.AllowInsecureLoopback = false
			},
		},
		{
			name: "missing quota",
			mutate: func(options *Options) {
				options.MaxStations = 0
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			options := *validRelaySecurityOptions(t)
			test.mutate(&options)
			if _, err := validateRelaySecurityOptions(&options); err == nil {
				t.Fatal("validateRelaySecurityOptions succeeded, want failure")
			}
		})
	}
}

func TestOperatorAuthenticationRequiresDedicatedPolicy(t *testing.T) {
	t.Parallel()

	operatorKey := []byte("0123456789abcdef0123456789abcdef")
	policy := operatorClaims{
		Scope: "relay.admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "peers-relay-operator",
			Subject:   "operator:test",
			Audience:  jwt.ClaimStrings{"peers-relay"},
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
		},
	}

	validToken := signedOperatorToken(t, policy, operatorKey)
	subject, err := authenticateOperator(
		"Bearer "+validToken,
		operatorKey,
		"peers-relay-operator",
		"peers-relay",
		"relay.admin",
	)
	if err != nil {
		t.Fatalf("authenticate valid operator: %v", err)
	}
	if subject.ID != "operator:test" ||
		subject.Attributes["audience"] != "peers-relay" ||
		subject.Attributes["scope"] != "relay.admin" {
		t.Fatalf("unexpected operator subject: %+v", subject)
	}

	appToken := signedOperatorToken(
		t,
		policy,
		[]byte("abcdef0123456789abcdef0123456789"),
	)
	if _, err := authenticateOperator(
		"Bearer "+appToken,
		operatorKey,
		"peers-relay-operator",
		"peers-relay",
		"relay.admin",
	); err == nil {
		t.Fatal("ordinary app signing key authenticated as relay operator")
	}

	for name, mutate := range map[string]func(*operatorClaims){
		"audience": func(claims *operatorClaims) {
			claims.Audience = jwt.ClaimStrings{"station"}
		},
		"issuer": func(claims *operatorClaims) {
			claims.Issuer = "station"
		},
		"scope": func(claims *operatorClaims) {
			claims.Scope = "station.admin"
		},
	} {
		name := name
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			claims := policy
			mutate(&claims)
			token := signedOperatorToken(t, claims, operatorKey)
			if _, err := authenticateOperator(
				"Bearer "+token,
				operatorKey,
				"peers-relay-operator",
				"peers-relay",
				"relay.admin",
			); err == nil {
				t.Fatalf("operator credential with wrong %s was accepted", name)
			}
		})
	}
}

func TestRelayTLSConfigRequiresTLS13(t *testing.T) {
	t.Parallel()

	config := relayTLSConfig(tls.Certificate{})
	if config.MinVersion != tls.VersionTLS13 {
		t.Fatalf("minimum TLS version = %x, want TLS 1.3", config.MinVersion)
	}
}

func TestRelayRouteInventoryIsRoleBounded(t *testing.T) {
	t.Parallel()

	subserver := &SubServer{opts: &Options{}}
	handlers := newRelayHandler(subserver).handlers()
	got := make(map[string]server.Method, len(handlers))
	for _, handler := range handlers {
		if _, exists := got[handler.Path()]; exists {
			t.Fatalf("duplicate Relay route: %s", handler.Path())
		}
		got[handler.Path()] = handler.Method()
	}

	want := map[string]server.Method{
		"/.well-known/peers-touch/access":    server.POST,
		"/healthz":                           server.GET,
		"/metrics":                           server.GET,
		"/api/v1/relay/grants":               server.POST,
		"/api/v1/relay/invite":               server.POST,
		"/api/v1/relay/invites":              server.GET,
		"/api/v1/relay/invite/revoke":        server.POST,
		"/api/v1/relay/mounts":               server.GET,
		"/api/v1/relay/mount":                server.DELETE,
		"/api/v1/relay/routes":               server.POST,
		"/api/v1/relay/stats":                server.GET,
		"/api/v1/relay/enrollment/challenge": server.POST,
		"/api/v1/relay/register":             server.POST,
		"/api/v1/relay/heartbeat":            server.POST,
		"/api/v1/relay/rotation/challenge":   server.POST,
		"/api/v1/relay/token/refresh":        server.POST,
		"/.well-known/peers-touch/tunnel":    server.GET,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Relay route inventory = %#v, want %#v", got, want)
	}
}

func validRelaySecurityOptions(t *testing.T) *Options {
	t.Helper()

	signingKeyPath := filepath.Join(t.TempDir(), "relay-signing.key")
	operatorKeyPath := filepath.Join(t.TempDir(), "relay-operator.key")
	if err := os.WriteFile(
		signingKeyPath,
		[]byte("abcdef0123456789abcdef0123456789"),
		0o600,
	); err != nil {
		t.Fatalf("write signing key: %v", err)
	}
	if err := os.WriteFile(
		operatorKeyPath,
		[]byte("0123456789abcdef0123456789abcdef"),
		0o600,
	); err != nil {
		t.Fatalf("write operator key: %v", err)
	}

	return &Options{
		MaxStations:             100,
		HeartbeatTimeout:        60,
		ForwardTimeout:          30,
		MaxBodySize:             10 * 1024 * 1024,
		MaxConcurrentPerStation: 64,
		StreamPingInterval:      30,
		StreamPingTimeout:       5,
		StreamListenAddr:        "127.0.0.1:0",
		PublicBaseURL:           "http://127.0.0.1:18081",
		GracefulDrainTimeout:    10,
		AllowInsecureLoopback:   true,
		SigningKeyFile:          signingKeyPath,
		OperatorKeyFile:         operatorKeyPath,
		OperatorIssuer:          "peers-relay-operator",
		OperatorAudience:        "peers-relay",
		OperatorScope:           "relay.admin",
	}
}

func signedOperatorToken(
	t *testing.T,
	claims operatorClaims,
	key []byte,
) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign operator token: %v", err)
	}
	return signed
}
