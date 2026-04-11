package domain

import "time"

type TrustLevel string

const (
	TrustLevelBuiltin   TrustLevel = "builtin"
	TrustLevelTrusted   TrustLevel = "trusted"
	TrustLevelCommunity TrustLevel = "community"
)

type ScanVerdict string

const (
	ScanVerdictSafe      ScanVerdict = "safe"
	ScanVerdictCaution   ScanVerdict = "caution"
	ScanVerdictDangerous ScanVerdict = "dangerous"
)

type InstallPolicy string

const (
	InstallPolicyAllow InstallPolicy = "allow"
	InstallPolicyAsk   InstallPolicy = "ask"
	InstallPolicyBlock InstallPolicy = "block"
)

type SkillManifest struct {
	SkillID     string
	AgentID     string
	Name        string
	Description string
	Category    string
	Platforms   []string
	Conditions  *SkillConditions
	Content     string
	Source      string
	TrustLevel  TrustLevel
	ScanVerdict ScanVerdict
	Enabled     bool
	Version     int
	ViewCount   int
	ApplyCount  int
	PatchCount  int
	LastUsedAt  *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type SkillConditions struct {
	FallbackForToolsets []string
	RequiresTools       []string
}

type Finding struct {
	PatternID   string
	Severity    string
	Category    string
	File        string
	Line        int
	Match       string
	Description string
}

type ScanResult struct {
	SkillName  string
	Source     string
	TrustLevel TrustLevel
	Verdict    ScanVerdict
	Findings   []Finding
	ScannedAt  time.Time
	Summary    string
}

func ResolveInstallPolicy(trust TrustLevel, verdict ScanVerdict) InstallPolicy {
	matrix := map[TrustLevel]map[ScanVerdict]InstallPolicy{
		TrustLevelBuiltin: {
			ScanVerdictSafe: InstallPolicyAllow, ScanVerdictCaution: InstallPolicyAllow, ScanVerdictDangerous: InstallPolicyAllow,
		},
		TrustLevelTrusted: {
			ScanVerdictSafe: InstallPolicyAllow, ScanVerdictCaution: InstallPolicyAllow, ScanVerdictDangerous: InstallPolicyAsk,
		},
		TrustLevelCommunity: {
			ScanVerdictSafe: InstallPolicyAllow, ScanVerdictCaution: InstallPolicyAsk, ScanVerdictDangerous: InstallPolicyBlock,
		},
	}

	if m, ok := matrix[trust]; ok {
		if p, ok := m[verdict]; ok {
			return p
		}
	}
	return InstallPolicyBlock
}
