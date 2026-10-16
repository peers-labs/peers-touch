package domain

import (
	"strings"
	"time"
)

type State int32

const (
	StateUnspecified State = 0
	StateDraft       State = 1
	StateActive      State = 2
	StateDisabled    State = 3
	StateRevoked     State = 4
)

const MaxNameLen = 100

// Bot stores only product metadata. Authentication, targets, rate limits, and
// message delivery are owned by its generic publishing grant.
type Bot struct {
	BotPtid      string
	OwnerPtid    string
	PublishingID string
	Name         string
	State        State
	CreatedAt    time.Time
	DisabledAt   *time.Time
	RevokedAt    *time.Time
}

func NewActive(
	botPtid string,
	ownerPtid string,
	publishingID string,
	name string,
	now time.Time,
) (*Bot, error) {
	if botPtid == "" || ownerPtid == "" || publishingID == "" {
		return nil, NewError(CodeInvalidArgument, "bot, owner, and publishing identities are required")
	}
	if err := ValidateName(name); err != nil {
		return nil, err
	}
	return &Bot{
		BotPtid:      botPtid,
		OwnerPtid:    ownerPtid,
		PublishingID: publishingID,
		Name:         strings.TrimSpace(name),
		State:        StateActive,
		CreatedAt:    now.UTC(),
	}, nil
}

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

func (b *Bot) Disable(now time.Time) error {
	if b.State != StateActive {
		return NewError(CodeStateConflict, "only an active bot can be disabled")
	}
	b.State = StateDisabled
	at := now.UTC()
	b.DisabledAt = &at
	return nil
}

func (b *Bot) Enable(_ time.Time) error {
	if b.State != StateDisabled {
		return NewError(CodeStateConflict, "only a disabled bot can be enabled")
	}
	b.State = StateActive
	b.DisabledAt = nil
	return nil
}

func (b *Bot) Revoke(now time.Time) error {
	if b.State == StateRevoked {
		return NewError(CodeStateConflict, "bot is already revoked")
	}
	b.State = StateRevoked
	at := now.UTC()
	b.RevokedAt = &at
	b.DisabledAt = nil
	return nil
}

func (b *Bot) Owns(actorPtid string) bool {
	return b.OwnerPtid == actorPtid
}
