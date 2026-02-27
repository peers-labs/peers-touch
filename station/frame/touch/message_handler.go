package touch

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/message/service"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	m "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/message"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type MessageHandlerInfo struct {
	Handler server.Handler
}

func GetMessageHandlers() []MessageHandlerInfo {
	commonWrapper := CommonAccessControlWrapper(model.RouteNameMessage)

	return []MessageHandlerInfo{
		{Handler: server.NewTypedHandler("message-create-conv", string(MessageRouterURLCreateConv), server.POST, HandleCreateConv, commonWrapper)},
		{Handler: server.NewTypedHandler("message-get-conv", string(MessageRouterURLGetConv), server.POST, HandleGetConv, commonWrapper)},
		{Handler: server.NewTypedHandler("message-get-conv-state", string(MessageRouterURLGetConvState), server.POST, HandleGetConvState, commonWrapper)},
		{Handler: server.NewTypedHandler("message-update-members", string(MessageRouterURLMembers), server.POST, HandleUpdateMembers, commonWrapper)},
		{Handler: server.NewTypedHandler("message-get-members", string(MessageRouterURLMembers), server.GET, HandleGetMembers, commonWrapper)},
		{Handler: server.NewTypedHandler("message-key-rotate", string(MessageRouterURLKeyRotate), server.POST, HandleKeyRotate, commonWrapper)},
		{Handler: server.NewTypedHandler("message-append-msg", string(MessageRouterURLAppendMsg), server.POST, HandleAppendMessage, commonWrapper)},
		{Handler: server.NewTypedHandler("message-list-msg", string(MessageRouterURLListMsg), server.POST, HandleListMessages, commonWrapper)},
		{Handler: server.NewHTTPHandler("message-stream", string(MessageRouterURLStream), server.GET, StreamMessages, commonWrapper)},
		{Handler: server.NewTypedHandler("message-post-receipt", string(MessageRouterURLReceipt), server.POST, HandlePostReceipt, commonWrapper)},
		{Handler: server.NewTypedHandler("message-get-receipts", string(MessageRouterURLReceipts), server.POST, HandleGetReceipts, commonWrapper)},
		{Handler: server.NewTypedHandler("message-post-attachment", string(MessageRouterURLAttach), server.POST, HandlePostAttachment, commonWrapper)},
		{Handler: server.NewTypedHandler("message-get-attachment", string(MessageRouterURLGetAttach), server.POST, HandleGetAttachment, commonWrapper)},
		{Handler: server.NewTypedHandler("message-search", string(MessageRouterURLSearch), server.POST, HandleSearchMessages, commonWrapper)},
		{Handler: server.NewTypedHandler("message-get-snapshot", string(MessageRouterURLSnapshot), server.POST, HandleGetSnapshot, commonWrapper)},
		{Handler: server.NewTypedHandler("message-post-snapshot", string(MessageRouterURLSnapshot), server.POST, HandlePostSnapshot, commonWrapper)},
	}
}

func HandleCreateConv(ctx context.Context, req *pb.CreateConvRequest) (*pb.CreateConvResponse, error) {
	svc := service.NewConversationService()
	conv, err := svc.Create(ctx, &service.CreateConvReq{
		ConvID:    req.ConvId,
		Type:      req.Type,
		Title:     req.Title,
		AvatarCID: req.AvatarCid,
		Policy:    req.Policy,
	})
	if err != nil {
		return nil, server.InternalErrorWithCause("Failed to create conversation", err)
	}

	return &pb.CreateConvResponse{
		Conv: &pb.Conversation{
			Pk:        conv.ID,
			ConvId:    conv.ConvID,
			Type:      string(conv.Type),
			Title:     conv.Title,
			AvatarCid: conv.AvatarCID,
			Policy:    conv.Policy,
			Epoch:     uint32(conv.Epoch),
			CreatedAt: timestamppb.New(conv.CreatedAt),
			UpdatedAt: timestamppb.New(conv.UpdatedAt),
		},
	}, nil
}

func HandleGetConv(ctx context.Context, req *pb.GetConvRequest) (*pb.GetConvResponse, error) {
	svc := service.NewConversationService()
	conv, err := svc.Get(ctx, req.Id)
	if err != nil {
		return nil, server.NotFound("Conversation not found")
	}

	return &pb.GetConvResponse{
		Conv: &pb.Conversation{
			Pk:        conv.ID,
			ConvId:    conv.ConvID,
			Type:      string(conv.Type),
			Title:     conv.Title,
			AvatarCid: conv.AvatarCID,
			Policy:    conv.Policy,
			Epoch:     uint32(conv.Epoch),
			CreatedAt: timestamppb.New(conv.CreatedAt),
			UpdatedAt: timestamppb.New(conv.UpdatedAt),
		},
	}, nil
}

