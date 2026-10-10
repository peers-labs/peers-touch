package relay

import (
	"bytes"
	"context"
	"crypto/subtle"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/golang-jwt/jwt/v5"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const minimumOperatorKeyBytes = 32

type relaySecurityMaterial struct {
	signingKey  []byte
	operatorKey []byte
}

type operatorClaims struct {
	Scope string `json:"scope"`
	jwt.RegisteredClaims
}

func validateRelaySecurityOptions(options *Options) (*relaySecurityMaterial, error) {
	if strings.TrimSpace(options.StreamListenAddr) == "" {
		return nil, fmt.Errorf("relay security: stream listen address is required")
	}
	publicBaseURL, err := url.Parse(strings.TrimSpace(options.PublicBaseURL))
	if err != nil || publicBaseURL.Host == "" {
		return nil, fmt.Errorf("relay security: valid public base URL is required")
	}

	if err := validateRelayQuotas(options); err != nil {
		return nil, err
	}

	signingKeyPath := strings.TrimSpace(options.SigningKeyFile)
	if signingKeyPath == "" {
		return nil, fmt.Errorf("relay security: signing key file is required")
	}
	signingKey, err := readCredentialFile(
		"signing key",
		signingKeyPath,
		minimumOperatorKeyBytes,
	)
	if err != nil {
		return nil, err
	}

	operatorKeyPath := strings.TrimSpace(options.OperatorKeyFile)
	if operatorKeyPath == "" {
		return nil, fmt.Errorf("relay security: operator key file is required")
	}
	operatorKey, err := readCredentialFile(
		"operator key",
		operatorKeyPath,
		minimumOperatorKeyBytes,
	)
	if err != nil {
		return nil, err
	}
	if sameFilePath(signingKeyPath, operatorKeyPath) {
		return nil, fmt.Errorf("relay security: signing and operator keys must be distinct")
	}
	if bytes.Equal(signingKey, operatorKey) {
		return nil, fmt.Errorf("relay security: signing and operator key material must be distinct")
	}

	if strings.TrimSpace(options.OperatorIssuer) == "" {
		return nil, fmt.Errorf("relay security: operator issuer is required")
	}
	if strings.TrimSpace(options.OperatorAudience) == "" {
		return nil, fmt.Errorf("relay security: operator audience is required")
	}
	if strings.TrimSpace(options.OperatorScope) == "" {
		return nil, fmt.Errorf("relay security: operator scope is required")
	}

	hasCert := strings.TrimSpace(options.TLSCertFile) != ""
	hasKey := strings.TrimSpace(options.TLSKeyFile) != ""
	if hasCert != hasKey {
		return nil, fmt.Errorf("relay security: TLS certificate and key must be configured together")
	}
	if hasCert {
		if !strings.EqualFold(publicBaseURL.Scheme, "https") {
			return nil, fmt.Errorf("relay security: public base URL must use HTTPS")
		}
		if _, err := readCredentialFile("TLS certificate", options.TLSCertFile, 1); err != nil {
			return nil, err
		}
		tlsKey, err := readCredentialFile("TLS key", options.TLSKeyFile, 1)
		if err != nil {
			return nil, err
		}
		if sameFilePath(operatorKeyPath, options.TLSKeyFile) ||
			sameFilePath(signingKeyPath, options.TLSKeyFile) {
			return nil, fmt.Errorf("relay security: TLS, signing, and operator keys must be distinct")
		}
		if bytes.Equal(tlsKey, operatorKey) || bytes.Equal(tlsKey, signingKey) {
			return nil, fmt.Errorf("relay security: TLS, signing, and operator key material must be distinct")
		}
		return &relaySecurityMaterial{
			signingKey:  signingKey,
			operatorKey: operatorKey,
		}, nil
	}

	if !options.AllowInsecureLoopback {
		return nil, fmt.Errorf("relay security: TLS certificate and key are required")
	}
	if !isLoopbackAddress(options.StreamListenAddr) {
		return nil, fmt.Errorf(
			"relay security: insecure listener %q is not loopback",
			options.StreamListenAddr,
		)
	}
	if !strings.EqualFold(publicBaseURL.Scheme, "http") ||
		!isLoopbackHost(publicBaseURL.Hostname()) {
		return nil, fmt.Errorf(
			"relay security: insecure public base URL %q is not loopback HTTP",
			options.PublicBaseURL,
		)
	}
	return &relaySecurityMaterial{
		signingKey:  signingKey,
		operatorKey: operatorKey,
	}, nil
}

func validateRelayQuotas(options *Options) error {
	quotas := []struct {
		name  string
		value int
	}{
		{name: "forward-timeout", value: options.ForwardTimeout},
		{name: "graceful-drain-timeout", value: options.GracefulDrainTimeout},
		{name: "heartbeat-timeout", value: options.HeartbeatTimeout},
		{name: "max-body-size", value: options.MaxBodySize},
		{name: "max-concurrent-per-station", value: options.MaxConcurrentPerStation},
		{name: "max-stations", value: options.MaxStations},
		{name: "stream-ping-interval", value: options.StreamPingInterval},
		{name: "stream-ping-timeout", value: options.StreamPingTimeout},
	}
	for _, quota := range quotas {
		if quota.value <= 0 {
			return fmt.Errorf("relay security: quota %s must be positive", quota.name)
		}
	}
	return nil
}

func readCredentialFile(label, path string, minimumBytes int) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("relay security: inspect %s file: %w", label, err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("relay security: %s path is not a regular file", label)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("relay security: read %s file: %w", label, err)
	}
	content = bytes.TrimSpace(content)
	if len(content) < minimumBytes {
		return nil, fmt.Errorf(
			"relay security: %s must contain at least %d bytes",
			label,
			minimumBytes,
		)
	}
	return content, nil
}

