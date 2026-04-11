// context_reference_service.go — Parses, validates, and expands @-references in user messages.
// Changelog:
// 2026-04-11 — Fix SSRF vulnerability in expandURL: added validateURLSafety with DNS
//   resolution, private/reserved IP blocking, cloud metadata host blocking, scheme
//   enforcement (http/https only), and port allow-list (80/443/8080/8443). Integrated
//   SSRF check into both validateSecurity (for early rejection) and expandURL (defense
//   in depth). Added helper functions isPrivateOrReserved and mustParseCIDR.
// 2026-04-11 — Initial implementation: regex-based @-reference parsing (file, folder,
//   url, diff, staged, git), workspace sandbox enforcement, sensitive path blocking,
//   binary file detection, token budget management (hard 50% / soft 25%), and content
//   expansion via os.ReadFile, os.ReadDir (recursive), exec.CommandContext (git),
//   and http.Get (url).

package service

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// ---------------------------------------------------------------------------
// Reference patterns — compiled once at package init.
// ---------------------------------------------------------------------------

var refPatterns = []*regexp.Regexp{
	// @file:path:lineStart-lineEnd  (line range is optional)
	regexp.MustCompile(`@file:([^\s:]+)(?::(\d+)-(\d+))?`),
	// @folder:path
	regexp.MustCompile(`@folder:([^\s]+)`),
	// @url:http(s)://...
	regexp.MustCompile(`@url:(https?://[^\s]+)`),
	// @diff — working tree diff
	regexp.MustCompile(`@diff\b`),
	// @staged — staged diff
	regexp.MustCompile(`@staged\b`),
	// @git:N — last N commits
	regexp.MustCompile(`@git:(\d+)`),
}

// refKindByIndex maps the pattern index to the reference kind string.
var refKindByIndex = []string{
	"file",
	"folder",
	"url",
	"diff",
	"staged",
	"git",
}

// ---------------------------------------------------------------------------
// Sensitive path patterns — any path containing these segments is blocked.
// ---------------------------------------------------------------------------

