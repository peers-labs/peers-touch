package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

const (
	webFetchMaxBodyBytes = 512 * 1024
	webFetchTimeout      = 15 * time.Second
	webFetchMaxURLChars  = 2048
)

// validateOutboundHTTPURL applies the same SSRF boundary as MCP HTTP
// transports: https only (loopback http is reserved for local MCP and
// never allowed for arbitrary fetches), no credentials, and direct or
// DNS-resolved targets must not be loopback, private, link-local,
// multicast, unspecified, or the cloud metadata ranges.
func validateOutboundHTTPURL(raw string, resolved net.IP) error {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > webFetchMaxURLChars {
		return errors.New("web fetch url is empty or too long")
	}
	if strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return errors.New("web fetch url contains control characters")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return errors.New("web fetch url is invalid")
	}
	if parsed.User != nil {
		return errors.New("web fetch url must not contain credentials")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return errors.New("web fetch url must use https")
	}
	host := parsed.Hostname()
	if isMcpLoopbackHost(host) {
		return errors.New("web fetch url must not target loopback addresses")
	}
	if parsed.Scheme == "http" {
		return errors.New("web fetch url must use https for non-loopback hosts")
	}
	if direct := net.ParseIP(host); direct != nil {
		if isBlockedOutboundIP(direct) {
			return errors.New("web fetch url must not target a private or metadata address")
		}
		return nil
	}
	if resolved != nil && isBlockedOutboundIP(resolved) {
		return errors.New("web fetch host resolves to a private or metadata address")
	}
	return nil
}

func isBlockedOutboundIP(address net.IP) bool {
	if address == nil {
		return true
	}
	return address.IsLoopback() ||
		address.IsPrivate() ||
		address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() ||
		address.IsUnspecified() ||
		address.IsMulticast() ||
		address.IsUnspecified()
}

// WebFetchService performs bounded HTTPS GET requests for the
// Station-owned web_fetch tool. Every dial and redirect hop is
// re-validated against the SSRF boundary.
type WebFetchService struct {
	client    *http.Client
	resolver  *net.Resolver
	lookupIPs func(ctx context.Context, host string) ([]net.IP, error)
}

func NewWebFetchService() *WebFetchService {
	service := &WebFetchService{resolver: net.DefaultResolver}
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	service.lookupIPs = func(ctx context.Context, host string) ([]net.IP, error) {
		addresses, err := service.resolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		ips := make([]net.IP, 0, len(addresses))
		for _, address := range addresses {
			ips = append(ips, address.IP)
		}
		return ips, nil
	}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		MaxIdleConns:          1,
	}
	service.client = &http.Client{
		Transport: transport,
		Timeout:   webFetchTimeout,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("web fetch stopped after 5 redirects")
			}
			host := request.URL.Hostname()
			if isMcpLoopbackHost(host) {
				return errors.New("web fetch redirect targets a loopback address")
			}
			if direct := net.ParseIP(host); direct != nil &&
				isBlockedOutboundIP(direct) {
				return errors.New("web fetch redirect targets a private or metadata address")
			}
			return nil
		},
	}
	return service
}

type webFetchResult struct {
	URL         string `json:"url"`
	Status      int    `json:"status"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
	Truncated   bool   `json:"truncated"`
}

// Fetch validates the URL and DNS resolution, performs the request,
// and returns a bounded text/plain or HTML/JSON body.
func (s *WebFetchService) Fetch(ctx context.Context, rawURL string) (*webFetchResult, error) {
	if err := validateOutboundHTTPURL(rawURL, nil); err != nil {
		return nil, err
	}
	parsed, _ := url.Parse(strings.TrimSpace(rawURL))
	if direct := net.ParseIP(parsed.Hostname()); direct == nil {
		addresses, err := s.lookupIPs(ctx, parsed.Hostname())
		if err != nil {
			return nil, fmt.Errorf("resolve web fetch host: %w", err)
		}
		if len(addresses) == 0 {
			return nil, errors.New("web fetch host has no DNS records")
		}
		blocked := true
		for _, address := range addresses {
			if !isBlockedOutboundIP(address) {
				blocked = false
				break
			}
		}
		if blocked {
			return nil, errors.New("web fetch host only resolves to blocked addresses")
		}
	}
	requestCtx, cancel := context.WithTimeout(ctx, webFetchTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build web fetch request: %w", err)
	}
	request.Header.Set("Accept", "text/plain,text/html,application/json;q=0.9")
	request.Header.Set("User-Agent", "PeersTouch-Agent-WebFetch/1.0")
	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("web fetch request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("web fetch returned HTTP %d", response.StatusCode)
	}
	reader := io.LimitReader(response.Body, webFetchMaxBodyBytes+1)
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read web fetch body: %w", err)
	}
	truncated := len(body) > webFetchMaxBodyBytes
	if truncated {
		body = body[:webFetchMaxBodyBytes]
	}
	contentType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	return &webFetchResult{
		URL:         response.Request.URL.String(),
		Status:      response.StatusCode,
		ContentType: contentType,
		Content:     string(body),
		Truncated:   truncated,
	}, nil
}

// RegisterWebFetchTool registers the Station-owned web_fetch builtin
// tool on the tool registry.
func RegisterWebFetchTool(registry *ToolRegistryService, svc *WebFetchService) {
	schema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "Public HTTPS URL to retrieve"
    }
  },
  "required": ["url"]
}`)
	registry.Register(&domain.ToolDefinition{
		Name: "web_fetch",
		Description: "Fetch a public HTTPS web page or JSON endpoint for evidence. " +
			"Loopback, private-network and metadata addresses are rejected; no credentials are sent.",
		JSONSchema: schema,
		Handler: func(ctx context.Context, _ *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
			var args struct {
				URL string `json:"url"`
			}
			if err := json.Unmarshal(raw, &args); err != nil {
				return &domain.ToolResult{Content: "invalid web_fetch arguments: " + err.Error(), IsError: true}, nil
			}
			result, err := svc.Fetch(ctx, args.URL)
			if err != nil {
				return &domain.ToolResult{Content: "web_fetch failed: " + err.Error(), IsError: true}, nil
			}
			payload, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return &domain.ToolResult{Content: "web_fetch encode failed: " + marshalErr.Error(), IsError: true}, nil
			}
			return &domain.ToolResult{Content: string(payload)}, nil
		},
	})
}
