package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	agentpersistence "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	botTurnProjectionInterval = time.Second
	botTurnLeaseDuration      = 30 * time.Second
	botTurnBatchSize          = 16
	botTurnMaxInputRunes      = 8000
	botTurnMaxAdmitAttempts   = 3
	botTurnMaxWorkAttempts    = 20
	botTurnConversationPrefix = "botc-"
	botTurnRowPrefix          = "bti-"
	botTurnTitle              = "Bot assistant"
)

// BotBindingView is the enabled-binding projection the bridge needs. The bot
// subserver owns the table; this DTO keeps the agent service independent of
// the bot persistence model.
type BotBindingView struct {
	BotPtid   string
	OwnerPtid string
	AgentID   string
	Enabled   bool
	Version   int64
}

// BotBindingReader is the structural port to the bot subserver.
type BotBindingReader interface {
	ActiveAgentBinding(ctx context.Context, botPTID string) (BotBindingView, bool, error)
}

// BotReplyPublisher is the structural port back to Conversation's generic
// publishing capability. The reply stays authored by the bot actor.
type BotReplyPublisher interface {
	PublishBotReply(
		ctx context.Context,
		publishingID string,
		senderPTID string,
		ownerPTID string,
		conversationID string,
		replyKey string,
		text string,
	) error
}

// BotInboundEvent is the Station-internal projection of an accepted external
// publishing message.
type BotInboundEvent struct {
	PublishingID   string
	SenderPTID     string
	OwnerPTID      string
	ConversationID string
	MessageID      string
	Text           string
}

// BotTurnBridge durably projects inbound bot publications into Agent turns and
// republishes completed turns as bot-authored replies. Every transition is
// persisted, so process restarts resume in-flight rows; the binding is
// re-checked at each transition so unbinding stops replies immediately.
type BotTurnBridge struct {
	db         *gorm.DB
	executor   channelsvc.TurnExecutor
	bindings   BotBindingReader
	replies    BotReplyPublisher
	now        func() time.Time
	workerOnce sync.Once
}

func NewBotTurnBridge(
	db *gorm.DB,
	executor channelsvc.TurnExecutor,
	bindings BotBindingReader,
	replies BotReplyPublisher,
) *BotTurnBridge {
	return &BotTurnBridge{
		db:       db,
		executor: executor,
		bindings: bindings,
		replies:  replies,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// OnInboundPublished durably enqueues one inbound message when its bot has an
// enabled Agent binding. Unbound and paused bots stay receive-only, which is
// the default safe state.
func (b *BotTurnBridge) OnInboundPublished(
	ctx context.Context,
	event BotInboundEvent,
) error {
	if b == nil || b.db == nil || b.bindings == nil {
		return nil
	}
	event.PublishingID = strings.TrimSpace(event.PublishingID)
	event.SenderPTID = strings.TrimSpace(event.SenderPTID)
	event.OwnerPTID = strings.TrimSpace(event.OwnerPTID)
	event.ConversationID = strings.TrimSpace(event.ConversationID)
	event.MessageID = strings.TrimSpace(event.MessageID)
	if event.PublishingID == "" || event.SenderPTID == "" || event.OwnerPTID == "" ||
		event.ConversationID == "" || event.MessageID == "" {
		return errors.New("bot inbound event is missing required identity")
	}
	binding, found, err := b.bindings.ActiveAgentBinding(ctx, event.SenderPTID)
	if err != nil || !found {
		return err
	}
	if binding.OwnerPtid != event.OwnerPTID {
		return errors.New("bot binding owner does not match the inbound recipient")
	}
	text := event.Text
	if runes := []rune(text); len(runes) > botTurnMaxInputRunes {
		text = string(runes[:botTurnMaxInputRunes])
	}
	if strings.TrimSpace(text) == "" {
		return nil
	}
	now := b.now()
	row := &agentpersistence.BotInboundTurn{
		ID:                   botTurnRowID(event.MessageID),
		PublishingID:         event.PublishingID,
		BotPtid:              binding.BotPtid,
		OwnerPtid:            binding.OwnerPtid,
		AgentID:              binding.AgentID,
		DirectConversationID: event.ConversationID,
		AgentConversationID:  botAgentConversationID(binding.BotPtid),
		AdmissionKey:         "bot-admit:" + botTurnRowID(event.MessageID),
		UserInput:            text,
		Status:               agentpersistence.BotInboundStatusQueued,
		ReceivedAt:           now,
		UpdatedAt:            now,
	}
	// Idempotent projection: a retried ingress (HTTP replay) must not admit a
	// second turn for the same message, and re-delivery must never reset a
	// row that already projected.
	return b.db.WithContext(ctx).
		Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).
		Create(row).Error
}

// StartProjectionWorker runs the durable projection loop once per process.
func (b *BotTurnBridge) StartProjectionWorker(ctx context.Context) bool {
	if b == nil || b.db == nil || b.executor == nil || b.replies == nil {
		return false
	}
	started := false
	b.workerOnce.Do(func() {
		started = true
		go b.runLoop(ctx)
	})
	return started
}

func (b *BotTurnBridge) runLoop(ctx context.Context) {
	ticker := time.NewTicker(botTurnProjectionInterval)
	defer ticker.Stop()
	b.projectPending(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.projectPending(ctx)
		}
	}
}

