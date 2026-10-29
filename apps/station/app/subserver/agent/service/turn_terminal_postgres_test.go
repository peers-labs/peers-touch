package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Reuse the existing PostgreSQL fixture input, with a private schema and
// bounded transactions. This never resets a shared Station database.
func openTerminalPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("NCP_AGENT_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("NCP_AGENT_POSTGRES_DSN is not configured")
	}
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal("open PostgreSQL fixture")
	}
	adminSQL, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = adminSQL.Close() })
	schema := fmt.Sprintf("agent_terminal_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error })
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal("parse PostgreSQL fixture")
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dsn = parsed.String()
	} else {
		dsn += " search_path=" + schema
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal("open isolated PostgreSQL fixture")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&persistence.Agent{}, &persistence.Conversation{}, &persistence.AgentMessage{},
		&persistence.AgentTurn{}, &persistence.TurnAttempt{}, &persistence.TurnEvent{},
		&persistence.TurnQueueEntry{},
	); err != nil {
		t.Fatal(err)
	}
	migrateActorSessionLiveness(t, db)
	injectOrchestrationServiceTestStore(t, db)
	return db
}

func TestPostgresCancellationSerializesToolProjection(t *testing.T) {
	db := openTerminalPostgres(t)
	fixture := newToolDispatchFixtureWithDB(t, db)
	proposal := fixture.authorizedProposal(t, "terminal-lock-order",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY, true)
	fixture.seedTurnAuthority(t, proposal)
	user := persistence.AgentMessage{
		ID: "admitted_user", ConversationID: proposal.ConversationID,
		TurnID: optionalString(proposal.TurnID), Role: "user", Status: "completed", Seq: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&persistence.Conversation{}).Where("id = ?", proposal.ConversationID).
		Update("active_branch_message_id", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	// This barrier observes the projection's first turn lock. In the unfixed
	// path it occurs after the conversation write, creating the lock cycle.
	reachedTurn := make(chan struct{})
	var signal sync.Once
	callback := "test:projection-turn-lock"
	if err := db.Callback().Query().Before("gorm:query").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "agent_turns" && tx.Statement.Context.Value(callback) == true {
			signal.Do(func() { close(reachedTurn) })
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callback) })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	projectionDone := make(chan error, 1)
	cancellationErr := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var turn persistence.AgentTurn
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&turn, "id = ?", proposal.TurnID).Error; err != nil {
			return err
		}
		go func() {
			turns := &TurnService{convService: NewConversationService()}
			_, _, err := fixture.service.proposeAuthorizedBatchWithProjection(
				context.WithValue(ctx, callback, true), proposal, func(projection *gorm.DB) error {
					return turns.persistToolCallProjectionTx(projection, &TurnConfig{
						ConversationID: proposal.ConversationID, AgentID: proposal.AgentID,
						AttemptID: proposal.AttemptID, Model: proposal.Model,
					}, proposal.TurnID, "", nil, []TurnEvent{{Type: "tool_call"}})
				})
			projectionDone <- err
		}()
		select {
		case <-reachedTurn:
		case <-ctx.Done():
			return ctx.Err()
		}
		if err := tx.Model(&turn).Update("status", "cancelled").Error; err != nil {
			return err
		}
		return settleTerminalAssistantMessageTx(ctx, tx, turn.ID, turn.ConversationID,
			string(domain.TurnStatusCancelled), []string{"pending"}, nil, fixture.now)
	})
	if cancellationErr != nil {
		t.Fatalf("cancellation failed under tool projection contention: %v", cancellationErr)
	}
	select {
	case err := <-projectionDone:
		var terminal *errcode.BizError
		if !errors.As(err, &terminal) || terminal.Code != errcode.AgentLifecycleTerminalMutation {
			t.Fatalf("late projection did not observe the terminal fence: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("tool projection did not release after cancellation")
	}
	var assistants []persistence.AgentMessage
	if err := db.Where("turn_id = ? AND role = ?", proposal.TurnID, "assistant").Find(&assistants).Error; err != nil {
		t.Fatal(err)
	}
	if len(assistants) != 1 || assistants[0].Status != "cancelled" ||
		revisionStringValue(assistants[0].ParentMessageID) != user.ID {
		t.Fatalf("terminal history did not converge once: %+v", assistants)
	}
	var batches int64
	if err := db.Model(&persistence.ToolBatch{}).Count(&batches).Error; err != nil {
		t.Fatal(err)
	}
	if batches != 0 {
		t.Fatalf("late projection persisted %d tool batches", batches)
	}
}
