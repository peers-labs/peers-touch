package bootstrap

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/application/operatorauth"
)

type Config struct {
	Operator operatorauth.Config

	OAuthRedeemURL    string
	OAuthRedeemSecret string

	SigningKeyID      string
	SigningPrivateKey ed25519.PrivateKey

	CatalogStorageDriver  string
	OperatorStorageDriver string
	OperatorSQLitePath    string
	GitHubAPIBase         string
	GitHubOwner           string
	GitHubRepository      string
	GitHubBranch          string
	GitHubAppID           string
	GitHubInstallationID  int64
	GitHubPrivateKeyPEM   []byte
	RecordKey             []byte
}

func LoadConfig() (Config, error) {
	config := Config{
		Operator: operatorauth.Config{
			SiteID:          envOr("X_CONFIG_OAUTH_SITE_ID", "x-config"),
			Audience:        envOr("X_CONFIG_OAUTH_AUDIENCE", "x-config-admin"),
			BrokerStartURL:  strings.TrimSpace(os.Getenv("X_CONFIG_OAUTH_START_URL")),
			CallbackURL:     strings.TrimSpace(os.Getenv("X_CONFIG_OAUTH_CALLBACK_URL")),
			ConsoleURL:      strings.TrimSpace(os.Getenv("X_CONFIG_CONSOLE_URL")),
			Provider:        envOr("X_CONFIG_OAUTH_PROVIDER", "github"),
			AttemptLifetime: 10 * time.Minute,
			SessionLifetime: time.Hour,
		},
		OAuthRedeemURL:    strings.TrimSpace(os.Getenv("X_CONFIG_OAUTH_REDEEM_URL")),
		OAuthRedeemSecret: strings.TrimSpace(os.Getenv("X_CONFIG_OAUTH_REDEEM_SECRET")),
		CatalogStorageDriver: strings.ToLower(
			strings.TrimSpace(
				os.Getenv("X_CONFIG_CATALOG_STORAGE_DRIVER"),
			),
		),
		OperatorStorageDriver: strings.ToLower(
			strings.TrimSpace(
				os.Getenv("X_CONFIG_OPERATOR_STORAGE_DRIVER"),
			),
		),
		OperatorSQLitePath: strings.TrimSpace(
			os.Getenv("X_CONFIG_OPERATOR_SQLITE_PATH"),
		),
	}
	if config.CatalogStorageDriver != "github" {
		return Config{}, errors.New(
			"unsupported_x_config_catalog_storage_driver",
		)
	}
	if config.OperatorStorageDriver != "sqlite" {
		return Config{}, errors.New(
			"unsupported_x_config_operator_storage_driver",
		)
	}
	if config.OperatorSQLitePath == "" {
		return Config{}, errors.New("x_config_operator_sqlite_path_required")
	}
	if err := loadSigningKeysAndAllowlist(&config); err != nil {
		return Config{}, err
	}
	// Private corp deployments (e.g. fiveArm) serve plain HTTP on RFC1918
	// addresses; the ed25519 snapshot signature remains the integrity
	// boundary. Public origins still require HTTPS.
	originAllowed := validHTTPSURL
	if os.Getenv("X_CONFIG_ALLOW_PRIVATE_HTTP") == "1" {
		originAllowed = func(raw string) bool {
			return validHTTPSURL(raw) || validPrivateHTTPURL(raw)
		}
	}
	for _, raw := range []string{
		config.Operator.BrokerStartURL,
		config.Operator.CallbackURL,
		config.Operator.ConsoleURL,
		config.OAuthRedeemURL,
	} {
		if !originAllowed(raw) {
			return Config{}, errors.New("invalid_x_config_oauth_url")
		}
	}
	if config.OAuthRedeemSecret == "" {
		return Config{}, errors.New("x_config_oauth_redeem_secret_required")
	}
	if err := loadPublicationSigner(&config); err != nil {
		return Config{}, err
	}
	config.GitHubAPIBase = envOr(
		"X_CONFIG_GITHUB_API_BASE_URL",
		"https://api.github.com",
	)
	if !validHTTPSURL(config.GitHubAPIBase) {
		return Config{}, errors.New("invalid_x_config_github_api")
	}
	config.GitHubOwner = strings.TrimSpace(os.Getenv("X_CONFIG_GITHUB_OWNER"))
	config.GitHubRepository = strings.TrimSpace(os.Getenv("X_CONFIG_GITHUB_REPO"))
	config.GitHubBranch = envOr("X_CONFIG_GITHUB_BRANCH", "main")
	config.GitHubAppID = strings.TrimSpace(os.Getenv("X_CONFIG_GITHUB_APP_ID"))
	installationID, err := strconv.ParseInt(
		strings.TrimSpace(os.Getenv("X_CONFIG_GITHUB_INSTALLATION_ID")),
		10,
		64,
	)
	if err != nil || installationID <= 0 {
		return Config{}, errors.New("invalid_x_config_github_installation")
	}
	config.GitHubInstallationID = installationID
	config.GitHubPrivateKeyPEM, err = decodeBase64(
		os.Getenv("X_CONFIG_GITHUB_PRIVATE_KEY_B64"),
		1,
	)
	if err != nil {
		return Config{}, errors.New("invalid_x_config_github_private_key")
	}
	config.RecordKey, err = decodeBase64(
		os.Getenv("X_CONFIG_SESSION_RECORD_KEY_B64"),
		32,
	)
	if err != nil || len(config.RecordKey) != 32 {
		return Config{}, errors.New("invalid_x_config_record_key")
	}
	if config.GitHubOwner == "" ||
		config.GitHubRepository == "" ||
		config.GitHubAppID == "" ||
		config.GitHubBranch == "" {
		return Config{}, errors.New("x_config_github_configuration_required")
	}
	return config, nil
}

