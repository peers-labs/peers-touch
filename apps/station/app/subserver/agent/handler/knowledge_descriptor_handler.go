package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
)

type KnowledgeDescriptorHandlers struct {
	service *service.KnowledgeResourceService
}

func NewKnowledgeDescriptorHandlers(
	descriptorService *service.KnowledgeResourceService,
) *KnowledgeDescriptorHandlers {
	return &KnowledgeDescriptorHandlers{service: descriptorService}
}

func (h *KnowledgeDescriptorHandlers) HandleCreate(
	ctx context.Context,
	req *model.CreateKnowledgeResourceDescriptorRequest,
) (*model.CreateKnowledgeResourceDescriptorResponse, error) {
	descriptor, manifest, err := h.service.Create(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.CreateKnowledgeResourceDescriptorResponse{
		Descriptor_: descriptor,
		Manifest:    manifest,
	}, nil
}

func (h *KnowledgeDescriptorHandlers) HandleUpdate(
	ctx context.Context,
	req *model.UpdateKnowledgeResourceDescriptorRequest,
) (*model.UpdateKnowledgeResourceDescriptorResponse, error) {
	descriptor, manifest, err := h.service.Update(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.UpdateKnowledgeResourceDescriptorResponse{
		Descriptor_: descriptor,
		Manifest:    manifest,
	}, nil
}

func (h *KnowledgeDescriptorHandlers) HandleList(
	ctx context.Context,
	req *model.ListKnowledgeResourceDescriptorsRequest,
) (*model.ListKnowledgeResourceDescriptorsResponse, error) {
	descriptors, nextCursor, err := h.service.List(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ListKnowledgeResourceDescriptorsResponse{
		Descriptors: descriptors,
		NextCursor:  nextCursor,
	}, nil
}

func (h *KnowledgeDescriptorHandlers) HandleTombstone(
	ctx context.Context,
	req *model.TombstoneKnowledgeResourceDescriptorRequest,
) (*model.TombstoneKnowledgeResourceDescriptorResponse, error) {
	descriptor, manifest, err := h.service.Tombstone(ctx, subjectActorID(ctx), req)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.TombstoneKnowledgeResourceDescriptorResponse{
		Descriptor_: descriptor,
		Manifest:    manifest,
	}, nil
}
