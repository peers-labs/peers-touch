package social

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type conversationGroupRecipientProvider interface {
	PrepareSnapshot(
		context.Context,
		string,
		string,
	) (ports.GroupRecipientSnapshot, error)
	WithSubmitFence(
		context.Context,
		ports.GroupRecipientSnapshot,
		func(ports.GroupRecipientSnapshot) error,
	) error
}

type conversationGroupRecipientResolver func() (
	conversationGroupRecipientProvider,
	error,
)

type privateContentGroupRecipientPort struct {
	resolve conversationGroupRecipientResolver
}

func newPrivateContentGroupRecipientPort() privateContentGroupRecipientPort {
	return privateContentGroupRecipientPort{
		resolve: resolveConversationGroupRecipientProvider,
	}
}

func (p privateContentGroupRecipientPort) PrepareSnapshot(
	ctx context.Context,
	conversationID string,
	authorPTID string,
) (socialdomain.GroupRecipientSnapshot, error) {
	provider, err := p.provider()
	if err != nil {
		return socialdomain.GroupRecipientSnapshot{}, err
	}
	snapshot, err := provider.PrepareSnapshot(
		ctx,
		conversationID,
		authorPTID,
	)
	if err != nil {
		return socialdomain.GroupRecipientSnapshot{},
			mapConversationGroupError(
				"social.private_content.group_snapshot.prepare",
				err,
			)
	}

	return socialGroupRecipientSnapshot(snapshot), nil
}

func (p privateContentGroupRecipientPort) WithSubmitFence(
	ctx context.Context,
	expected socialdomain.GroupRecipientSnapshot,
	commit func(socialdomain.GroupRecipientSnapshot) error,
) error {
	if commit == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			"social.private_content.group_snapshot.submit_fence",
			"commit",
			"is required",
		)
	}
	provider, err := p.provider()
	if err != nil {
		return err
	}

	err = provider.WithSubmitFence(
		ctx,
		conversationGroupRecipientSnapshot(expected),
		func(verified ports.GroupRecipientSnapshot) error {
			return commit(socialGroupRecipientSnapshot(verified))
		},
	)
	if err != nil {
		return mapConversationGroupError(
			"social.private_content.group_snapshot.submit_fence",
			err,
		)
	}

	return nil
}

func (p privateContentGroupRecipientPort) provider() (
	conversationGroupRecipientProvider,
	error,
) {
	if p.resolve == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.group_snapshot",
			"conversation",
			"provider resolver is unavailable",
		)
	}
	provider, err := p.resolve()
	if err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.group_snapshot",
			err,
		)
	}

	return provider, nil
}

func resolveConversationGroupRecipientProvider() (
	conversationGroupRecipientProvider,
	error,
) {
	instance := server.GetOptions().SubserverInstances["conversation"]
	provider, ok := instance.(conversationGroupRecipientProvider)
	if !ok || provider == nil {
		return nil, errors.New(
			"canonical Conversation Group recipient provider is unavailable",
		)
	}

	return provider, nil
}

func socialGroupRecipientSnapshot(
	snapshot ports.GroupRecipientSnapshot,
) socialdomain.GroupRecipientSnapshot {
	members := make(
		[]socialdomain.RecipientLocality,
		0,
		len(snapshot.Members),
	)
	for _, member := range snapshot.Members {
		members = append(members, socialdomain.RecipientLocality{
			ActorPTID:         member.ActorPTID,
			HomeStationPeerID: member.HomeStationPeerID,
		})
	}

	return socialdomain.GroupRecipientSnapshot{
		FederationID:        snapshot.FederationID,
		ConversationID:      snapshot.ConversationID,
		AuthorPTID:          snapshot.AuthorPTID,
		MembershipEpoch:     snapshot.MembershipEpoch,
		AuthorityHeadSHA256: append([]byte(nil), snapshot.AuthorityHeadSHA256...),
		Members:             members,
	}
}

func conversationGroupRecipientSnapshot(
	snapshot socialdomain.GroupRecipientSnapshot,
) ports.GroupRecipientSnapshot {
	members := make(
		[]ports.GroupRecipientMember,
		0,
		len(snapshot.Members),
	)
	for _, member := range snapshot.Members {
		members = append(members, ports.GroupRecipientMember{
			ActorPTID:         member.ActorPTID,
			HomeStationPeerID: member.HomeStationPeerID,
		})
	}

	return ports.GroupRecipientSnapshot{
		FederationID:        snapshot.FederationID,
		ConversationID:      snapshot.ConversationID,
		AuthorPTID:          snapshot.AuthorPTID,
		MembershipEpoch:     snapshot.MembershipEpoch,
		AuthorityHeadSHA256: append([]byte(nil), snapshot.AuthorityHeadSHA256...),
		Members:             members,
	}
}

func mapConversationGroupError(operation string, err error) error {
	switch {
	case conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeStaleAuthorityHead,
	), conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeStaleMembershipEpoch,
	):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentStalePlan,
			operation,
			err,
		)
	case conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeUnauthorized,
	):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			operation,
			err,
		)
	case conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeNotFound,
	), conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeInactive,
	):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentNotFound,
			operation,
			err,
		)
	case conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeInvalidArgument,
	):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			err,
		)
	default:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
}

var _ application.GroupRecipientSnapshotReader = privateContentGroupRecipientPort{}