var sensitivePaths = []string{
	".ssh",
	".aws",
	".gnupg",
	".kube",
	".docker",
	".hermes/.env",
	".netrc",
	".pgpass",
	".npmrc",
	".pypirc",
	"authorized_keys",
	"id_rsa",
	"id_ed25519",
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const (
	// Token budget thresholds (fractions of contextWindowSize).
	tokenHardLimitRatio = 0.50
	tokenSoftLimitRatio = 0.25

	// Folder expansion limits.
	folderMaxDepth   = 3
	folderMaxEntries = 50

	// Git / URL command timeout.
	externalCmdTimeout = 10 * time.Second

	// Binary detection: scan first N bytes for null bytes.
	binaryProbeSize = 512

	// Rough token estimation: 1 token per 4 bytes.
	bytesPerToken = 4

	// URL response body size cap (1 MB).
	urlMaxBodyBytes = 1 << 20
)

// ---------------------------------------------------------------------------
// ContextReferenceService
// ---------------------------------------------------------------------------

// ContextReferenceService parses @-references from user messages, enforces
// workspace sandbox and security constraints, expands reference content,
// and manages the injection token budget.
type ContextReferenceService struct{}

func NewContextReferenceService() *ContextReferenceService {
	return &ContextReferenceService{}
}

// ---------------------------------------------------------------------------
// Process — main entry point
// ---------------------------------------------------------------------------

// Process parses all @-references from userMessage, validates and expands
// each one, and returns a ContextReferenceResult with the rewritten message
// and metadata. contextWindowSize is the model's total context window in tokens.
func (s *ContextReferenceService) Process(
	ctx context.Context,
	userMessage string,
	workspaceRoot string,
	contextWindowSize int,
) (*domain.ContextReferenceResult, error) {

	result := &domain.ContextReferenceResult{
		OriginalMessage: userMessage,
	}

	// Step 1 — Parse all @-references from the message.
	refs := s.parseReferences(userMessage)
	result.References = refs

	if len(refs) == 0 {
		result.Message = userMessage
		logger.Infof(ctx, "context_reference: no @-references found in message")
		return result, nil
	}

	logger.Infof(ctx, "context_reference: parsed %d @-references from message", len(refs))

	// Step 2 — Expand each reference, applying security and budget checks.
	hardLimit := int(float64(contextWindowSize) * tokenHardLimitRatio)
	softLimit := int(float64(contextWindowSize) * tokenSoftLimitRatio)
	usedTokens := 0

	// Process references from back to front so that character offsets remain
	// valid when we splice expanded content into the message.
	sort.Slice(refs, func(i, j int) bool {
		return refs[i].Start > refs[j].Start
	})

	rewritten := userMessage

	for i := range refs {
		ref := &refs[i]

		// Security: validate the reference target.
		if err := s.validateSecurity(ctx, ref, workspaceRoot); err != nil {
			result.Blocked = append(result.Blocked, ref.Raw)
			logger.Warnf(ctx, "context_reference: blocked %q — %v", ref.Raw, err)
			continue
		}

		// Expand the reference content.
		content, err := s.expandReference(ctx, ref, workspaceRoot)
		if err != nil {
			result.Blocked = append(result.Blocked, ref.Raw)
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("failed to expand %s: %v", ref.Raw, err))
			logger.Warnf(ctx, "context_reference: expansion failed for %q — %v", ref.Raw, err)
			continue
		}

		// Token budget enforcement.
		contentTokens := estimateTokens(content)

		if usedTokens+contentTokens > hardLimit {
			result.Blocked = append(result.Blocked, ref.Raw)
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("hard token budget exceeded for %s (would use %d, limit %d)",
					ref.Raw, usedTokens+contentTokens, hardLimit))
			logger.Warnf(ctx, "context_reference: hard budget exceeded for %q — skipped", ref.Raw)
			continue
		}

		if usedTokens+contentTokens > softLimit {
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("soft token budget exceeded after %s (used %d, soft limit %d)",
					ref.Raw, usedTokens+contentTokens, softLimit))
			logger.Warnf(ctx, "context_reference: soft budget exceeded after %q", ref.Raw)
		}

		// Inject expanded content into the message.
		injected := formatInjection(ref, content)
		rewritten = rewritten[:ref.Start] + injected + rewritten[ref.End:]

		usedTokens += contentTokens
		result.Expanded = append(result.Expanded, ref.Raw)
	}

	result.Message = rewritten
	result.InjectedTokens = usedTokens

	logger.Infof(ctx, "context_reference: expanded %d, blocked %d, injected_tokens=%d",
		len(result.Expanded), len(result.Blocked), usedTokens)

	return result, nil
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// parseReferences scans the message for all known @-reference patterns and
// returns them in order of appearance (by Start offset).
func (s *ContextReferenceService) parseReferences(message string) []domain.ContextReference {
	var refs []domain.ContextReference

	for patIdx, pat := range refPatterns {
		matches := pat.FindAllStringSubmatchIndex(message, -1)
		for _, loc := range matches {
			ref := domain.ContextReference{
				Raw:   message[loc[0]:loc[1]],
				Kind:  refKindByIndex[patIdx],
				Start: loc[0],
				End:   loc[1],
			}

			switch ref.Kind {
			case "file":
				ref.Target = message[loc[2]:loc[3]]
				if loc[4] >= 0 && loc[5] >= 0 && loc[6] >= 0 && loc[7] >= 0 {
					ref.LineStart, _ = strconv.Atoi(message[loc[4]:loc[5]])
					ref.LineEnd, _ = strconv.Atoi(message[loc[6]:loc[7]])
				}

			case "folder":
				ref.Target = message[loc[2]:loc[3]]

			case "url":
				ref.Target = message[loc[2]:loc[3]]

			case "git":
				ref.Target = message[loc[2]:loc[3]]

			case "diff", "staged":
				// No target to extract.
			}

			refs = append(refs, ref)
		}
	}

	// Sort by Start offset ascending for deterministic ordering.
	sort.Slice(refs, func(i, j int) bool {
		return refs[i].Start < refs[j].Start
	})

	return refs
}