func (b *BotTurnBridge) projectPending(ctx context.Context) {
	var rows []agentpersistence.BotInboundTurn
	if err := b.db.WithContext(ctx).
		Where(
			"status IN ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
			[]string{
				agentpersistence.BotInboundStatusQueued,
				agentpersistence.BotInboundStatusAdmitted,
				agentpersistence.BotInboundStatusProcessing,
			},
			b.now(),
		).
		Order("received_at ASC").
		Limit(botTurnBatchSize).
		Find(&rows).Error; err != nil {
		return
	}
	for i := range rows {
		b.advance(ctx, &rows[i])
	}
}

func (b *BotTurnBridge) advance(
	ctx context.Context,
	row *agentpersistence.BotInboundTurn,
) {
	now := b.now()
	token := botTurnLeaseToken(row.ID, now)
	claim := b.db.WithContext(ctx).
		Model(&agentpersistence.BotInboundTurn{}).
		Where(
			"id = ? AND (lease_token = '' OR lease_token IS NULL) AND "+
				"(lease_expires_at IS NULL OR lease_expires_at < ?)",
			row.ID,
			now,
		).
		Updates(map[string]any{
			"lease_token":      token,
			"lease_expires_at": now.Add(botTurnLeaseDuration),
			"updated_at":       now,
		})
	if claim.Error != nil || claim.RowsAffected != 1 {
		return
	}
	// Re-select by the unique lease token: when several Station processes
	// race an expired lease, only the writer whose token persisted proceeds.
	var leased agentpersistence.BotInboundTurn
	if err := b.db.WithContext(ctx).
		Where("id = ? AND lease_token = ?", row.ID, token).
		First(&leased).Error; err != nil {
		return
	}

	next, terminal, err := b.transition(ctx, &leased, now)
	updates := map[string]any{
		"updated_at":       b.now(),
		"lease_token":      "",
		"lease_expires_at": nil,
	}
	switch {
	case err != nil && terminal:
		updates["status"] = agentpersistence.BotInboundStatusFailed
		updates["last_error"] = botTurnErrorText(err)
		updates["attempts"] = gorm.Expr("attempts + 1")
	case err != nil:
		updates["status"] = next.Status
		updates["last_error"] = botTurnErrorText(err)
		updates["attempts"] = gorm.Expr("attempts + 1")
		if leased.Attempts+1 >= botTurnMaxWorkAttempts {
			updates["status"] = agentpersistence.BotInboundStatusFailed
		}
	default:
		updates["status"] = next.Status
		updates["last_error"] = ""
		if next.TurnID != "" {
			updates["turn_id"] = next.TurnID
		}
		if next.Status == agentpersistence.BotInboundStatusDelivered ||
			next.Status == agentpersistence.BotInboundStatusNoReply {
			updates["delivered_at"] = b.now()
		}
	}
	result := b.db.WithContext(ctx).
		Model(&agentpersistence.BotInboundTurn{}).
		Where("id = ? AND lease_token = ?", row.ID, token).
		Updates(updates)
	if result.Error != nil {
		logger.Errorf(ctx, "[bot-turn] persist projection transition failed: %v", result.Error)
	}
}

type botTurnTransition struct {
	Status string
	TurnID string
}

func (b *BotTurnBridge) transition(
	ctx context.Context,
	row *agentpersistence.BotInboundTurn,
	_ time.Time,
) (botTurnTransition, bool, error) {
	// Re-check the binding on every transition: removing or pausing the
	// binding cancels both queued and in-flight projections.
	binding, found, err := b.bindings.ActiveAgentBinding(ctx, row.BotPtid)
	if err != nil {
		return botTurnTransition{Status: row.Status}, false, err
	}
	if !found || binding.AgentID != row.AgentID || binding.OwnerPtid != row.OwnerPtid {
		return botTurnTransition{Status: agentpersistence.BotInboundStatusCancelled}, true, nil
	}

	if row.Status == agentpersistence.BotInboundStatusQueued {
		return b.admit(ctx, row)
	}
	return b.projectSnapshot(ctx, row)
}

