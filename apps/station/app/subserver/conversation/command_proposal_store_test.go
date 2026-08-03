package conversation

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/gorm"
)

func TestCommandProposalResultAndInboxRollbackTogether(t *testing.T) {
	subserver, proposal, _ := newHomeProposalFixture(t)
	ctx := context.Background()
	record, created, err := subserver.proposalStore.accept(ctx, proposal)
	if err != nil || !created {
		t.Fatalf("accept proposal: created=%v err=%v", created, err)
	}
	if err := subserver.db.Exec(`
		CREATE TRIGGER fail_command_result_inbox
		BEFORE INSERT ON envelope_inbox
		BEGIN
			SELECT RAISE(FAIL, 'injected inbox failure');
		END
	`).Error; err != nil {
		t.Fatal(err)
	}
	_, err = subserver.proposalStore.complete(ctx, proposal, &chat.ConversationCommandProposalResult{
		CommandId: proposal.Command.CommandId,
		Accepted:  true,
	})
	if err == nil {
		t.Fatal("injected inbox failure did not fail completion")
	}
	stored, err := subserver.proposalStore.get(ctx, record.ConversationID, record.CommandID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.State != int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_HOME_ACCEPTED) ||
		len(stored.ResultBytes) != 0 {
		t.Fatalf("proposal result escaped rolled-back transaction: %+v", stored)
	}
	var inboxCount int64
	if err := subserver.db.Table("envelope_inbox").Count(&inboxCount).Error; err != nil {
		t.Fatal(err)
	}
	if inboxCount != 0 {
		t.Fatalf("inbox rows escaped rolled-back transaction: %d", inboxCount)
	}
}

func TestCommandProposalPendingSelectionIsConversationFairAndFIFO(t *testing.T) {
	subserver, _, _ := newHomeProposalFixture(t)
	now := time.Now()
	rows := []*conversationCommandProposalModel{
		pendingProposalRow("noisy", "noisy-1", now.Add(-4*time.Second)),
		pendingProposalRow("noisy", "noisy-2", now.Add(-3*time.Second)),
		pendingProposalRow("noisy", "noisy-3", now.Add(-2*time.Second)),
		pendingProposalRow("quiet", "quiet-1", now.Add(-time.Second)),
	}
	if err := subserver.db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	selected, err := subserver.proposalStore.pending(context.Background(), now, 32)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 {
		t.Fatalf("selected=%d, want one per conversation", len(selected))
	}
	if selected[0].CommandID != "noisy-1" || selected[1].CommandID != "quiet-1" {
		t.Fatalf("selection is not FIFO/fair: %s, %s", selected[0].CommandID, selected[1].CommandID)
	}
}

func TestCommandProposalAdmissionIsBoundedPerConversation(t *testing.T) {
	subserver, proposal, _ := newHomeProposalFixture(t)
	now := time.Now()
	rows := make([]*conversationCommandProposalModel, 0, maxPendingCommandProposalsPerConversation)
	for index := 0; index < maxPendingCommandProposalsPerConversation; index++ {
		rows = append(rows, pendingProposalRow(
			proposal.Command.ConversationId,
			fmt.Sprintf("queued-%d", index),
			now.Add(time.Duration(index)*time.Millisecond),
		))
	}
	if err := subserver.db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	_, _, err := subserver.proposalStore.accept(context.Background(), proposal)
	var admissionErr *commandProposalAdmissionError
	if !errors.As(err, &admissionErr) ||
		admissionErr.code != chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_RATE_LIMITED {
		t.Fatalf("admission err=%v, want RATE_LIMITED", err)
	}
	var stored conversationCommandProposalModel
	if err := subserver.db.Where(
		"conversation_id = ? AND command_id = ?",
		proposal.Command.ConversationId,
		proposal.Command.CommandId,
	).First(&stored).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("rejected proposal was persisted: %v", err)
	}
}

func pendingProposalRow(
	conversationID string,
	commandID string,
	createdAt time.Time,
) *conversationCommandProposalModel {
	return &conversationCommandProposalModel{
		ConversationID: conversationID,
		CommandID:      commandID,
		ActorPtid:      "ptid:test",
		CommandSHA256:  []byte(commandID),
		ProposalBytes:  []byte(commandID),
		State:          int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_HOME_ACCEPTED),
		NextRetryAt:    createdAt,
		ExpiresAt:      createdAt.Add(time.Hour),
		CreatedAt:      createdAt,
		UpdatedAt:      createdAt,
	}
}