func sameFilePath(left, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	return left != "." && right != "." && left == right
}

func isLoopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(address))
	if err != nil {
		return false
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	return isLoopbackHost(host)
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(strings.TrimSpace(host), "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func operatorAuthenticationWrapper(
	key []byte,
	issuer string,
	audience string,
	scope string,
) server.Wrapper {
	return server.HTTPWrapperAdapter(
		func(ctx context.Context, next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				subject, err := authenticateOperator(
					request.Header.Get("Authorization"),
					key,
					issuer,
					audience,
					scope,
				)
				if err != nil {
					writeJSON(
						w,
						http.StatusUnauthorized,
						errorBody("valid relay operator credential required"),
					)
					return
				}
				next.ServeHTTP(
					w,
					request.WithContext(coreauth.WithSubject(request.Context(), subject)),
				)
			})
		},
	)
}

func mountAuthenticationWrapper(
	service *application.Service,
	requiredScope string,
) server.Wrapper {
	return server.HTTPWrapperAdapter(
		func(ctx context.Context, next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				token, ok := bearerToken(request.Header.Get("Authorization"))
				if !ok {
					writeJSON(
						w,
						http.StatusUnauthorized,
						errorBody("valid Relay mount credential required"),
					)
					return
				}
				identity, err := service.AuthenticateMountCredential(
					request.Context(),
					token,
					requiredScope,
				)
				if err != nil {
					writeJSON(
						w,
						http.StatusUnauthorized,
						errorBody("valid Relay mount credential required"),
					)
					return
				}
				subject := &coreauth.Subject{
					ID: domain.SubjectRelayAccess + identity.StationPeerID,
					Attributes: map[string]string{
						"audience":        domain.MountCredentialAudience,
						"scope":           requiredScope,
						"relay_peer_id":   identity.RelayPeerID,
						"station_peer_id": identity.StationPeerID,
						"mount_id":        strconv.FormatUint(identity.MountID, 10),
						"generation":      strconv.FormatUint(identity.Generation, 10),
						"jti":             identity.JTI,
					},
				}
				next.ServeHTTP(
					w,
					request.WithContext(coreauth.WithSubject(request.Context(), subject)),
				)
			})
		},
	)
}

func bearerToken(authorization string) (string, bool) {
	const prefix = "Bearer "
	if !strings.HasPrefix(authorization, prefix) {
		return "", false
	}
	token := strings.TrimPrefix(authorization, prefix)
	if token == "" || strings.TrimSpace(token) != token ||
		strings.ContainsAny(token, " \t\r\n") {
		return "", false
	}
	return token, true
}

func authenticateOperator(
	authorization string,
	key []byte,
	issuer string,
	audience string,
	requiredScope string,
) (*coreauth.Subject, error) {
	const bearerPrefix = "Bearer "
	if !strings.HasPrefix(authorization, bearerPrefix) {
		return nil, fmt.Errorf("relay operator authentication failed")
	}
	rawToken := strings.TrimSpace(strings.TrimPrefix(authorization, bearerPrefix))
	if rawToken == "" {
		return nil, fmt.Errorf("relay operator authentication failed")
	}

	claims := &operatorClaims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("relay operator authentication failed")
			}
			return key, nil
		},
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithIssuer(issuer),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)
	if err != nil || !token.Valid || strings.TrimSpace(claims.Subject) == "" {
		return nil, fmt.Errorf("relay operator authentication failed")
	}
	if subtle.ConstantTimeCompare(
		[]byte(claims.Scope),
		[]byte(requiredScope),
	) != 1 {
		return nil, fmt.Errorf("relay operator authentication failed")
	}

	return &coreauth.Subject{
		ID: claims.Subject,
		Attributes: map[string]string{
			"audience": audience,
			"issuer":   issuer,
			"scope":    claims.Scope,
		},
	}, nil
}