func (b *BotTurnBridge) admit(
	ctx context.Context,
	row *agentpersistence.BotInboundTurn,
) (botTurnTransition, bool, error) {
	if err := b.executor.EnsureConversation(
		ctx,
		row.OwnerPtid,
		row.AgentID,
		row.AgentConversationID,
		botTurnTitle,
	); err != nil {
		return botTurnTransition{Status: row.Status}, row.Attempts+1 >= botTurnMaxAdmitAttempts, err
	}
	admission, err := b.executor.AdmitTurn(ctx, channelsvc.TurnAdmissionInput{
		ActorPTID:      row.OwnerPtid,
		AgentID:        row.AgentID,
		ConversationID: row.AgentConversationID,
		Title:          botTurnTitle,
		UserInput:      row.UserInput,
		IdempotencyKey: row.AdmissionKey,
	})
	if err != nil {
		return botTurnTransition{Status: row.Status}, row.Attempts+1 >= botTurnMaxAdmitAttempts, err
	}
	status := agentpersistence.BotInboundStatusAdmitted
	if admission.Status == "queued" {
		status = agentpersistence.BotInboundStatusQueued
	}
	return botTurnTransition{Status: status, TurnID: admission.TurnID}, false, nil
}

func (b *BotTurnBridge) projectSnapshot(
	ctx context.Context,
	row *agentpersistence.BotInboundTurn,
) (botTurnTransition, bool, error) {
	turnID := row.TurnID
	if turnID == "" {
		resolved, err := b.executor.ResolveAdmission(
			ctx, row.OwnerPtid, row.AgentConversationID, row.AdmissionKey,
		)
		if err != nil {
			return botTurnTransition{Status: row.Status}, false, err
		}
		if resolved.TurnID == "" {
			return botTurnTransition{Status: agentpersistence.BotInboundStatusAdmitted}, false, nil
		}
		turnID = resolved.TurnID
	}
	snapshot, err := b.executor.Snapshot(
		ctx, row.OwnerPtid, row.AgentConversationID, turnID,
	)
	if err != nil {
		return botTurnTransition{Status: row.Status, TurnID: turnID}, false, err
	}
	if !botTurnTerminal(snapshot.Status) {
		return botTurnTransition{
			Status: agentpersistence.BotInboundStatusProcessing,
			TurnID: turnID,
		}, false, nil
	}
	if strings.ToLower(strings.TrimSpace(snapshot.Status)) != "completed" {
		reason := strings.TrimSpace(snapshot.TerminalReason)
		if reason == "" {
			reason = "turn_" + snapshot.Status
		}
		return botTurnTransition{Status: row.Status, TurnID: turnID}, true, errors.New(reason)
	}
	text := strings.TrimSpace(snapshot.Text)
	if text == "" {
		return botTurnTransition{
			Status: agentpersistence.BotInboundStatusNoReply,
			TurnID: turnID,
		}, true, nil
	}
	if err := b.replies.PublishBotReply(
		ctx,
		row.PublishingID,
		row.BotPtid,
		row.OwnerPtid,
		row.DirectConversationID,
		row.ID,
		text,
	); err != nil {
		return botTurnTransition{Status: row.Status, TurnID: turnID}, false, err
	}
	return botTurnTransition{
		Status: agentpersistence.BotInboundStatusDelivered,
		TurnID: turnID,
	}, true, nil
}

func botTurnTerminal(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "failed", "cancelled", "interrupted":
		return true
	default:
		return false
	}
}

func botTurnErrorText(err error) string {
	text := strings.TrimSpace(err.Error())
	if runes := []rune(text); len(runes) > 1000 {
		return string(runes[:1000])
	}
	return text
}

func botAgentConversationID(botPTID string) string {
	sum := sha256.Sum256([]byte("peers-touch/bot-agent-conversation:" + botPTID))
	return botTurnConversationPrefix + hex.EncodeToString(sum[:16])
}

func botTurnRowID(messageID string) string {
	sum := sha256.Sum256([]byte(messageID))
	return botTurnRowPrefix + hex.EncodeToString(sum[:24])
}

func botTurnLeaseToken(rowID string, now time.Time) string {
	sum := sha256.Sum256([]byte(rowID + now.UTC().Format(time.RFC3339Nano)))
	return hex.EncodeToString(sum[:16])
}
