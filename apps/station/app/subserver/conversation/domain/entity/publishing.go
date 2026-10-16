package entity

import (
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// PublishingGrant is the stable Actor delegation. Credentials and defaults
// may change without changing the sender or receipt namespace.
type PublishingGrant struct {
	ID              string
	Owner           valueobject.PTID
	Sender          valueobject.PTID
	Name            string
	SourceNamespace string
	DefaultTarget   valueobject.ConversationID
	AllowedTargets  []valueobject.ConversationID
	SecretHash      string
	SecretHint      string
	Disabled        bool
	Revoked         bool
	CreatedAt       time.Time
	ExpiresAt       *time.Time
	RatePerMinute   uint32
}

func (g PublishingGrant) Active(at time.Time) bool {
	return g.ID != "" && g.Owner != "" && g.Sender != "" &&
		g.SecretHash != "" && !g.Disabled && !g.Revoked &&
		(g.ExpiresAt == nil || at.Before(*g.ExpiresAt))
}

func (g PublishingGrant) Authorize(sender valueobject.PTID, target valueobject.ConversationID, at time.Time) error {
	if g.Active(at) && sender == g.Sender {
		for _, allowed := range g.AllowedTargets {
			if target != "" && target == allowed {
				return nil
			}
		}
	}
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		"publishing.authorize",
		"target",
		"the live delegation does not authorize this sender and target",
	)
}

// PublicationReceipt freezes the first committed result. Its identity is
// independent of credential rotation and message visibility in a renderer.
type PublicationReceipt struct {
	PublishingID  string
	CommandID     string
	RequestHash   valueobject.Hash
	Sender        valueobject.PTID
	Recipient     valueobject.PTID
	Conversation  valueobject.ConversationID
	MessageID     valueobject.MessageID
	EventID       valueobject.EventID
	EventSequence valueobject.Sequence
	CreatedAt     time.Time
}
