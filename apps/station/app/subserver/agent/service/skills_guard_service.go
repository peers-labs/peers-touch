// Changelog:
// 2026-04-11 — Initial implementation: Skills Guard security scanning engine
//              with 13 threat category pattern groups, structural checks,
//              binary detection, invisible Unicode detection, and verdict resolution.

package service

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

type threatPattern struct {
	ID          string
	Severity    string
	Category    string
	Pattern     *regexp.Regexp
	Description string
}

// SkillsGuardService performs security scanning on skill content
// before installation. It detects exfiltration, injection, destructive
// commands, persistence mechanisms, and other threat categories.
type SkillsGuardService struct {
	patterns           []threatPattern
	binaryExtensions   map[string]bool
	invisibleUnicodes  []rune
	maxFileCount       int
	maxTotalSizeKB     int
	maxSingleFileSizeKB int
}

func NewSkillsGuardService() *SkillsGuardService {
	svc := &SkillsGuardService{
		maxFileCount:        50,
		maxTotalSizeKB:      1024,
		maxSingleFileSizeKB: 256,
		binaryExtensions: map[string]bool{
			".exe": true, ".dll": true, ".so": true, ".dylib": true,
			".bin": true, ".dat": true, ".com": true, ".msi": true,
			".dmg": true, ".app": true, ".deb": true, ".rpm": true,
		},
		invisibleUnicodes: []rune{
			'\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
			'\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
			'\u2060', '\u2061', '\u2062', '\u2063', '\u2064',
			'\uFEFF', '\u00AD',
		},
	}

	svc.patterns = svc.buildPatterns()
	return svc
}

