package federation

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	m "github.com/peers-labs/peers-touch/station/frame/touch/model"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
)

// ResolveActorIRI resolves a resource (acct: or URL) to an actor IRI.
func ResolveActorIRI(ctx context.Context, resource string) (string, error) {
	if strings.HasPrefix(resource, "acct:") {
		return resolveViaWebFinger(ctx, resource)
	}
	if strings.HasPrefix(resource, "http://") || strings.HasPrefix(resource, "https://") {
		return resource, nil
	}
	return "", fmt.Errorf("unsupported resource: %s", resource)
}

func resolveViaWebFinger(ctx context.Context, resource string) (string, error) {
	u := fmt.Sprintf("/.well-known/webfinger?resource=%s", url.QueryEscape(resource))
	base := "https://" + extractDomainFromAcct(resource)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", m.AcceptJRDJSON)
	cli := &http.Client{Timeout: 10 * time.Second}
	resp, err := cli.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("webfinger status: %d", resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	var j struct {
		Links []struct {
			Rel  string `json:"rel"`
			Type string `json:"type"`
			Href string `json:"href"`
		} `json:"links"`
	}
	if err := json.Unmarshal(b, &j); err != nil {
		return "", err
	}
	for _, l := range j.Links {
		if l.Rel == "self" && l.Type == m.ContentTypeActivityJSON && l.Href != "" {
			return l.Href, nil
		}
	}
	return "", errors.New("self link not found")
}

func extractDomainFromAcct(resource string) string {
	s := strings.TrimPrefix(resource, "acct:")
	p := strings.SplitN(s, "@", 2)
	if len(p) == 2 {
		return p[1]
	}
	return s
}

// FetchActorDoc fetches and decodes an ActivityPub actor document.
func FetchActorDoc(ctx context.Context, actorIRI string) (*ap.Actor, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, actorIRI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", m.AcceptActivityJSONLD)
	cli := &http.Client{Timeout: 10 * time.Second}
	resp, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("actor fetch status: %d", resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var a ap.Actor
	if err := json.Unmarshal(b, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

// ChooseInbox returns the preferred inbox (shared or actor inbox) for delivery.
func ChooseInbox(a *ap.Actor, preferShared bool) (string, error) {
	if a == nil {
		return "", errors.New("nil actor")
	}
	if preferShared && a.Endpoints != nil && a.Endpoints.SharedInbox != nil {
		return string(a.Endpoints.SharedInbox.GetLink()), nil
	}
	if a.Inbox != nil {
		return string(a.Inbox.GetLink()), nil
	}
	return "", errors.New("no inbox available")
}

// DeliverActivity signs and posts an activity to the target inbox.
func DeliverActivity(ctx context.Context, target string, activity *ap.Activity, keyID string, privateKeyPEM string) (int, error) {
	if activity == nil {
		return 0, errors.New("nil activity")
	}
	body, err := json.Marshal(activity)
	if err != nil {
		return 0, err
	}
	digest := computeDigest(body)
	u, err := url.Parse(target)
	if err != nil {
		return 0, err
	}
	date := time.Now().UTC().Format(http.TimeFormat)
	signingString := buildClientSigningString("post", u, date, digest)
	sig, err := signString(privateKeyPEM, signingString)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(string(body)))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", m.AcceptActivityJSON)
	req.Header.Set("Content-Type", m.ContentTypeActivityJSON)
	req.Header.Set("Date", date)
	req.Header.Set("Digest", digest)
	req.Header.Set("Host", u.Host)
	req.Header.Set("Signature", fmt.Sprintf("keyId=\"%s\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date digest\",signature=\"%s\"", keyID, sig))
	cli := &http.Client{Timeout: 10 * time.Second}
	resp, err := cli.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func computeDigest(b []byte) string {
	sum := sha256.Sum256(b)
	return "SHA-256=" + base64.StdEncoding.EncodeToString(sum[:])
}

func buildClientSigningString(method string, u *url.URL, date string, digest string) string {
	m := strings.ToLower(method)
	p := u.EscapedPath()
	if u.RawQuery != "" {
		p = p + "?" + u.RawQuery
	}
	var sb strings.Builder
	sb.WriteString("(request-target): ")
	sb.WriteString(m)
	sb.WriteString(" ")
	sb.WriteString(p)
	sb.WriteString("\n")
	sb.WriteString("host: ")
	sb.WriteString(u.Host)
	sb.WriteString("\n")
	sb.WriteString("date: ")
	sb.WriteString(date)
	sb.WriteString("\n")
	sb.WriteString("digest: ")
	sb.WriteString(digest)
	return sb.String()
}

func signString(privateKeyPEM string, s string) (string, error) {
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return "", errors.New("invalid pem")
	}
	pk, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256([]byte(s))
	sig, err := rsa.SignPKCS1v15(nil, pk, crypto.SHA256, h[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

// GetActorData returns actor data for the given username.
// Deprecated stub - returns error directing to Social API.
func GetActorData(c context.Context, username string, baseURL string) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API /api/v1/social/actors/:username instead")
}

// FetchOutbox returns outbox collection for the given user.
// Deprecated stub - returns error directing to Social API.
func FetchOutbox(c context.Context, user string, baseURL string, page bool, viewerID uint64) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API /api/v1/social/timeline instead")
}

// FetchFollowers returns followers collection for the given user.
// Deprecated stub - returns error directing to Social API.
func FetchFollowers(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API instead")
}

// FetchLiked returns liked collection for the given user.
// Deprecated stub - returns error directing to Social API.
func FetchLiked(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API instead")
}

// FetchSharedInbox returns the shared inbox collection.
// Deprecated stub - returns error directing to Social API.
func FetchSharedInbox(c context.Context, baseURL string, page bool) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API instead")
}

// FetchObjectReplies returns replies for a specific object.
// Deprecated stub - returns error directing to Social API.
func FetchObjectReplies(c context.Context, objectID string, baseURL string, page bool, afterID uint64, limit int) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API /api/v1/social/posts/:id/comments instead")
}

// VerifyHTTPSignature verifies the HTTP signature of an incoming request.
// Deprecated stub - returns error.
func VerifyHTTPSignature(c context.Context, method string, path string, headers map[string]string, body []byte) error {
	return fmt.Errorf("deprecated: ActivityPub signature verification is no longer supported")
}

// PersistInboxActivity persists a raw inbox activity.
// Deprecated stub - returns error directing to Social API.
func PersistInboxActivity(c context.Context, user string, activity *ap.Activity, baseURL string, body []byte) error {
	return fmt.Errorf("deprecated: use Social API instead")
}

// ApplyFollowInbox applies side effects for a Follow activity received in the inbox.
// Deprecated stub - returns error directing to Social API.
func ApplyFollowInbox(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("deprecated: use Social API /api/v1/social/actors/:id/follow instead")
}

// ApplyUndoInbox applies side effects for an Undo activity received in the inbox.
// Deprecated stub - returns error directing to Social API.
func ApplyUndoInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("deprecated: use Social API instead")
}

// IsValidationError returns true if the error is a validation error.
func IsValidationError(err error) bool {
	return false
}

// GetNodeInfo returns node info data.
// Deprecated stub - returns error.
func GetNodeInfo(c context.Context, baseURL string) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: NodeInfo is no longer supported")
}

// Create creates a new activity for the given actor.
// Deprecated stub - returns error directing to Social API.
func Create(c context.Context, actor string, baseURL string, in interface{}) (string, string, error) {
	return "", "", fmt.Errorf("deprecated: use Social API /api/v1/social/posts instead")
}
