package domain

import (
	"strings"
	"time"
)

// State is the bot registry lifecycle state.
type State int32

const (
	StateUnspecified State = 0
	StateDraft       State = 1
	StateActive      State = 2
	StateDisabled    State = 3
	StateRevoked     State = 4
)

// DeliveryScope is the recipient scope. v1 is owner-only; broader scopes are
// reserved and must never be accepted from a create request.
type DeliveryScope int32

const (
	ScopeUnspecified DeliveryScope = 0
	ScopeOwnerOnly   DeliveryScope = 1
)

// DefaultRateLimitPerMinute is the per-bot token-bucket default (G-BOT-07).
const DefaultRateLimitPerMinute = 120

// MaxNameLen bounds a bot display name at the edge.
const MaxNameLen = 100

// Bot is the registry aggregate root. It owns lifecycle transitions but not
// the actor PTID minting (an application-port responsibility).
type Bot struct {
	BotPtid         string
	OwnerPtid       string
	Name            string
	State           State
	WebhookID       string
	SecretHash      string
	SecretHint      string
	SecretDelivered bool
	DeliveryScope   DeliveryScope
	RateLimitPerMin int32
	CreatedAt       time.Time
	DisabledAt      *time.Time
	RevokedAt       *time.Time
}

// NewActive constructs a freshly created, active bot with a minted webhook id
// and the hash of a one-time plaintext secret. The caller supplies the
// plaintext so the application layer can return it exactly once.
func NewActive(
	botPtid, ownerPtid, name, webhookID, secretPlaintext string,
	now time.Time,
) (*Bot, error) {
	name = strings.TrimSpace(name)
	if botPtid == "" || ownerPtid == "" {
		return nil, NewError(CodeInvalidArgument, "bot and owner identity are required")
	}
	if webhookID == "" {
		return nil, NewError(CodeInvalidArgument, "webhook id is required")
	}
	if err := ValidateName(name); err != nil {
		return nil, err
	}
	if secretPlaintext == "" {
		return nil, NewError(CodeSecretNotSet, "a secret must be provisioned on creation")
	}
	return &Bot{
		BotPtid:         botPtid,
		OwnerPtid:       ownerPtid,
		Name:            name,
		State:           StateActive,
		WebhookID:       webhookID,
		SecretHash:      HashSecret(secretPlaintext),
		SecretHint:      SecretHint(secretPlaintext),
		SecretDelivered: false,
		CreatedAt:       now,
		DeliveryScope:   ScopeOwnerOnly,
		RateLimitPerMin: DefaultRateLimitPerMinute,
	}, nil
}

// ValidateName enforces a non-empty, bounded, trimmed display name.
func ValidateName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return NewError(CodeInvalidArgument, "bot name is required")
	}
	if len([]rune(name)) > MaxNameLen {
		return NewError(CodeInvalidArgument, "bot name exceeds %d characters", MaxNameLen)
	}
	return nil
}

// ReplaceSecret rotates the secret while leaving webhook id and history
// intact. Allowed only while the bot has not been revoked.
func (b *Bot) ReplaceSecret(plaintext string, now time.Time) error {
	if b.State == StateRevoked {
		return NewError(CodeStateConflict, "cannot rotate secret for a revoked bot")
	}
	if plaintext == "" {
		return NewError(CodeSecretNotSet, "new secret cannot be empty")
	}
	b.SecretHash = HashSecret(plaintext)
	b.SecretHint = SecretHint(plaintext)
	b.SecretDelivered = false
	return nil
}

// MarkSecretDelivered flips the one-time-read flag once plaintext is handed
// to the owner.
func (b *Bot) MarkSecretDelivered() { b.SecretDelivered = true }

// Disable pauses ingestion immediately; only an active bot can be disabled.
func (b *Bot) Disable(now time.Time) error {
	if b.State != StateActive {
		return NewError(CodeStateConflict, "only an active bot can be disabled (current=%d)", b.State)
	}
	b.State = StateDisabled
	b.DisabledAt = &now
	return nil
}

// Enable resumes a disabled bot.
func (b *Bot) Enable(now time.Time) error {
	if b.State != StateDisabled {
		return NewError(CodeStateConflict, "only a disabled bot can be enabled (current=%d)", b.State)
	}
	b.State = StateActive
	b.DisabledAt = nil
	return nil
}

// Revoke permanently retires a bot: the secret hash is cleared so no secret
// can ever authenticate again, while bot row and conversation history remain.
func (b *Bot) Revoke(now time.Time) error {
	if b.State == StateRevoked {
		return NewError(CodeStateConflict, "bot is already revoked")
	}
	b.State = StateRevoked
	b.RevokedAt = &now
	b.SecretHash = ""
	b.DisabledAt = nil
	return nil
}

// CanIngest reports whether the webhook edge may accept events right now.
// Disabled/revoked are rejected immediately by the next request (BOT-A04B).
func (b *Bot) CanIngest() bool { return b.State == StateActive }

// Owns reports whether the given actor owns this bot.
func (b *Bot) Owns(actorPtid string) bool { return b.OwnerPtid == actorPtid }
