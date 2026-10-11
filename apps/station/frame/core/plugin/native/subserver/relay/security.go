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
	operatorKey []byte
}

type operatorClaims struct {
	Scope string `json:"scope"`
	jwt.RegisteredClaims
}

func validateRelaySecurityOptions(options *Options) (*relaySecurityMaterial, error) {
	publicBaseURL, err := url.Parse(strings.TrimSpace(options.PublicBaseURL))
	if err != nil || publicBaseURL.Host == "" {
		return nil, fmt.Errorf("relay security: valid public base URL is required")
	}
	if !strings.EqualFold(publicBaseURL.Scheme, "https") &&
		(!strings.EqualFold(publicBaseURL.Scheme, "http") ||
			!isLoopbackHost(publicBaseURL.Hostname())) {
		return nil, fmt.Errorf(
			"relay security: public base URL must use HTTPS or loopback HTTP",
		)
	}
	if options.MaxStations <= 0 {
		return nil, fmt.Errorf("relay security: max-stations must be positive")
	}
	if options.Host == nil ||
		options.Host.Peerstore().PrivKey(options.Host.ID()) == nil {
		return nil, fmt.Errorf(
			"relay security: persistent Relay Host identity is required",
		)
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
	relayIdentity, err := options.Host.Peerstore().
		PrivKey(options.Host.ID()).Raw()
	if err != nil {
		return nil, fmt.Errorf("relay security: read Relay Host identity: %w", err)
	}
	if bytes.Equal(relayIdentity, operatorKey) {
		return nil, fmt.Errorf(
			"relay security: Relay Host and operator key material must be distinct",
		)
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

	return &relaySecurityMaterial{
		operatorKey: operatorKey,
	}, nil
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

func nodeAuthenticationWrapper(
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
						errorBody("valid Relay enrollment credential required"),
					)
					return
				}
				identity, err := service.AuthenticateNodeCredential(
					request.Context(),
					token,
					requiredScope,
				)
				if err != nil {
					writeJSON(
						w,
						http.StatusUnauthorized,
						errorBody("valid Relay enrollment credential required"),
					)
					return
				}
				subject := &coreauth.Subject{
					ID: domain.SubjectRelayAccess + identity.StationPeerID,
					Attributes: map[string]string{
						"audience":        domain.NodeCredentialAudience,
						"scope":           requiredScope,
						"relay_peer_id":   identity.RelayPeerID,
						"station_peer_id": identity.StationPeerID,
						"enrollment_id":   strconv.FormatUint(identity.EnrollmentID, 10),
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
