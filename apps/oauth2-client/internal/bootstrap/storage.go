package bootstrap

import (
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
	githubstore "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/github"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
)

const defaultGitHubAPIBase = "https://api.github.com"

type StorageConfig struct {
	Driver               string
	GitHubAPIBase        string
	GitHubOwner          string
	GitHubRepository     string
	GitHubBranch         string
	GitHubAppID          string
	GitHubInstallationID int64
	GitHubPrivateKeyPEM  []byte
	ActiveKeyID          string
	EncryptionKeys       map[string][]byte
	IndexHMACKey         []byte
	AuditHMACKey         []byte
}

func LoadStorageConfig() (StorageConfig, error) {
	driver := strings.ToLower(strings.TrimSpace(os.Getenv("OAUTH_STORAGE_DRIVER")))
	if driver == "" {
		if strings.TrimSpace(os.Getenv("VERCEL")) != "" {
			return StorageConfig{}, errors.New("oauth_storage_driver_required")
		}
		driver = "memory"
	}
	config := StorageConfig{Driver: driver}
	if driver == "memory" {
		if strings.TrimSpace(os.Getenv("VERCEL")) != "" {
			return StorageConfig{}, errors.New("memory_storage_forbidden_on_vercel")
		}
		return config, nil
	}
	if driver != "github" {
		return StorageConfig{}, errors.New("unsupported_oauth_storage_driver")
	}

	config.GitHubAPIBase = envOrDefault("OAUTH_GITHUB_API_BASE_URL", defaultGitHubAPIBase)
	config.GitHubOwner = strings.TrimSpace(os.Getenv("OAUTH_GITHUB_STORAGE_OWNER"))
	config.GitHubRepository = strings.TrimSpace(os.Getenv("OAUTH_GITHUB_STORAGE_REPO"))
	config.GitHubBranch = envOrDefault("OAUTH_GITHUB_STORAGE_BRANCH", "main")
	config.GitHubAppID = strings.TrimSpace(os.Getenv("OAUTH_GITHUB_APP_ID"))
	installationID, err := strconv.ParseInt(strings.TrimSpace(os.Getenv("OAUTH_GITHUB_APP_INSTALLATION_ID")), 10, 64)
	if err != nil || installationID <= 0 {
		return StorageConfig{}, errors.New("invalid_github_app_installation_id")
	}
	config.GitHubInstallationID = installationID
	privateKey, err := decodeBase64Secret("OAUTH_GITHUB_APP_PRIVATE_KEY_B64", 1)
	if err != nil {
		return StorageConfig{}, err
	}
	config.GitHubPrivateKeyPEM = privateKey
	config.ActiveKeyID = normalizeKeyID(os.Getenv("OAUTH_CREDENTIAL_ACTIVE_KEY_ID"))
	if config.ActiveKeyID == "" {
		return StorageConfig{}, errors.New("oauth_active_encryption_key_required")
	}
	config.EncryptionKeys = make(map[string][]byte)
	for _, item := range os.Environ() {
		key, value, found := strings.Cut(item, "=")
		if !found || !strings.HasPrefix(key, "OAUTH_CREDENTIAL_KEY_") {
			continue
		}
		keyID := normalizeKeyID(strings.TrimPrefix(key, "OAUTH_CREDENTIAL_KEY_"))
		decoded, err := decodeBase64Value(value, 32)
		if err != nil || keyID == "" {
			return StorageConfig{}, errors.New("invalid_oauth_encryption_key")
		}
		config.EncryptionKeys[keyID] = decoded
	}
	if _, ok := config.EncryptionKeys[config.ActiveKeyID]; !ok {
		return StorageConfig{}, errors.New("oauth_active_encryption_key_required")
	}
	config.IndexHMACKey, err = decodeBase64Secret("OAUTH_STORAGE_INDEX_HMAC_KEY", 32)
	if err != nil {
		return StorageConfig{}, err
	}
	config.AuditHMACKey, err = decodeBase64Secret("OAUTH_AUDIT_HMAC_KEY", 32)
	if err != nil {
		return StorageConfig{}, err
	}
	if config.GitHubOwner == "" || config.GitHubRepository == "" || config.GitHubAppID == "" {
		return StorageConfig{}, errors.New("github_storage_configuration_required")
	}
	return config, nil
}

func BuildOAuthStore(config StorageConfig, client *http.Client) (repository.OAuthStore, repository.OAuthMaintenanceStore, error) {
	if config.Driver == "memory" {
		return memory.NewStore(), nil, nil
	}
	codec, err := recordcrypto.NewCodec(config.ActiveKeyID, config.EncryptionKeys)
	if err != nil {
		return nil, nil, err
	}
	auth, err := githubstore.NewAppAuthenticator(
		config.GitHubAPIBase,
		config.GitHubAppID,
		config.GitHubInstallationID,
		config.GitHubPrivateKeyPEM,
		client,
	)
	if err != nil {
		return nil, nil, err
	}
	gitClient, err := githubstore.NewClient(
		config.GitHubAPIBase,
		config.GitHubOwner,
		config.GitHubRepository,
		config.GitHubBranch,
		auth,
		client,
	)
	if err != nil {
		return nil, nil, err
	}
	store, err := githubstore.NewStore(
		gitClient,
		codec,
		recordcrypto.NewFingerprinter(config.IndexHMACKey),
		recordcrypto.NewFingerprinter(config.AuditHMACKey),
	)
	if err != nil {
		return nil, nil, err
	}
	return store, store, nil
}

func decodeBase64Secret(name string, minimumBytes int) ([]byte, error) {
	value := strings.TrimSpace(os.Getenv(name))
	decoded, err := decodeBase64Value(value, minimumBytes)
	if err != nil {
		return nil, errors.New("invalid_" + strings.ToLower(name))
	}
	return decoded, nil
}

func decodeBase64Value(value string, minimumBytes int) ([]byte, error) {
	if value == "" {
		return nil, errors.New("empty_secret")
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil || len(decoded) < minimumBytes {
		return nil, errors.New("invalid_secret")
	}
	return decoded, nil
}

func normalizeKeyID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