func (s *SkillsGuardService) buildPatterns() []threatPattern {
	raw := []struct {
		id, severity, category, pattern, desc string
	}{
		// ── exfiltration ────────────────────────────────────────────────
		{"exfil-curl-post", "high", "exfiltration", `curl\s+.*-X\s*POST`, "curl POST exfiltration"},
		{"exfil-curl-data", "high", "exfiltration", `curl\s+.*(-d|--data)`, "curl data exfiltration"},
		{"exfil-wget-post", "high", "exfiltration", `wget\s+.*--post`, "wget POST exfiltration"},
		{"exfil-env-dump", "high", "exfiltration", `env\s*\|`, "environment variable dump"},
		{"exfil-sendmail", "high", "exfiltration", `sendmail\s`, "sendmail exfiltration"},
		{"exfil-nc-send", "high", "exfiltration", `nc\s+.*\d+\s*<`, "netcat data exfiltration"},
		{"exfil-curl-upload", "high", "exfiltration", `curl\s+.*-F\s`, "curl file upload exfiltration"},

		// ── injection ──────────────────────────────────────────────────
		{"inject-role-override", "critical", "injection", `(?i)you\s+are\s+now`, "prompt role override"},
		{"inject-ignore-prev", "critical", "injection", `(?i)ignore\s+previous\s+instructions`, "prompt injection: ignore previous"},
		{"inject-system-prefix", "critical", "injection", `(?i)^system:`, "raw system prefix injection"},
		{"inject-important-override", "critical", "injection", `(?i)IMPORTANT:.*override`, "IMPORTANT override injection"},
		{"inject-im-start", "critical", "injection", `<\|im_start\|>system`, "ChatML system injection"},
		{"inject-new-instructions", "critical", "injection", `(?i)new\s+instructions:`, "new instructions injection"},

		// ── destructive ────────────────────────────────────────────────
		{"destruct-rm-rf", "critical", "destructive", `rm\s+-rf\s+/`, "recursive root deletion"},
		{"destruct-mkfs", "critical", "destructive", `mkfs\s`, "filesystem format"},
		{"destruct-dd-dev", "critical", "destructive", `dd\s+if=.*of=/dev/`, "raw device overwrite"},
		{"destruct-format-c", "critical", "destructive", `(?i)format\s+C:`, "format C: drive"},
		{"destruct-shred", "critical", "destructive", `shred\s+`, "file shredding"},

		// ── persistence ────────────────────────────────────────────────
		{"persist-crontab", "high", "persistence", `crontab\s`, "crontab modification"},
		{"persist-at-reboot", "high", "persistence", `@reboot`, "reboot persistence"},
		{"persist-rc-local", "high", "persistence", `/etc/rc\.local`, "rc.local persistence"},
		{"persist-launchctl", "high", "persistence", `launchctl\s+load`, "macOS launchctl persistence"},
		{"persist-systemctl", "high", "persistence", `systemctl\s+enable`, "systemd service persistence"},
		{"persist-init-d", "high", "persistence", `/etc/init\.d/`, "init.d persistence"},

		// ── network ────────────────────────────────────────────────────
		{"net-nc-listen", "high", "network", `nc\s+-lp`, "netcat listener"},
		{"net-bash-tcp", "critical", "network", `bash\s+-i\s+>&\s+/dev/tcp/`, "reverse shell via /dev/tcp"},
		{"net-ncat-exec", "high", "network", `ncat\s+--exec`, "ncat command execution"},
		{"net-socat-listen", "high", "network", `socat\s+TCP-LISTEN`, "socat TCP listener"},
		{"net-reverse-shell", "critical", "network", `/dev/(tcp|udp)/`, "reverse shell device"},

		// ── obfuscation ────────────────────────────────────────────────
		{"obfs-base64-pipe-sh", "critical", "obfuscation", `base64\s+-d\s*\|\s*sh`, "base64 decode pipe to shell"},
		{"obfs-eval-base64", "critical", "obfuscation", `eval\(base64`, "eval base64 decoding"},
		{"obfs-printf-hex", "high", "obfuscation", `printf\s+\\\\x`, "printf hex escape obfuscation"},
		{"obfs-exec-compile", "high", "obfuscation", `exec\(compile\(`, "dynamic code compilation"},
		{"obfs-base64-eval", "critical", "obfuscation", `base64.*\|\s*(bash|sh|python|perl)`, "base64 pipe to interpreter"},

		// ── traversal ──────────────────────────────────────────────────
		{"trav-dotdot-slash", "medium", "traversal", `\.\.\/`, "directory traversal ../"},
		{"trav-dotdot-backslash", "medium", "traversal", `\.\.\\`, "directory traversal ..\\"},
		{"trav-encoded-slash", "high", "traversal", `%2e%2e%2f`, "URL-encoded traversal %2e%2e%2f"},
		{"trav-encoded-mixed", "high", "traversal", `%2e%2e/`, "mixed-encoded traversal %2e%2e/"},
		{"trav-deep-path", "medium", "traversal", `(\.\./){3,}`, "deep directory traversal"},

		// ── mining ─────────────────────────────────────────────────────
		{"mine-xmrig", "critical", "mining", `(?i)xmrig`, "XMRig cryptominer"},
		{"mine-stratum", "critical", "mining", `stratum\+tcp://`, "Stratum mining protocol"},
		{"mine-coinhive", "critical", "mining", `(?i)coinhive`, "CoinHive miner"},
		{"mine-cryptonight", "critical", "mining", `(?i)cryptonight`, "CryptoNight algorithm"},
		{"mine-minerd", "critical", "mining", `(?i)minerd`, "minerd cryptominer"},

		// ── supply_chain ───────────────────────────────────────────────
		{"supply-pip-index", "high", "supply_chain", `pip\s+install\s+--index-url`, "custom pip index"},
		{"supply-npm-registry", "high", "supply_chain", `npm\s+install\s+--registry`, "custom npm registry"},
		{"supply-curl-pipe-bash", "critical", "supply_chain", `curl\s+.*\|\s*bash`, "curl pipe to bash"},
		{"supply-wget-pipe-sh", "critical", "supply_chain", `wget\s+.*\|\s*sh`, "wget pipe to shell"},
		{"supply-pip-trusted", "high", "supply_chain", `pip\s+install\s+--trusted-host`, "pip trusted host bypass"},

		// ── execution ──────────────────────────────────────────────────
		{"exec-chmod-x", "medium", "execution", `chmod\s+\+x`, "make file executable"},
		{"exec-dot-slash", "medium", "execution", `\./exec`, "execute local binary"},
		{"exec-subprocess", "medium", "execution", `subprocess\.call\(`, "Python subprocess call"},
		{"exec-os-system", "medium", "execution", `os\.system\(`, "Python os.system call"},
		{"exec-eval-func", "high", "execution", `(?i)\beval\s*\(`, "dynamic eval execution"},

		// ── privilege_escalation ────────────────────────────────────────
		{"priv-sudo", "medium", "privilege_escalation", `\bsudo\b`, "sudo privilege escalation"},
		{"priv-su-dash", "high", "privilege_escalation", `\bsu\s+-`, "su - root switch"},
		{"priv-doas", "high", "privilege_escalation", `\bdoas\b`, "doas privilege escalation"},
		{"priv-pkexec", "high", "privilege_escalation", `\bpkexec\b`, "pkexec privilege escalation"},
		{"priv-setuid", "high", "privilege_escalation", `\bsetuid\b`, "setuid bit manipulation"},

		// ── credential_exposure ─────────────────────────────────────────
		{"cred-password", "high", "credential_exposure", `(?i)password\s*=\s*\S+`, "hardcoded password"},
		{"cred-api-key", "high", "credential_exposure", `(?i)api_key\s*=\s*\S+`, "hardcoded API key"},
		{"cred-aws-key", "critical", "credential_exposure", `AKIA[0-9A-Z]{16}`, "AWS access key ID"},
		{"cred-github-token", "critical", "credential_exposure", `ghp_[a-zA-Z0-9]{36}`, "GitHub personal access token"},
		{"cred-openai-key", "critical", "credential_exposure", `sk-[a-zA-Z0-9]{48}`, "OpenAI API key"},
	}

	patterns := make([]threatPattern, 0, len(raw))
	for _, r := range raw {
		patterns = append(patterns, threatPattern{
			ID:          r.id,
			Severity:    r.severity,
			Category:    r.category,
			Pattern:     regexp.MustCompile(r.pattern),
			Description: r.desc,
		})
	}
	return patterns
}

