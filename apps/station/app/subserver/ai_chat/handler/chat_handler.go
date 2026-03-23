package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/service"
)

type ChatHandlers struct{}

func NewChatHandlers() *ChatHandlers {
	return &ChatHandlers{}
}

func (h *ChatHandlers) HandleCompletions(ctx context.Context, req *model.ChatCompletionRequest) (*model.ChatCompletionResponse, error) {
	resp, err := service.CompleteChat(ctx, req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return resp, nil
}
