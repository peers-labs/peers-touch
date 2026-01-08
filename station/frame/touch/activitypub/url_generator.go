package activitypub

import (
	"fmt"
	"net/url"
	"path"
	"strconv"
	"strings"
)

type URLGenerator struct {
	baseURL string
}

func NewURLGenerator(baseURL string) *URLGenerator {
	return &URLGenerator{baseURL: strings.TrimSuffix(baseURL, "/")}
}

func (g *URLGenerator) ActorURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/actor", g.baseURL, username)
}

func (g *URLGenerator) InboxURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/inbox", g.baseURL, username)
}

func (g *URLGenerator) OutboxURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/outbox", g.baseURL, username)
}

func (g *URLGenerator) FollowersURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/followers", g.baseURL, username)
}

func (g *URLGenerator) FollowingURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/following", g.baseURL, username)
}

func (g *URLGenerator) LikedURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/liked", g.baseURL, username)
}

func (g *URLGenerator) ActivityURL(username string, id uint64) string {
	return fmt.Sprintf("%s/activitypub/%s/activities/%d", g.baseURL, username, id)
}

func (g *URLGenerator) ObjectURL(username string, id uint64) string {
	return fmt.Sprintf("%s/activitypub/%s/objects/%d", g.baseURL, username, id)
}

func (g *URLGenerator) SharedInboxURL() string {
	return fmt.Sprintf("%s/activitypub/inbox", g.baseURL)
}

func ParseActivityID(activityURL string) (uint64, error) {
	u, err := url.Parse(activityURL)
	if err != nil {
		return 0, fmt.Errorf("invalid URL: %w", err)
	}

	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 3 || parts[len(parts)-2] != "activities" {
		return 0, fmt.Errorf("invalid activity URL format: %s", activityURL)
	}

	idStr := parts[len(parts)-1]
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid activity ID: %w", err)
	}

	return id, nil
}

func ParseObjectID(objectURL string) (uint64, error) {
	u, err := url.Parse(objectURL)
	if err != nil {
		return 0, fmt.Errorf("invalid URL: %w", err)
	}

	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 3 || parts[len(parts)-2] != "objects" {
		return 0, fmt.Errorf("invalid object URL format: %s", objectURL)
	}

	idStr := parts[len(parts)-1]
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid object ID: %w", err)
	}

	return id, nil
}

func ParseUsername(actorURL string) (string, error) {
	u, err := url.Parse(actorURL)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}

	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "activitypub" {
		return "", fmt.Errorf("invalid actor URL format: %s", actorURL)
	}

	username := parts[1]
	if username == "" {
		return "", fmt.Errorf("empty username in URL: %s", actorURL)
	}

	return username, nil
}

func ParseUsernameFromPath(urlPath string) (string, error) {
	parts := strings.Split(strings.Trim(urlPath, "/"), "/")
	if len(parts) < 2 || parts[0] != "activitypub" {
		return "", fmt.Errorf("invalid activitypub path format: %s", urlPath)
	}

	username := parts[1]
	if username == "" {
		return "", fmt.Errorf("empty username in path: %s", urlPath)
	}

	return username, nil
}

func IsActivityPubURL(urlStr string) bool {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}

	return strings.HasPrefix(u.Path, "/activitypub/")
}

func GetEndpointType(urlStr string) (string, error) {
	u, err := url.Parse(urlStr)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}

	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "activitypub" {
		return "", fmt.Errorf("invalid activitypub URL format: %s", urlStr)
	}

	endpointType := parts[len(parts)-1]
	validTypes := map[string]bool{
		"actor":     true,
		"inbox":     true,
		"outbox":    true,
		"followers": true,
		"following": true,
		"liked":     true,
	}

	if validTypes[endpointType] {
		return endpointType, nil
	}

	if parts[len(parts)-2] == "activities" || parts[len(parts)-2] == "objects" {
		return parts[len(parts)-2], nil
	}

	return "", fmt.Errorf("unknown endpoint type in URL: %s", urlStr)
}

func JoinURL(baseURL string, paths ...string) string {
	base := strings.TrimSuffix(baseURL, "/")
	for _, p := range paths {
		base = base + "/" + strings.TrimPrefix(p, "/")
	}
	return base
}

func NormalizeURL(urlStr string) (string, error) {
	u, err := url.Parse(urlStr)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}

	u.Path = path.Clean(u.Path)
	u.RawQuery = ""
	u.Fragment = ""

	return u.String(), nil
}
