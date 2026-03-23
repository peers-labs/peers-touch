package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/service"
)

type MessageHandlers struct{}

func NewMessageHandlers() *MessageHandlers {
	return &MessageHandlers{}
}

func (h *MessageHandlers) HandleListMessages(ctx context.Context, req *model.ListMessagesRequest) (*model.ListMessagesResponse, error) {
	messages, err := service.ListMessages(ctx, req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListMessagesResponse{Messages: messages}, nil
}

func (h *MessageHandlers) HandleGetMessage(ctx context.Context, req *model.GetMessageRequest) (*model.GetMessageResponse, error) {
	message, err := service.GetMessage(ctx, req.GetMessageId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetMessageResponse{Message: message}, nil
}

func (h *MessageHandlers) HandleDeleteMessage(ctx context.Context, req *model.DeleteMessageRequest) (*model.DeleteMessageResponse, error) {
	if err := service.DeleteMessage(ctx, req.GetMessageId()); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.DeleteMessageResponse{Success: true}, nil
}