// ---------------------------------------------------------------------------
// Security validation
// ---------------------------------------------------------------------------

// validateSecurity enforces workspace sandbox and sensitive path constraints.
func (s *ContextReferenceService) validateSecurity(
	ctx context.Context,
	ref *domain.ContextReference,
	workspaceRoot string,
) error {

	switch ref.Kind {
	case "file", "folder":
		return s.validatePathSecurity(ctx, ref.Target, workspaceRoot)

	case "url":
		// SSRF protection: block private IPs, cloud metadata, and disallowed schemes/ports.
		if err := validateURLSafety(ref.Target); err != nil {
			logger.Warnf(ctx, "context_reference: SSRF check blocked url %q — %v", ref.Target, err)
			return errcode.New(
				errcode.AgentSecurityViolation, http.StatusForbidden,
				fmt.Sprintf("url %q blocked by SSRF protection: %v", ref.Target, err), nil,
			)
		}
		return nil

	case "diff", "staged", "git":
		// Git commands run inside workspaceRoot; no path validation needed.
		return nil
	}

	return nil
}

// validatePathSecurity ensures a filesystem path is within the workspace root
// and does not reference sensitive files or directories.
func (s *ContextReferenceService) validatePathSecurity(
	ctx context.Context,
	target string,
	workspaceRoot string,
) error {

	resolved := filepath.Clean(filepath.Join(workspaceRoot, target))
	cleanRoot := filepath.Clean(workspaceRoot)

	// Sandbox check: resolved path must be under workspaceRoot.
	if !strings.HasPrefix(resolved, cleanRoot+string(filepath.Separator)) && resolved != cleanRoot {
		logger.Warnf(ctx, "context_reference: sandbox violation — %q resolves to %q, outside %q",
			target, resolved, cleanRoot)
		return errcode.New(
			errcode.AgentSecurityViolation, http.StatusForbidden,
			fmt.Sprintf("path %q escapes workspace sandbox", target), nil,
		)
	}

	// Sensitive path check: block paths that contain known sensitive segments.
	for _, sensitive := range sensitivePaths {
		if strings.Contains(resolved, sensitive) {
			logger.Warnf(ctx, "context_reference: sensitive path blocked — %q contains %q",
				resolved, sensitive)
			return errcode.New(
				errcode.AgentSecurityViolation, http.StatusForbidden,
				fmt.Sprintf("path %q contains sensitive segment %q", target, sensitive), nil,
			)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// Reference expansion
// ---------------------------------------------------------------------------

// expandReference dispatches to the appropriate expander based on reference kind.
func (s *ContextReferenceService) expandReference(
	ctx context.Context,
	ref *domain.ContextReference,
	workspaceRoot string,
) (string, error) {

	switch ref.Kind {
	case "file":
		return s.expandFile(ctx, ref, workspaceRoot)
	case "folder":
		return s.expandFolder(ctx, ref.Target, workspaceRoot)
	case "url":
		return s.expandURL(ctx, ref.Target)
	case "diff":
		return s.expandGitCommand(ctx, workspaceRoot, "diff")
	case "staged":
		return s.expandGitCommand(ctx, workspaceRoot, "diff", "--staged")
	case "git":
		n := ref.Target
		return s.expandGitCommand(ctx, workspaceRoot, "log", "--oneline", "-n", n)
	default:
		return "", fmt.Errorf("unsupported reference kind %q", ref.Kind)
	}
}

// expandFile reads a file's content, optionally slicing a line range.
func (s *ContextReferenceService) expandFile(
	ctx context.Context,
	ref *domain.ContextReference,
	workspaceRoot string,
) (string, error) {

	absPath := filepath.Join(workspaceRoot, ref.Target)

	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", fmt.Errorf("read file %q: %w", ref.Target, err)
	}

	// Binary detection: check first 512 bytes for null bytes.
	probeLen := binaryProbeSize
	if len(data) < probeLen {
		probeLen = len(data)
	}
	for i := 0; i < probeLen; i++ {
		if data[i] == 0 {
			return "", fmt.Errorf("file %q appears to be binary (null byte at offset %d)", ref.Target, i)
		}
	}

	content := string(data)

	// Apply optional line range slicing.
	if ref.LineStart > 0 && ref.LineEnd > 0 {
		lines := strings.Split(content, "\n")

		start := ref.LineStart - 1 // convert to 0-based
		end := ref.LineEnd
		if start < 0 {
			start = 0
		}
		if end > len(lines) {
			end = len(lines)
		}
		if start >= end {
			return "", fmt.Errorf("invalid line range %d-%d for file %q (%d lines)",
				ref.LineStart, ref.LineEnd, ref.Target, len(lines))
		}

		content = strings.Join(lines[start:end], "\n")
	}

	logger.Infof(ctx, "context_reference: expanded file %q (%d bytes)", ref.Target, len(content))
	return content, nil
}

// expandFolder recursively reads directory entries up to maxDepth/maxEntries
// and builds a tree-style string representation.
func (s *ContextReferenceService) expandFolder(
	ctx context.Context,
	target string,
	workspaceRoot string,
) (string, error) {

	absPath := filepath.Join(workspaceRoot, target)

	info, err := os.Stat(absPath)
	if err != nil {
		return "", fmt.Errorf("stat folder %q: %w", target, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%q is not a directory", target)
	}

	var sb strings.Builder
	entryCount := 0

	err = s.walkDir(&sb, absPath, "", 0, &entryCount)
	if err != nil {
		return "", fmt.Errorf("walk folder %q: %w", target, err)
	}

	result := sb.String()
	logger.Infof(ctx, "context_reference: expanded folder %q (%d entries)", target, entryCount)
	return result, nil
}

// walkDir is a recursive helper that builds the directory tree string.
func (s *ContextReferenceService) walkDir(
	sb *strings.Builder,
	absPath string,
	prefix string,
	depth int,
	entryCount *int,
) error {

	if depth >= folderMaxDepth {
		sb.WriteString(prefix + "... (max depth reached)\n")
		return nil
	}

	if *entryCount >= folderMaxEntries {
		sb.WriteString(prefix + "... (max entries reached)\n")
		return nil
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if *entryCount >= folderMaxEntries {
			sb.WriteString(prefix + "... (max entries reached)\n")
			return nil
		}

		name := entry.Name()
		*entryCount++

		if entry.IsDir() {
			sb.WriteString(prefix + name + "/\n")
			err := s.walkDir(sb, filepath.Join(absPath, name), prefix+"  ", depth+1, entryCount)
			if err != nil {
				return err
			}
		} else {
			sb.WriteString(prefix + name + "\n")
		}
	}

	return nil
}

// expandGitCommand runs a git command inside workspaceRoot with a timeout.
func (s *ContextReferenceService) expandGitCommand(
	ctx context.Context,
	workspaceRoot string,
	args ...string,
) (string, error) {

	cmdCtx, cancel := context.WithTimeout(ctx, externalCmdTimeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "git", args...)
	cmd.Dir = workspaceRoot

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %w (output: %s)",
			strings.Join(args, " "), err, truncate(string(output), 512))
	}

	result := string(output)
	logger.Infof(ctx, "context_reference: expanded git %s (%d bytes)", strings.Join(args, " "), len(result))
	return result, nil
}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

// validateURLSafety performs SSRF protection checks on the target URL.
// Returns an error if the URL points to a private/reserved network, cloud
// metadata service, or uses a disallowed scheme/port.
func validateURLSafety(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	// Scheme check: only HTTP(S) allowed.
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("blocked scheme %q: only http/https allowed", scheme)
	}

	// Port check: only common web ports allowed.
	port := parsed.Port()
	if port != "" && port != "80" && port != "443" && port != "8080" && port != "8443" {
		return fmt.Errorf("blocked port %s: only 80/443/8080/8443 allowed", port)
	}

	hostname := parsed.Hostname()

	// Block well-known cloud metadata hostnames.
	blockedHosts := []string{
		"metadata.google.internal",
		"metadata.google",
		"100.100.100.200",
	}
	lowerHost := strings.ToLower(hostname)
	for _, blocked := range blockedHosts {
		if lowerHost == blocked {
			return fmt.Errorf("blocked cloud metadata host %q", hostname)
		}
	}

	// Resolve DNS and check IP ranges.
	ips, err := net.LookupHost(hostname)
	if err != nil {
		return fmt.Errorf("DNS resolution failed for %q: %w", hostname, err)
	}

	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if isPrivateOrReserved(ip) {
			return fmt.Errorf("blocked private/reserved IP %s for host %q", ipStr, hostname)
		}
	}

	return nil
}