func loadPublicationSigner(config *Config) error {
	config.SigningKeyID = strings.TrimSpace(
		os.Getenv("X_CONFIG_SIGNING_KEY_ID"),
	)
	privateBytes, err := decodeBase64(
		os.Getenv("X_CONFIG_SIGNING_PRIVATE_KEY_B64"),
		ed25519.SeedSize,
	)
	if err != nil {
		return errors.New("invalid_x_config_signing_private_key")
	}
	switch len(privateBytes) {
	case ed25519.SeedSize:
		config.SigningPrivateKey = ed25519.NewKeyFromSeed(privateBytes)
	case ed25519.PrivateKeySize:
		config.SigningPrivateKey = append(ed25519.PrivateKey(nil), privateBytes...)
	default:
		return errors.New("invalid_x_config_signing_private_key")
	}
	publicKey, err := decodeBase64(
		os.Getenv("X_CONFIG_SIGNING_PUBLIC_KEY_B64"),
		ed25519.PublicKeySize,
	)
	if err != nil ||
		len(publicKey) != ed25519.PublicKeySize ||
		config.SigningKeyID == "" ||
		!bytes.Equal(config.SigningPrivateKey.Public().(ed25519.PublicKey), publicKey) {
		return errors.New("invalid_x_config_signing_identity")
	}
	return nil
}

func loadSigningKeysAndAllowlist(config *Config) error {
	var rawKeys map[string]string
	if err := json.Unmarshal(
		[]byte(strings.TrimSpace(os.Getenv("X_CONFIG_OAUTH_SIGNING_KEYS_JSON"))),
		&rawKeys,
	); err != nil || len(rawKeys) == 0 {
		return errors.New("x_config_oauth_signing_keys_required")
	}
	config.Operator.SigningKeys = make(map[string]ed25519.PublicKey, len(rawKeys))
	for keyID, encoded := range rawKeys {
		publicKey, err := decodeBase64(encoded, ed25519.PublicKeySize)
		if err != nil ||
			len(publicKey) != ed25519.PublicKeySize ||
			strings.TrimSpace(keyID) == "" {
			return errors.New("invalid_x_config_oauth_signing_key")
		}
		config.Operator.SigningKeys[strings.TrimSpace(keyID)] =
			append(ed25519.PublicKey(nil), publicKey...)
	}
	config.Operator.AllowedSubjects = make(map[string]struct{})
	for _, entry := range strings.Split(
		os.Getenv("X_CONFIG_OPERATOR_SUBJECTS"),
		",",
	) {
		provider, subject, ok := strings.Cut(strings.TrimSpace(entry), ":")
		if !ok ||
			strings.TrimSpace(provider) == "" ||
			strings.TrimSpace(subject) == "" {
			continue
		}
		config.Operator.AllowedSubjects[strings.TrimSpace(provider)+"\x00"+strings.TrimSpace(subject)] = struct{}{}
	}
	if len(config.Operator.AllowedSubjects) == 0 {
		return errors.New("x_config_operator_allowlist_required")
	}
	return nil
}

func decodeBase64(value string, minimum int) ([]byte, error) {
	value = strings.TrimSpace(value)
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil || len(decoded) < minimum {
		return nil, errors.New("invalid_base64_secret")
	}
	return decoded, nil
}

func validHTTPSURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil &&
		parsed.Scheme == "https" &&
		parsed.Host != "" &&
		parsed.User == nil &&
		parsed.Fragment == ""
}

// validPrivateHTTPURL permits plain HTTP only on loopback or private
// (RFC1918 / link-local / unique-local) hosts. Hostnames must be IP literals
// so a public DNS name can never downgrade transport.
func validPrivateHTTPURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" ||
		parsed.User != nil || parsed.Fragment != "" {
		return false
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func envOr(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}
