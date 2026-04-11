package domain

import "time"

type RotationStrategy string

const (
	RotationFillFirst  RotationStrategy = "fill_first"
	RotationRoundRobin RotationStrategy = "round_robin"
	RotationRandom     RotationStrategy = "random"
	RotationLeastUsed  RotationStrategy = "least_used"
)

type CredentialStatus string

const (
	CredentialStatusActive    CredentialStatus = "active"
	CredentialStatusExhausted CredentialStatus = "exhausted"
	CredentialStatusError     CredentialStatus = "error"
)

type AuthType string

const (
	AuthTypeAPIKey AuthType = "api_key"
	AuthTypeOAuth  AuthType = "oauth"
)

type CredentialSource string

const (
	CredentialSourceEnv       CredentialSource = "env"
	CredentialSourceAuthStore CredentialSource = "auth_store"
	CredentialSourceConfig    CredentialSource = "config"
)

const ExhaustedCooldownDuration = time.Hour

type CredentialEntry struct {
	CredentialID     string
	Provider         string
	Label            string
	AuthType         AuthType
	Priority         int
	Source           CredentialSource
	Status           CredentialStatus
	RequestCount     int
	RotationStrategy RotationStrategy
	ExhaustedAt      *time.Time
	CooldownUntil    *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (c *CredentialEntry) IsAvailable(now time.Time) bool {
	if c.Status == CredentialStatusActive {
		return true
	}
	if c.Status == CredentialStatusExhausted && c.CooldownUntil != nil && now.After(*c.CooldownUntil) {
		return true
	}
	return false
}