// ScanContent scans a single skill's content and returns a ScanResult.
// Builtin trust level skills bypass scanning entirely.
func (s *SkillsGuardService) ScanContent(name string, content string, trustLevel domain.TrustLevel) *domain.ScanResult {
	result := &domain.ScanResult{
		SkillName:  name,
		TrustLevel: trustLevel,
		ScannedAt:  time.Now(),
	}

	if trustLevel == domain.TrustLevelBuiltin {
		result.Verdict = domain.ScanVerdictSafe
		result.Summary = "builtin skill — scan skipped"
		return result
	}

	var findings []domain.Finding

	findings = append(findings, s.scanStructural(content)...)
	findings = append(findings, s.scanPatterns(content)...)
	findings = append(findings, s.scanBinaryReferences(content)...)
	findings = append(findings, s.scanInvisibleUnicode(content)...)

	result.Findings = findings
	result.Verdict = s.resolveVerdict(findings)
	result.Summary = s.buildSummary(findings)
	return result
}

func (s *SkillsGuardService) scanStructural(content string) []domain.Finding {
	var findings []domain.Finding

	sizeKB := len(content) / 1024
	if sizeKB > s.maxSingleFileSizeKB {
		findings = append(findings, domain.Finding{
			PatternID:   "struct-single-file-size",
			Severity:    "medium",
			Category:    "structural",
			Description: fmt.Sprintf("content size %dKB exceeds single file limit %dKB", sizeKB, s.maxSingleFileSizeKB),
		})
	}

	if sizeKB > s.maxTotalSizeKB {
		findings = append(findings, domain.Finding{
			PatternID:   "struct-total-size",
			Severity:    "high",
			Category:    "structural",
			Description: fmt.Sprintf("content size %dKB exceeds total size limit %dKB", sizeKB, s.maxTotalSizeKB),
		})
	}

	lineCount := strings.Count(content, "\n") + 1
	if lineCount > s.maxFileCount*100 {
		findings = append(findings, domain.Finding{
			PatternID:   "struct-file-count",
			Severity:    "high",
			Category:    "structural",
			Description: fmt.Sprintf("estimated content density (%d lines) suggests exceeding file count limit %d", lineCount, s.maxFileCount),
		})
	}

	return findings
}

func (s *SkillsGuardService) scanPatterns(content string) []domain.Finding {
	var findings []domain.Finding

	lines := strings.Split(content, "\n")
	for i, line := range lines {
		for _, tp := range s.patterns {
			if tp.Pattern.MatchString(line) {
				match := tp.Pattern.FindString(line)
				if len(match) > 120 {
					match = match[:120] + "…"
				}

				findings = append(findings, domain.Finding{
					PatternID:   tp.ID,
					Severity:    tp.Severity,
					Category:    tp.Category,
					File:        "SKILL.md",
					Line:        i + 1,
					Match:       match,
					Description: tp.Description,
				})
			}
		}
	}

	return findings
}