func HandleGetConvState(ctx context.Context, req *pb.GetConvStateRequest) (*pb.GetConvStateResponse, error) {
	svc := service.NewConversationService()
	conv, err := svc.Get(ctx, req.Id)
	if err != nil {
		return nil, server.NotFound("Conversation not found")
	}

	return &pb.GetConvStateResponse{
		Epoch: uint32(conv.Epoch),
	}, nil
}

func HandleUpdateMembers(ctx context.Context, req *pb.UpdateMembersRequest) (*pb.UpdateMembersResponse, error) {
	svc := service.NewConversationService()

	if len(req.Add) > 0 {
		if err := svc.AddMembers(ctx, req.ConvPk, req.Add, m.Role(req.Role)); err != nil {
			return nil, server.InternalErrorWithCause("Failed to add members", err)
		}
	}

	if len(req.Remove) > 0 {
		if err := svc.RemoveMembers(ctx, req.ConvPk, req.Remove); err != nil {
			return nil, server.InternalErrorWithCause("Failed to remove members", err)
		}
	}

	return &pb.UpdateMembersResponse{
		Success: true,
	}, nil
}

func HandleGetMembers(ctx context.Context, req *pb.GetMembersRequest) (*pb.GetMembersResponse, error) {
	svc := service.NewConversationService()
	
	conv, err := svc.Get(ctx, req.ConvId)
	if err != nil {
		return nil, server.NotFound("Conversation not found")
	}

	members, err := svc.Members(ctx, conv.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("Failed to get members", err)
	}

	pbMembers := make([]*pb.ConvMember, len(members))
	for i, m := range members {
		pbMembers[i] = &pb.ConvMember{
			Did:      m.DID,
			Role:     string(m.Role),
			JoinedAt: timestamppb.New(m.CreatedAt),
		}
	}

	return &pb.GetMembersResponse{
		Members: pbMembers,
	}, nil
}

func HandleKeyRotate(ctx context.Context, req *pb.KeyRotateRequest) (*pb.KeyRotateResponse, error) {
	svc := service.NewConversationService()
	if err := svc.KeyRotate(ctx, req.ConvId); err != nil {
		return nil, server.InternalErrorWithCause("Failed to rotate key", err)
	}

	return &pb.KeyRotateResponse{
		Success: true,
	}, nil
}

func HandleAppendMessage(ctx context.Context, req *pb.AppendMessageRequest) (*pb.AppendMessageResponse, error) {
	return &pb.AppendMessageResponse{
		Message: &pb.Message{
			ConvId:           req.ConvId,
			EncryptedContent: req.EncryptedContent,
			Timestamp:        timestamppb.Now(),
		},
	}, nil
}

func HandleListMessages(ctx context.Context, req *pb.ListMessagesRequest) (*pb.ListMessagesResponse, error) {
	return &pb.ListMessagesResponse{
		Messages: []*pb.Message{},
		HasMore:  false,
	}, nil
}

func StreamMessages(ctx context.Context, req server.Request, resp server.Response) error {
	resp.WriteHeader(200)
	resp.Write([]byte(`{"ok":true}`))
	return nil
}

func HandlePostReceipt(ctx context.Context, req *pb.PostReceiptRequest) (*pb.PostReceiptResponse, error) {
	return &pb.PostReceiptResponse{
		Success: true,
	}, nil
}

func HandleGetReceipts(ctx context.Context, req *pb.GetReceiptsRequest) (*pb.GetReceiptsResponse, error) {
	return &pb.GetReceiptsResponse{
		Receipts: []*pb.Receipt{},
	}, nil
}

func HandlePostAttachment(ctx context.Context, req *pb.PostAttachmentRequest) (*pb.PostAttachmentResponse, error) {
	return &pb.PostAttachmentResponse{
		Attachment: &pb.Attachment{
			Id:       "test",
			Filename: req.Filename,
			MimeType: req.MimeType,
		},
	}, nil
}

func HandleGetAttachment(ctx context.Context, req *pb.GetAttachmentRequest) (*pb.GetAttachmentResponse, error) {
	return &pb.GetAttachmentResponse{
		Attachment: &pb.Attachment{
			Id: req.Id,
		},
		EncryptedData: []byte{},
	}, nil
}

func HandleSearchMessages(ctx context.Context, req *pb.SearchMessagesRequest) (*pb.SearchMessagesResponse, error) {
	return &pb.SearchMessagesResponse{
		Messages: []*pb.Message{},
	}, nil
}

func HandleGetSnapshot(ctx context.Context, req *pb.GetSnapshotRequest) (*pb.GetSnapshotResponse, error) {
	return &pb.GetSnapshotResponse{
		Snapshot: &pb.Snapshot{
			ConvId: req.ConvId,
		},
	}, nil
}

func HandlePostSnapshot(ctx context.Context, req *pb.PostSnapshotRequest) (*pb.PostSnapshotResponse, error) {
	return &pb.PostSnapshotResponse{
		Success: true,
	}, nil
}
