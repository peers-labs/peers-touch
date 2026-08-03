package conversation

import (
	"context"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

const commandProposalWorkerBatch = 32

func (s *subServer) runCommandProposalWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.processCommandProposalBatch(ctx)
		}
	}
}

func (s *subServer) processCommandProposalBatch(ctx context.Context) {
	if s.proposalStore == nil {
		return
	}
	rows, err := s.proposalStore.pending(ctx, time.Now(), commandProposalWorkerBatch)
	if err != nil {
		return
	}
	for _, row := range rows {
		proposal := &chat.ConversationCommandProposal{}
		if err := proto.Unmarshal(row.ProposalBytes, proposal); err != nil {
			_ = s.proposalStore.markRetry(
				ctx,
				row.ConversationID,
				row.CommandID,
				time.Now().Add(time.Minute),
				"stored proposal is invalid",
			)
			continue
		}
		if !row.ExpiresAt.After(time.Now()) {
			item, err := s.proposalStore.complete(ctx, proposal, &chat.ConversationCommandProposalResult{
				CommandId:  row.CommandID,
				RejectCode: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_EXPIRED,
			})
			if err == nil && item != nil && s.envelopeService != nil {
				s.envelopeService.NotifyPersisted(ctx, item)
			}
			continue
		}
		if err := s.dispatchCommandProposal(ctx, proposal); err != nil {
			_ = s.proposalStore.markRetry(
				ctx,
				row.ConversationID,
				row.CommandID,
				time.Now().Add(commandProposalRetryDelay(row.RetryCount)),
				err.Error(),
			)
		}
	}
}
