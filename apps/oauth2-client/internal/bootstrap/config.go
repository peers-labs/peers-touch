package bootstrap

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type siteRegistry struct {
	sites map[string]usecase.SiteConfig
}

func (r siteRegistry) Get(siteID string) (usecase.SiteConfig, bool) {
	v, ok := r.sites[siteID]
	return v, ok
}

type rawSite struct {
	SiteID     string                         `json:"site_id"`
	SuccessURL string                         `json:"success_url"`
	ErrorURL   string                         `json:"error_url"`
	Providers  map[string]port.ProviderConfig `json:"providers"`
}

type rawProviderLite struct {
	Enabled      *bool  `json:"enabled"`
	Scope        string `json:"scope"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RedirectURI  string `json:"redirect_uri"`
}

type rawSiteLite struct {
	SiteID     string                     `json:"site_id"`
	SuccessURL string                     `json:"success_url"`
	ErrorURL   string                     `json:"error_url"`
	Providers  map[string]rawProviderLite `json:"providers"`
}

type rawFileConfig struct {
	Sites []rawSiteLite `json:"sites"`
}

func LoadSiteRegistry() (usecase.SiteRegistry, error) {
	payload := strings.TrimSpace(os.Getenv("OAUTH_SITES_JSON"))
	if payload == "" {
		if fromFile, ok, err := loadFromConfigFile(); err != nil {
			return nil, err
		} else if ok {
			return fromFile, nil
		}
		return loadFromSingleSiteEnv()
	}
	var raw []rawSite
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, errors.New("empty_oauth_sites")
	}
	sites := make(map[string]usecase.SiteConfig, len(raw))
	for _, item := range raw {
		providers := make(map[valueobject.Provider]port.ProviderConfig)
		for k, cfg := range item.Providers {
			provider, ok := valueobject.ParseProvider(k)
			if !ok {
				continue
			}
			if cfg.ClientID == "" || cfg.ClientSecret == "" || cfg.RedirectURI == "" {
				continue
			}
			providers[provider] = cfg
		}
		if item.SiteID == "" || item.SuccessURL == "" || item.ErrorURL == "" || len(providers) == 0 {
			continue
		}
		sites[item.SiteID] = usecase.SiteConfig{
			SiteID:     item.SiteID,
			SuccessURL: item.SuccessURL,
			ErrorURL:   item.ErrorURL,
			Providers:  providers,
		}
	}
	if len(sites) == 0 {
		return nil, errors.New("invalid_oauth_sites")
	}
	return siteRegistry{sites: sites}, nil
}

func loadFromConfigFile() (usecase.SiteRegistry, bool, error) {
	path := strings.TrimSpace(os.Getenv("OAUTH_CONFIG_FILE"))
	if path == "" {
		path = "config/sites.json"
	}
	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, false, nil
		}
		return nil, false, err
	}
	var rawCfg rawFileConfig
	if err := json.Unmarshal(content, &rawCfg); err == nil && len(rawCfg.Sites) > 0 {
		registry, err := buildFromLite(rawCfg.Sites)
		if err != nil {
			return nil, false, err
		}
		return registry, true, nil
	}
	var rawSites []rawSiteLite
	if err := json.Unmarshal(content, &rawSites); err != nil {
		return nil, false, err
	}
	registry, err := buildFromLite(rawSites)
	if err != nil {
		return nil, false, err
	}
	return registry, true, nil
}

func buildFromLite(rawSites []rawSiteLite) (usecase.SiteRegistry, error) {
	baseURL := normalizeBaseURL(strings.TrimSpace(os.Getenv("OAUTH_BASE_URL")))
	sites := make(map[string]usecase.SiteConfig, len(rawSites))
	for _, s := range rawSites {
		siteID := strings.TrimSpace(s.SiteID)
		if siteID == "" {
			continue
		}
		successURL := strings.TrimSpace(s.SuccessURL)
		errorURL := strings.TrimSpace(s.ErrorURL)
		if successURL == "" && baseURL != "" {
			successURL = baseURL
		}
		if errorURL == "" && baseURL != "" {
			errorURL = baseURL
		}
		providers := map[valueobject.Provider]port.ProviderConfig{}
		for key, providerLite := range s.Providers {
			p, ok := valueobject.ParseProvider(key)
			if !ok {
				continue
			}
			if providerLite.Enabled != nil && !*providerLite.Enabled {
				continue
			}
			clientID := firstNonEmpty(strings.TrimSpace(providerLite.ClientID), strings.TrimSpace(os.Getenv(providerEnvPrefix(p)+"_CLIENT_ID")))
			clientSecret := firstNonEmpty(strings.TrimSpace(providerLite.ClientSecret), strings.TrimSpace(os.Getenv(providerEnvPrefix(p)+"_CLIENT_SECRET")))
			if clientID == "" || clientSecret == "" {
				continue
			}
			redirectURI := strings.TrimSpace(providerLite.RedirectURI)
			if redirectURI == "" {
				redirectURI = strings.TrimSpace(os.Getenv(providerEnvPrefix(p) + "_REDIRECT_URI"))
			}
			if redirectURI == "" && baseURL != "" {
				redirectURI = defaultRedirectURI(baseURL, p)
			}
			if redirectURI == "" {
				continue
			}
			scope := strings.TrimSpace(providerLite.Scope)
			if scope == "" {
				scope = strings.TrimSpace(os.Getenv(providerEnvPrefix(p) + "_SCOPE"))
			}
			if scope == "" {
				scope = defaultScope(p)
			}
			providers[p] = port.ProviderConfig{
				ClientID:     clientID,
				ClientSecret: clientSecret,
				RedirectURI:  redirectURI,
				Scope:        scope,
			}
		}
		if successURL == "" || errorURL == "" || len(providers) == 0 {
			continue
		}
		sites[siteID] = usecase.SiteConfig{
			SiteID:     siteID,
			SuccessURL: successURL,
			ErrorURL:   errorURL,
			Providers:  providers,
		}
	}
	if len(sites) == 0 {
		return nil, errors.New("invalid_oauth_config_file")
	}
	return siteRegistry{sites: sites}, nil
}

func loadFromSingleSiteEnv() (usecase.SiteRegistry, error) {
	siteID := envOrDefault("OAUTH_SITE_ID", "default")
	successURL := strings.TrimSpace(os.Getenv("OAUTH_SUCCESS_URL"))
	errorURL := strings.TrimSpace(os.Getenv("OAUTH_ERROR_URL"))
	baseURL := normalizeBaseURL(strings.TrimSpace(os.Getenv("OAUTH_BASE_URL")))
	if successURL == "" && baseURL != "" {
		successURL = baseURL
	}
	if errorURL == "" && baseURL != "" {
		errorURL = baseURL
	}
	if successURL == "" || errorURL == "" {
		return nil, errors.New("missing_success_or_error_url")
	}
	providers := map[valueobject.Provider]port.ProviderConfig{}
	loadProviderFromEnv := func(provider valueobject.Provider, prefix string) {
		clientID := strings.TrimSpace(os.Getenv(prefix + "_CLIENT_ID"))
		clientSecret := strings.TrimSpace(os.Getenv(prefix + "_CLIENT_SECRET"))
		redirectURI := strings.TrimSpace(os.Getenv(prefix + "_REDIRECT_URI"))
		scope := strings.TrimSpace(os.Getenv(prefix + "_SCOPE"))
		if clientID == "" || clientSecret == "" || redirectURI == "" {
			if clientID == "" || clientSecret == "" {
				return
			}
			if baseURL == "" {
				return
			}
			redirectURI = defaultRedirectURI(baseURL, provider)
		}
		if scope == "" {
			scope = defaultScope(provider)
		}
		providers[provider] = port.ProviderConfig{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURI:  redirectURI,
			Scope:        scope,
		}
	}
	loadProviderFromEnv(valueobject.ProviderGitHub, "OAUTH_GITHUB")
	loadProviderFromEnv(valueobject.ProviderGoogle, "OAUTH_GOOGLE")
	loadProviderFromEnv(valueobject.ProviderWeixin, "OAUTH_WEIXIN")
	if len(providers) == 0 {
		return nil, errors.New("no_provider_enabled")
	}
	return siteRegistry{sites: map[string]usecase.SiteConfig{
		siteID: {
			SiteID:     siteID,
			SuccessURL: successURL,
			ErrorURL:   errorURL,
			Providers:  providers,
		},
	}}, nil
}

func envOrDefault(key, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func providerEnvPrefix(provider valueobject.Provider) string {
	switch provider {
	case valueobject.ProviderGitHub:
		return "OAUTH_GITHUB"
	case valueobject.ProviderGoogle:
		return "OAUTH_GOOGLE"
	case valueobject.ProviderWeixin:
		return "OAUTH_WEIXIN"
	default:
		return "OAUTH"
	}
}

func defaultScope(provider valueobject.Provider) string {
	switch provider {
	case valueobject.ProviderGitHub:
		return "read:user user:email"
	case valueobject.ProviderGoogle:
		return "openid profile email"
	case valueobject.ProviderWeixin:
		return "snsapi_login"
	default:
		return ""
	}
}

func defaultRedirectURI(baseURL string, provider valueobject.Provider) string {
	baseURL = normalizeBaseURL(baseURL)
	if baseURL == "" {
		return ""
	}
	return baseURL + "/api/oauth/" + string(provider) + "/callback"
}

func normalizeBaseURL(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return ""
	}
	return strings.TrimRight(v, "/")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