// isPrivateOrReserved checks if an IP address falls within private, loopback,
// link-local, or other reserved ranges that should not be accessed via SSRF.
func isPrivateOrReserved(ip net.IP) bool {
	privateRanges := []struct {
		network *net.IPNet
	}{
		{mustParseCIDR("10.0.0.0/8")},
		{mustParseCIDR("172.16.0.0/12")},
		{mustParseCIDR("192.168.0.0/16")},
		{mustParseCIDR("127.0.0.0/8")},
		{mustParseCIDR("169.254.0.0/16")},
		{mustParseCIDR("::1/128")},
		{mustParseCIDR("fc00::/7")},
		{mustParseCIDR("fe80::/10")},
		{mustParseCIDR("100.64.0.0/10")},
	}

	for _, r := range privateRanges {
		if r.network.Contains(ip) {
			return true
		}
	}
	return false
}

// mustParseCIDR parses a CIDR string and panics on failure (intended for
// compile-time-constant CIDR literals only).
func mustParseCIDR(s string) *net.IPNet {
	_, network, err := net.ParseCIDR(s)
	if err != nil {
		panic("invalid CIDR: " + s)
	}
	return network
}

// expandURL fetches the content at the given URL with a timeout.
// SSRF protection is applied as defense-in-depth even though validateSecurity
// already checks URLs during the earlier validation phase.
func (s *ContextReferenceService) expandURL(
	ctx context.Context,
	rawURL string,
) (string, error) {

	// SSRF protection: validate URL before making any network request.
	if err := validateURLSafety(rawURL); err != nil {
		logger.Warnf(ctx, "context_reference: SSRF protection blocked url %q — %v", rawURL, err)
		return "", fmt.Errorf("url blocked by SSRF protection: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, externalCmdTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("build request for %q: %w", rawURL, err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch url %q: %w", rawURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("url %q returned HTTP %d", rawURL, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, urlMaxBodyBytes))
	if err != nil {
		return "", fmt.Errorf("read body from %q: %w", rawURL, err)
	}

	result := string(body)
	logger.Infof(ctx, "context_reference: expanded url %q (%d bytes)", rawURL, len(result))
	return result, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// estimateTokens provides a rough token count estimation: 1 token per 4 bytes.
func estimateTokens(content string) int {
	return len(content) / bytesPerToken
}

// formatInjection wraps expanded content in a tagged block for the rewritten message.
func formatInjection(ref *domain.ContextReference, content string) string {
	label := ref.Kind
	if ref.Target != "" {
		label += ":" + ref.Target
	}
	return fmt.Sprintf("\n<context_reference kind=%q target=%q>\n%s\n</context_reference>\n",
		ref.Kind, ref.Target, content)
}

// truncate shortens a string to maxLen, appending "..." when truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