func (s *SkillsGuardService) scanBinaryReferences(content string) []domain.Finding {
	var findings []domain.Finding

	for ext := range s.binaryExtensions {
		pattern := regexp.MustCompile(`(?i)\S+` + regexp.QuoteMeta(ext) + `\b`)
		matches := pattern.FindAllString(content, -1)
		for _, m := range matches {
			findings = append(findings, domain.Finding{
				PatternID:   "binary-ref-" + strings.TrimPrefix(ext, "."),
				Severity:    "critical",
				Category:    "execution",
				File:        "SKILL.md",
				Match:       m,
				Description: fmt.Sprintf("binary file reference (%s)", ext),
			})
		}
	}

	return findings
}

func (s *SkillsGuardService) scanInvisibleUnicode(content string) []domain.Finding {
	var findings []domain.Finding

	invisibleSet := make(map[rune]bool, len(s.invisibleUnicodes))
	for _, r := range s.invisibleUnicodes {
		invisibleSet[r] = true
	}

	lines := strings.Split(content, "\n")
	for i, line := range lines {
		for _, r := range line {
			if invisibleSet[r] {
				findings = append(findings, domain.Finding{
					PatternID:   fmt.Sprintf("unicode-invisible-U+%04X", r),
					Severity:    "high",
					Category:    "obfuscation",
					File:        "SKILL.md",
					Line:        i + 1,
					Match:       fmt.Sprintf("U+%04X", r),
					Description: "invisible Unicode character detected",
				})
			}
		}
	}

	return findings
}

func (s *SkillsGuardService) resolveVerdict(findings []domain.Finding) domain.ScanVerdict {
	for _, f := range findings {
		if f.Severity == "critical" {
			return domain.ScanVerdictDangerous
		}
	}

	for _, f := range findings {
		if f.Severity == "high" {
			return domain.ScanVerdictCaution
		}
	}

	if len(findings) > 0 {
		return domain.ScanVerdictCaution
	}

	return domain.ScanVerdictSafe
}

func (s *SkillsGuardService) buildSummary(findings []domain.Finding) string {
	if len(findings) == 0 {
		return "no threats detected"
	}

	counts := map[string]int{}
	for _, f := range findings {
		counts[f.Severity]++
	}

	parts := make([]string, 0, len(counts))
	for _, sev := range []string{"critical", "high", "medium", "low"} {
		if c, ok := counts[sev]; ok {
			parts = append(parts, fmt.Sprintf("%d %s", c, sev))
		}
	}

	return fmt.Sprintf("%d findings: %s", len(findings), strings.Join(parts, ", "))
}

// FormatScanReport produces a human-readable security scan report.
func (s *SkillsGuardService) FormatScanReport(result *domain.ScanResult) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("=== Skills Guard Scan Report ===\n"))
	sb.WriteString(fmt.Sprintf("Skill:      %s\n", result.SkillName))
	sb.WriteString(fmt.Sprintf("Trust:      %s\n", result.TrustLevel))
	sb.WriteString(fmt.Sprintf("Verdict:    %s\n", result.Verdict))
	sb.WriteString(fmt.Sprintf("Scanned:    %s\n", result.ScannedAt.Format(time.RFC3339)))
	sb.WriteString(fmt.Sprintf("Summary:    %s\n", result.Summary))

	if len(result.Findings) == 0 {
		sb.WriteString("\nNo findings.\n")
		return sb.String()
	}

	sb.WriteString(fmt.Sprintf("\nFindings (%d):\n", len(result.Findings)))
	for i, f := range result.Findings {
		sb.WriteString(fmt.Sprintf("  [%d] %-8s %-20s %s\n", i+1, f.Severity, f.Category, f.PatternID))

		if f.File != "" {
			sb.WriteString(fmt.Sprintf("       file: %s, line: %d\n", f.File, f.Line))
		}
		if f.Match != "" {
			sb.WriteString(fmt.Sprintf("       match: %s\n", f.Match))
		}

		sb.WriteString(fmt.Sprintf("       desc:  %s\n", f.Description))
	}

	return sb.String()
}
