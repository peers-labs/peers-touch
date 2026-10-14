package infrastructure

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const conversationInstanceKey = "conversation"

var ErrPublishingUnavailable = errors.New("bot: message publishing capability is unavailable")

type LazyPublishingManager struct{}

func NewLazyPublishingManager() *LazyPublishingManager {
	return &LazyPublishingManager{}
}

func (LazyPublishingManager) manager() (registry.PublishingManager, error) {
	instance := server.GetOptions().SubserverInstances[conversationInstanceKey]
	manager, ok := instance.(registry.PublishingManager)
	if !ok || manager == nil {
		return nil, ErrPublishingUnavailable
	}
	return manager, nil
}

func (m LazyPublishingManager) CreateForBot(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
	name string,
) (registry.PublishingCreated, error) {
	manager, err := m.manager()
	if err != nil {
		return registry.PublishingCreated{}, err
	}
	return manager.CreateForBot(ctx, ownerPtid, botPtid, name)
}

func (m LazyPublishingManager) Get(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
) (registry.PublishingGrant, error) {
	manager, err := m.manager()
	if err != nil {
		return registry.PublishingGrant{}, err
	}
	return manager.Get(ctx, ownerPtid, publishingID)
}

func (m LazyPublishingManager) Rotate(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
) (registry.PublishingCreated, error) {
	manager, err := m.manager()
	if err != nil {
		return registry.PublishingCreated{}, err
	}
	return manager.Rotate(ctx, ownerPtid, publishingID)
}

func (m LazyPublishingManager) SetDisabled(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
	disabled bool,
) (registry.PublishingGrant, error) {
	manager, err := m.manager()
	if err != nil {
		return registry.PublishingGrant{}, err
	}
	return manager.SetDisabled(ctx, ownerPtid, publishingID, disabled)
}

func (m LazyPublishingManager) Revoke(
	ctx context.Context,
	ownerPtid string,
	publishingID string,
) (registry.PublishingGrant, error) {
	manager, err := m.manager()
	if err != nil {
		return registry.PublishingGrant{}, err
	}
	return manager.Revoke(ctx, ownerPtid, publishingID)
}

var _ registry.PublishingManager = LazyPublishingManager{}
