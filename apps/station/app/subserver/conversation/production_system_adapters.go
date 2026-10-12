package conversation

import (
	"context"
	"strings"
	"time"

	botpersistence "github.com/peers-labs/peers-touch/station/app/subserver/bot/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	notificationinfra "github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	"gorm.io/gorm"
)

// productionSystemGrant is the transaction-scoped implementation of both
// ports.SystemSenderAuthorization and ports.SystemDirectories. It reaches the
// bot tables over the exact authority transaction, so grant bookkeeping and
// the conversation event commit or roll back together.
type productionSystemGrant struct {
	store *botpersistence.SystemStore
}

func (g *productionSystemGrant) AuthorizeSystemMessage(
	ctx context.Context,
	bot valueobject.PTID,
	owner valueobject.PTID,
	conversation valueobject.ConversationID,
) error {
	if err := g.store.Authorize(ctx, string(bot), string(owner), string(conversation)); err != nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"production_system.authorize",
			"grant",
			err.Error(),
		)
	}
	return nil
}

func (g *productionSystemGrant) EnsureSystemGrant(
	ctx context.Context,
	bot valueobject.PTID,
	owner valueobject.PTID,
	conversation valueobject.ConversationID,
	at time.Time,
) error {
	return g.store.EnsureActiveGrant(
		ctx,
		string(bot),
		string(owner),
		string(conversation),
		at,
	)
}

func (g *productionSystemGrant) LoadIngestion(
	ctx context.Context,
	bot valueobject.PTID,
	requestID string,
	now time.Time,
) (string, bool, error) {
	return g.store.LoadIngestion(ctx, string(bot), requestID, now)
}

func (g *productionSystemGrant) RecordIngestion(
	ctx context.Context,
	bot valueobject.PTID,
	requestID string,
	eventID string,
	at time.Time,
) error {
	return g.store.RecordIngestion(ctx, string(bot), requestID, eventID, at)
}

type productionServiceNotifications struct {
	producer *notificationinfra.TxProducer
}

func (n *productionServiceNotifications) ProduceInTx(
	ctx context.Context,
	input ports.ServiceNotificationInput,
	at time.Time,
) (bool, error) {
	return n.producer.ProduceInTx(ctx, notificationinfra.TxInput{
		RecipientPTID:  input.RecipientPTID,
		ActorPTID:      input.ActorPTID,
		Type:           input.Type,
		Category:       input.Category,
		TargetType:     input.TargetType,
		TargetID:       input.TargetID,
		Title:          input.Title,
		Body:           input.Body,
		GroupKey:       input.GroupKey,
		IdempotencyKey: input.IdempotencyKey,
		Metadata:       input.Metadata,
	}, at)
}

// productionLocalScope resolves the Station's own active Federation for
// internal system conversations. v1 admits exactly one home-local federation;
// a missing or ambiguous scope is a hard error rather than a guessed id.
type productionLocalScope struct {
	db           *gorm.DB
	localStation valueobject.StationID
}

func (s *productionLocalScope) LocalFederation(
	ctx context.Context,
) (valueobject.FederationID, valueobject.AuthorityEpoch, error) {
	repos := federationinfra.NewRepos(s.db)
	records, err := repos.Federation.ListByStation(ctx, string(s.localStation))
	if err != nil {
		return "", 0, conversationdomain.NewError(
			conversationdomain.ErrorCodeFederationInactive,
			"production_system.local_scope",
			"federation",
			"cannot resolve local federation: "+err.Error(),
		)
	}
	for _, record := range records {
		if strings.EqualFold(record.Status, "active") && record.FederationID != "" {
			return valueobject.FederationID(record.FederationID), valueobject.AuthorityEpoch(1), nil
		}
	}
	return "", 0, conversationdomain.NewError(
		conversationdomain.ErrorCodeFederationInactive,
		"production_system.local_scope",
		"federation",
		"no active local Federation is registered for this Station",
	)
}
