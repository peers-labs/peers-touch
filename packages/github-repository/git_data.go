package githubrepository

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
)

const (
	MaxResponseBytes     = 8 << 20
	maxGitHubTreeDepth   = 64
	maxGitHubTreeEntries = 1_000_000
)

type Client struct {
	apiBase    string
	owner      string
	repository string
	branch     string
	auth       *AppAuthenticator
	httpClient *http.Client
	maxRetries int
}

type Snapshot struct {
	client  *Client
	headSHA string
	treeSHA string
	entries map[string]string
}

type Mutation func(snapshot *Snapshot) (map[string][]byte, error)

type gitTreeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
}

type gitTreeResponse struct {
	Truncated bool           `json:"truncated"`
	Tree      []gitTreeEntry `json:"tree"`
}

func NewClient(apiBase, owner, repositoryName, branch string, auth *AppAuthenticator, httpClient *http.Client) (*Client, error) {
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(repositoryName) == "" || strings.TrimSpace(branch) == "" || auth == nil {
		return nil, errors.New("invalid_github_storage_configuration")
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		apiBase:    strings.TrimRight(apiBase, "/"),
		owner:      owner,
		repository: repositoryName,
		branch:     branch,
		auth:       auth,
		httpClient: httpClient,
		maxRetries: 3,
	}, nil
}

func (c *Client) Read(ctx context.Context, recordPath string) ([]byte, bool, error) {
	snapshot, err := c.Snapshot(ctx)
	if err != nil {
		return nil, false, err
	}
	return snapshot.Read(ctx, recordPath)
}

func (c *Client) View(ctx context.Context, view func(*Snapshot) error) error {
	snapshot, err := c.Snapshot(ctx)
	if err != nil {
		return err
	}
	return view(snapshot)
}

func (c *Client) Update(ctx context.Context, message string, mutation Mutation) error {
	_, err := c.UpdateRevision(ctx, message, mutation)
	return err
}

func (c *Client) UpdateRevision(
	ctx context.Context,
	message string,
	mutation Mutation,
) (string, error) {
	var lastErr error
	for attempt := 0; attempt < c.maxRetries; attempt++ {
		snapshot, err := c.Snapshot(ctx)
		if err != nil {
			lastErr = err
			continue
		}
		changes, err := mutation(snapshot)
		if err != nil {
			if errors.Is(err, ErrConflict) ||
				errors.Is(err, ErrUnavailable) {
				lastErr = err
				continue
			}
			return "", err
		}
		if len(changes) == 0 {
			return snapshot.headSHA, nil
		}
		revision, err := c.commit(ctx, snapshot, message, changes)
		if err != nil {
			lastErr = err
			if errors.Is(err, ErrConflict) ||
				errors.Is(err, ErrUnavailable) {
				continue
			}
			return "", err
		}
		return revision, nil
	}
	if errors.Is(lastErr, ErrConflict) {
		return "", ErrConflict
	}
	return "", ErrUnavailable
}

func (s *Snapshot) Read(ctx context.Context, recordPath string) ([]byte, bool, error) {
	sha, ok := s.entries[recordPath]
	if !ok {
		return nil, false, nil
	}
	var payload struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if err := s.client.request(ctx, http.MethodGet, s.client.repoPath("/git/blobs/"+url.PathEscape(sha)), nil, &payload); err != nil {
		return nil, false, err
	}
	if payload.Encoding != "base64" {
		return nil, false, ErrCorrupt
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(payload.Content, "\n", ""))
	if err != nil {
		return nil, false, ErrCorrupt
	}
	return decoded, true, nil
}

func (s *Snapshot) Paths(prefix string) []string {
	paths := make([]string, 0)
	for recordPath := range s.entries {
		if strings.HasPrefix(recordPath, prefix) {
			paths = append(paths, recordPath)
		}
	}
	sort.Strings(paths)
	return paths
}

func (s *Snapshot) Revision() string {
	return s.headSHA
}

func (c *Client) Snapshot(ctx context.Context) (*Snapshot, error) {
	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	refPath := c.repoPath("/git/ref/heads/" + url.PathEscape(c.branch))
	if err := c.request(ctx, http.MethodGet, refPath, nil, &ref); err != nil {
		return nil, err
	}
	if ref.Object.SHA == "" {
		return nil, ErrCorrupt
	}
	return c.snapshotAtCommit(ctx, ref.Object.SHA)
}

func (c *Client) SnapshotAtCommit(
	ctx context.Context,
	commitSHA string,
) (*Snapshot, error) {
	if !validGitObjectID(commitSHA) {
		return nil, ErrCorrupt
	}
	return c.snapshotAtCommit(ctx, commitSHA)
}

func (c *Client) snapshotAtCommit(
	ctx context.Context,
	commitSHA string,
) (*Snapshot, error) {
	var commit struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	if err := c.request(
		ctx,
		http.MethodGet,
		c.repoPath("/git/commits/"+url.PathEscape(commitSHA)),
		nil,
		&commit,
	); err != nil {
		return nil, err
	}
	if commit.Tree.SHA == "" {
		return nil, ErrCorrupt
	}
	entries, err := c.loadTreeEntries(ctx, commit.Tree.SHA)
	if err != nil {
		return nil, err
	}
	return &Snapshot{
		client:  c,
		headSHA: commitSHA,
		treeSHA: commit.Tree.SHA,
		entries: entries,
	}, nil
}

func validGitObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') &&
			(character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func (c *Client) loadTreeEntries(ctx context.Context, rootSHA string) (map[string]string, error) {
	tree, err := c.readTree(ctx, rootSHA, true)
	if err == nil && !tree.Truncated {
		if len(tree.Tree) > maxGitHubTreeEntries {
			return nil, ErrUnavailable
		}
		return blobEntries(tree.Tree, ""), nil
	}
	if err != nil && !errors.Is(err, ErrResponseTooLarge) {
		return nil, err
	}

	type pendingTree struct {
		sha    string
		prefix string
		depth  int
	}
	pending := []pendingTree{{sha: rootSHA}}
	entries := make(map[string]string)
	visitedEntries := 0
	for len(pending) > 0 {
		current := pending[0]
		pending = pending[1:]
		tree, err := c.readTree(ctx, current.sha, false)
		if err != nil {
			return nil, err
		}
		if tree.Truncated {
			return nil, ErrUnavailable
		}
		visitedEntries += len(tree.Tree)
		if visitedEntries > maxGitHubTreeEntries {
			return nil, ErrUnavailable
		}
		for _, entry := range tree.Tree {
			if entry.Path == "" || entry.SHA == "" {
				return nil, ErrCorrupt
			}
			recordPath := path.Join(current.prefix, entry.Path)
			switch entry.Type {
			case "blob":
				entries[recordPath] = entry.SHA
			case "tree":
				if current.depth >= maxGitHubTreeDepth {
					return nil, ErrUnavailable
				}
				pending = append(pending, pendingTree{
					sha:    entry.SHA,
					prefix: recordPath,
					depth:  current.depth + 1,
				})
			}
		}
	}
	return entries, nil
}

func (c *Client) readTree(ctx context.Context, sha string, recursive bool) (gitTreeResponse, error) {
	var tree gitTreeResponse
	treePath := c.repoPath("/git/trees/" + url.PathEscape(sha))
	if recursive {
		treePath += "?recursive=1"
	}
	if err := c.request(ctx, http.MethodGet, treePath, nil, &tree); err != nil {
		return gitTreeResponse{}, err
	}
	return tree, nil
}

func blobEntries(tree []gitTreeEntry, prefix string) map[string]string {
	entries := make(map[string]string)
	for _, entry := range tree {
		if entry.Type == "blob" && entry.Path != "" && entry.SHA != "" {
			entries[path.Join(prefix, entry.Path)] = entry.SHA
		}
	}
	return entries
}

func (c *Client) commit(
	ctx context.Context,
	snapshot *Snapshot,
	message string,
	changes map[string][]byte,
) (string, error) {
	type treeEntry struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
		Type string `json:"type"`
		SHA  string `json:"sha"`
	}
	paths := make([]string, 0, len(changes))
	for recordPath := range changes {
		paths = append(paths, recordPath)
	}
	sort.Strings(paths)
	entries := make([]treeEntry, 0, len(paths))
	for _, recordPath := range paths {
		var blob struct {
			SHA string `json:"sha"`
		}
		body := map[string]string{
			"content":  base64.StdEncoding.EncodeToString(changes[recordPath]),
			"encoding": "base64",
		}
		if err := c.request(ctx, http.MethodPost, c.repoPath("/git/blobs"), body, &blob); err != nil {
			return "", err
		}
		if blob.SHA == "" {
			return "", ErrUnavailable
		}
		entries = append(entries, treeEntry{
			Path: recordPath,
			Mode: "100644",
			Type: "blob",
			SHA:  blob.SHA,
		})
	}
	var tree struct {
		SHA string `json:"sha"`
	}
	if err := c.request(ctx, http.MethodPost, c.repoPath("/git/trees"), map[string]any{
		"base_tree": snapshot.treeSHA,
		"tree":      entries,
	}, &tree); err != nil {
		return "", err
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := c.request(ctx, http.MethodPost, c.repoPath("/git/commits"), map[string]any{
		"message": message,
		"tree":    tree.SHA,
		"parents": []string{snapshot.headSHA},
	}, &commit); err != nil {
		return "", err
	}
	if commit.SHA == "" {
		return "", ErrUnavailable
	}
	err := c.request(ctx, http.MethodPatch, c.repoPath("/git/refs/heads/"+url.PathEscape(c.branch)), map[string]any{
		"sha":   commit.SHA,
		"force": false,
	}, nil)
	if err != nil {
		return "", err
	}
	return commit.SHA, nil
}

func (c *Client) repoPath(suffix string) string {
	return fmt.Sprintf(
		"%s/repos/%s/%s%s",
		c.apiBase,
		url.PathEscape(c.owner),
		url.PathEscape(c.repository),
		suffix,
	)
}

func (c *Client) request(ctx context.Context, method, endpoint string, body, output any) error {
	for authAttempt := 0; authAttempt < 2; authAttempt++ {
		token, err := c.auth.InstallationToken(ctx)
		if err != nil {
			return err
		}
		var encoded []byte
		if body != nil {
			encoded, err = json.Marshal(body)
			if err != nil {
				return ErrUnavailable
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(encoded))
		if err != nil {
			return ErrUnavailable
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("User-Agent", "peers-touch-github-repository")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			return ErrUnavailable
		}
		responseBody, readErr := io.ReadAll(
			io.LimitReader(resp.Body, MaxResponseBytes+1),
		)
		_ = resp.Body.Close()
		if readErr != nil {
			return ErrUnavailable
		}
		if len(responseBody) > MaxResponseBytes {
			return errors.Join(
				ErrUnavailable,
				ErrResponseTooLarge,
			)
		}
		if resp.StatusCode == http.StatusUnauthorized && authAttempt == 0 {
			c.auth.Invalidate()
			continue
		}
		if resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusUnprocessableEntity {
			return ErrConflict
		}
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			return ErrUnavailable
		}
		if output != nil {
			if err := json.Unmarshal(responseBody, output); err != nil {
				return ErrUnavailable
			}
		}
		return nil
	}
	return ErrUnavailable
}

func NewDefaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}
