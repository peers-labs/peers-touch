package http

import (
	"context"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ClientCommandApplication is the command-side boundary used by the canonical
// Conversation client adapter.
type ClientCommandApplication interface {
	PrepareCommand(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		sender valueobject.Endpoint,
	) (aggregate.CommandPreparation, error)
	PrepareMembership(
		ctx context.Context,
		request command.PrepareMembershipRequest,
	) (entity.AuthorityPlan, error)
	UpdateMemberSettings(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
		patch command.MemberSettingsPatch,
	) (repository.MemberSettings, error)
	SubmitLeaveIntent(
		ctx context.Context,
		request command.LeaveIntentRequest,
	) (repository.LeaveIntent, error)
}

// ClientQueryApplication is the read-side boundary used by the canonical
// Conversation client adapter.
type ClientQueryApplication interface {
	Get(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) (query.ConversationView, error)
	List(
		ctx context.Context,
		actor valueobject.PTID,
	) ([]query.ConversationView, error)
	Members(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) ([]entity.Member, error)
	PublicHead(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) (query.PublicHead, error)
	MemberSettings(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
	) (repository.MemberSettings, error)
	PendingLeaveIntents(
		ctx context.Context,
		conversationID valueobject.ConversationID,
		actor valueobject.PTID,
		limit int,
	) ([]repository.LeaveIntent, error)
}

// ClientAdapter maps authenticated canonical protobuf requests to Conversation
// application commands and queries. Route registration remains composition-owned.
type ClientAdapter struct {
	commands ClientCommandApplication
	queries  ClientQueryApplication
}

func NewClientAdapter(
	commands ClientCommandApplication,
	queries ClientQueryApplication,
) (*ClientAdapter, error) {
	if commands == nil || queries == nil {
		return nil, invalid(
			"interface.new_client_adapter",
			"applications",
			"command and query services are required",
		)
	}

	return &ClientAdapter{
		commands: commands,
		queries:  queries,
	}, nil
}

func (a *ClientAdapter) ListConversations(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.ListConversationsRequest,
) (*chat.ListConversationsResponse, error) {
	if request == nil {
		return nil, invalid(
			"interface.list_conversations",
			"request",
			"is required",
		)
	}
	actor, err := authenticatedPTID(authenticated, "interface.list_conversations")
	if err != nil {
		return nil, err
	}
	views, err := a.queries.List(ctx, actor)
	if err != nil {
		return nil, err
	}
	conversations := make([]*chat.Conversation, 0, len(views))
	for _, view := range views {
		conversation, err := conversationToProto(view.Conversation)
		if err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}

	return &chat.ListConversationsResponse{Conversations: conversations}, nil
}

func (a *ClientAdapter) GetConversation(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.GetConversationRequest,
) (*chat.GetConversationResponse, error) {
	if request == nil {
		return nil, invalid("interface.get_conversation", "request", "is required")
	}
	actor, conversationID, err := authenticatedConversation(
		authenticated,
		request.GetConversationId(),
		"interface.get_conversation",
	)
	if err != nil {
		return nil, err
	}
	view, err := a.queries.Get(ctx, conversationID, actor)
	if err != nil {
		return nil, err
	}
	conversation, err := conversationToProto(view.Conversation)
	if err != nil {
		return nil, err
	}

	return &chat.GetConversationResponse{Conversation: conversation}, nil
}

func (a *ClientAdapter) GetConversationPublicHead(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.GetConversationPublicHeadRequest,
) (*chat.GetConversationPublicHeadResponse, error) {
	if request == nil {
		return nil, invalid(
			"interface.get_conversation_public_head",
			"request",
			"is required",
		)
	}
	actor, conversationID, err := authenticatedConversation(
		authenticated,
		request.GetConversationId(),
		"interface.get_conversation_public_head",
	)
	if err != nil {
		return nil, err
	}
	head, err := a.queries.PublicHead(ctx, conversationID, actor)
	if err != nil {
		return nil, err
	}
	mapped, err := publicHeadToProto(head)
	if err != nil {
		return nil, err
	}

	return &chat.GetConversationPublicHeadResponse{Head: mapped}, nil
}

func (a *ClientAdapter) GetConversationMembers(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.GetConversationMembersRequest,
) (*chat.GetConversationMembersResponse, error) {
	if request == nil {
		return nil, invalid(
			"interface.get_conversation_members",
			"request",
			"is required",
		)
	}
	actor, conversationID, err := authenticatedConversation(
		authenticated,
		request.GetConversationId(),
		"interface.get_conversation_members",
	)
	if err != nil {
		return nil, err
	}
	members, err := a.queries.Members(ctx, conversationID, actor)
	if err != nil {
		return nil, err
	}
	mapped := make([]*chat.ConversationMember, 0, len(members))
	for _, member := range members {
		wire, err := memberToProto(conversationID, member)
		if err != nil {
			return nil, err
		}
		mapped = append(mapped, wire)
	}

	return &chat.GetConversationMembersResponse{Members: mapped}, nil
}

func (a *ClientAdapter) PrepareConversationCommand(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.PrepareConversationCommandRequest,
) (*chat.PrepareConversationCommandResponse, error) {
	const operation = "interface.prepare_conversation_command"

	if request == nil || request.GetSender() == nil {
		return nil, invalid(operation, "request", "sender is required")
	}
	sender, err := bindConversationEndpoint(
		authenticated,
		request.GetSender(),
		operation,
	)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, err
	}
	preparation, err := a.commands.PrepareCommand(ctx, conversationID, sender)
	if err != nil {
		return nil, err
	}
	if requestedAuthority := strings.TrimSpace(
		request.GetAuthorityStationPeerId(),
	); requestedAuthority != "" &&
		requestedAuthority != string(preparation.AuthorityStation) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			operation,
			"authority_station_peer_id",
			"does not match the current Conversation authority",
		)
	}

	return commandPreparationToProto(conversationID, preparation), nil
}

func (a *ClientAdapter) PrepareConversationMembership(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.PrepareConversationMembershipRequest,
) (*chat.PrepareConversationMembershipResponse, error) {
	const operation = "interface.prepare_conversation_membership"

	if request == nil || request.GetSender() == nil {
		return nil, invalid(operation, "request", "sender is required")
	}
	requester, err := bindConversationEndpoint(
		authenticated,
		request.GetSender(),
		operation,
	)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, err
	}
	change, err := membershipChangeFromProto(authenticated, request)
	if err != nil {
		return nil, err
	}
	head, err := a.queries.PublicHead(ctx, conversationID, requester.Actor)
	if err != nil {
		return nil, err
	}
	plan, err := a.commands.PrepareMembership(ctx, command.PrepareMembershipRequest{
		ConversationID: conversationID,
		Requester:      requester,
		Changes:        []entity.MembershipChange{change},
	})
	if err != nil {
		return nil, err
	}

	return membershipPlanToProto(plan, head.AuthorityStation), nil
}

func (a *ClientAdapter) GetMemberSettings(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.GetMemberSettingsRequest,
) (*chat.GetMemberSettingsResponse, error) {
	if request == nil {
		return nil, invalid(
			"interface.get_member_settings",
			"request",
			"is required",
		)
	}
	actor, conversationID, err := authenticatedConversation(
		authenticated,
		request.GetConversationId(),
		"interface.get_member_settings",
	)
	if err != nil {
		return nil, err
	}
	settings, err := a.queries.MemberSettings(ctx, conversationID, actor)
	if err != nil {
		return nil, err
	}

	return &chat.GetMemberSettingsResponse{
		Settings: memberSettingsToProto(settings),
	}, nil
}

func (a *ClientAdapter) UpdateMemberSettings(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.UpdateMemberSettingsRequest,
) (*chat.UpdateMemberSettingsResponse, error) {
	const operation = "interface.update_member_settings"

	if request == nil || request.GetSettings() == nil {
		return nil, invalid(operation, "request", "settings are required")
	}
	actor, conversationID, err := authenticatedConversation(
		authenticated,
		request.GetConversationId(),
		operation,
	)
	if err != nil {
		return nil, err
	}
	settings := request.GetSettings()
	nickname := settings.GetNickname()
	muted := settings.GetMuted()
	pinned := settings.GetPinned()
	alertEnabled := settings.GetAlertEnabled()
	background := settings.GetBackground()
	backgroundImage := settings.GetBackgroundImage()
	clearedAtUnixMillis := settings.GetClearedAtMs()
	if _, err := a.commands.UpdateMemberSettings(
		ctx,
		conversationID,
		actor,
		command.MemberSettingsPatch{
			Nickname:            &nickname,
			Muted:               &muted,
			Pinned:              &pinned,
			AlertEnabled:        &alertEnabled,
			Background:          &background,
			BackgroundImage:     &backgroundImage,
			ClearedAtUnixMillis: &clearedAtUnixMillis,
		},
	); err != nil {
		return nil, err
	}

	return &chat.UpdateMemberSettingsResponse{Success: true}, nil
}

func (a *ClientAdapter) SubmitMlsLeaveIntent(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.SubmitMlsLeaveIntentRequest,
) (*chat.SubmitMlsLeaveIntentResponse, error) {
	const operation = "interface.submit_mls_leave_intent"

	if request == nil || request.GetIntent() == nil {
		return nil, invalid(operation, "request", "intent is required")
	}
	mapped, err := leaveIntentFromProto(authenticated, request.GetIntent())
	if err != nil {
		return nil, err
	}
	accepted, err := a.commands.SubmitLeaveIntent(ctx, mapped)
	if err != nil {
		return nil, err
	}

	return &chat.SubmitMlsLeaveIntentResponse{
		Intent: leaveIntentToProto(accepted),
	}, nil
}

func (a *ClientAdapter) ListPendingMlsLeaveIntents(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.ListPendingMlsLeaveIntentsRequest,
) (*chat.ListPendingMlsLeaveIntentsResponse, error) {
	if request == nil {
		return nil, invalid(
			"interface.list_pending_mls_leave_intents",
			"request",
			"is required",
		)
	}
	actor, conversationID, err := authenticatedConversation(
		authenticated,
		request.GetConversationId(),
		"interface.list_pending_mls_leave_intents",
	)
	if err != nil {
		return nil, err
	}
	intents, err := a.queries.PendingLeaveIntents(
		ctx,
		conversationID,
		actor,
		100,
	)
	if err != nil {
		return nil, err
	}
	mapped := make([]*chat.MlsLeaveIntent, 0, len(intents))
	for _, intent := range intents {
		mapped = append(mapped, leaveIntentToProto(intent))
	}

	return &chat.ListPendingMlsLeaveIntentsResponse{Intents: mapped}, nil
}

func authenticatedConversation(
	authenticated AuthenticatedActor,
	rawConversationID string,
	operation string,
) (valueobject.PTID, valueobject.ConversationID, error) {
	actor, err := authenticatedPTID(authenticated, operation)
	if err != nil {
		return "", "", err
	}
	conversationID, err := valueobject.NewConversationID(rawConversationID)
	if err != nil {
		return "", "", err
	}

	return actor, conversationID, nil
}

func authenticatedPTID(
	authenticated AuthenticatedActor,
	operation string,
) (valueobject.PTID, error) {
	if strings.TrimSpace(authenticated.PTID) != authenticated.PTID ||
		authenticated.PTID == "" {
		return "", conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			operation,
			"authenticated_actor",
			"does not contain a canonical PTID",
		)
	}
	actor, err := valueobject.NewPTID(authenticated.PTID)
	if err != nil {
		return "", conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			operation,
			"authenticated_actor",
			"does not contain a canonical PTID",
		)
	}

	return actor, nil
}

func bindConversationEndpoint(
	authenticated AuthenticatedActor,
	request *actormodel.ActorDeviceRef,
	operation string,
) (valueobject.Endpoint, error) {
	if request == nil || request.GetActor() == nil ||
		strings.TrimSpace(authenticated.PTID) != authenticated.PTID ||
		strings.TrimSpace(authenticated.DeviceID) != authenticated.DeviceID ||
		authenticated.PTID == "" || authenticated.DeviceID == "" ||
		request.GetActor().GetPtid() != authenticated.PTID ||
		request.GetDeviceId() != authenticated.DeviceID {
		return valueobject.Endpoint{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			operation,
			"endpoint",
			"does not match the authenticated actor device",
		)
	}
	endpoint, err := valueobject.NewEndpoint(
		authenticated.PTID,
		authenticated.DeviceID,
	)
	if err != nil {
		return valueobject.Endpoint{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			operation,
			"endpoint",
			"is not a complete authenticated actor device",
		)
	}

	return endpoint, nil
}

func membershipChangeFromProto(
	authenticated AuthenticatedActor,
	request *chat.PrepareConversationMembershipRequest,
) (entity.MembershipChange, error) {
	const operation = "interface.prepare_conversation_membership"

	action, err := membershipActionFromProto(request.GetAction())
	if err != nil {
		return entity.MembershipChange{}, err
	}
	var actor valueobject.PTID
	if request.GetTargetActor() != nil {
		actor, err = valueobject.NewPTID(request.GetTargetActor().GetPtid())
		if err != nil {
			return entity.MembershipChange{}, err
		}
	}
	if action == entity.MembershipActionLeave {
		if actor == "" {
			actor = valueobject.PTID(authenticated.PTID)
		}
		if actor != valueobject.PTID(authenticated.PTID) {
			return entity.MembershipChange{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				operation,
				"target_actor",
				"leave must target the authenticated actor",
			)
		}
	} else if actor == "" {
		return entity.MembershipChange{}, invalid(
			operation,
			"target_actor",
			"is required",
		)
	}
	role, err := memberRoleFromProto(request.GetRole(), action)
	if err != nil {
		return entity.MembershipChange{}, err
	}
	change := entity.MembershipChange{
		Action: action,
		Actor:  actor,
		Device: valueobject.DeviceID(strings.TrimSpace(request.GetTargetDeviceId())),
		Role:   role,
	}
	if err := validateMembershipTarget(change); err != nil {
		return entity.MembershipChange{}, err
	}

	return change, nil
}

func membershipActionFromProto(
	action chat.ConversationMembershipAction,
) (entity.MembershipAction, error) {
	switch action {
	case chat.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_ADD_ACTOR:
		return entity.MembershipActionAddActor, nil
	case chat.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_REMOVE_ACTOR:
		return entity.MembershipActionRemoveActor, nil
	case chat.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_LEAVE:
		return entity.MembershipActionLeave, nil
	case chat.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_CHANGE_ROLE:
		return entity.MembershipActionChangeRole, nil
	case chat.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_ADD_DEVICE:
		return entity.MembershipActionAddDevice, nil
	case chat.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_REMOVE_DEVICE:
		return entity.MembershipActionRemoveDevice, nil
	default:
		return "", conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"interface.prepare_conversation_membership",
			"action",
			"is not supported",
		)
	}
}

func memberRoleFromProto(
	role chat.MemberRole,
	action entity.MembershipAction,
) (valueobject.MemberRole, error) {
	if action != entity.MembershipActionAddActor &&
		action != entity.MembershipActionChangeRole {
		return "", nil
	}
	switch role {
	case chat.MemberRole_MEMBER_ROLE_MEMBER:
		return valueobject.MemberRoleMember, nil
	case chat.MemberRole_MEMBER_ROLE_ADMIN:
		return valueobject.MemberRoleAdmin, nil
	case chat.MemberRole_MEMBER_ROLE_OWNER:
		return valueobject.MemberRoleOwner, nil
	default:
		return "", invalid(
			"interface.prepare_conversation_membership",
			"role",
			"is required for this membership action",
		)
	}
}

func validateMembershipTarget(change entity.MembershipChange) error {
	switch change.Action {
	case entity.MembershipActionAddActor,
		entity.MembershipActionAddDevice,
		entity.MembershipActionRemoveDevice:
		if change.Device == "" {
			return invalid(
				"interface.prepare_conversation_membership",
				"target_device_id",
				"is required for this membership action",
			)
		}
	}

	return nil
}

func commandPreparationToProto(
	conversationID valueobject.ConversationID,
	preparation aggregate.CommandPreparation,
) *chat.PrepareConversationCommandResponse {
	return &chat.PrepareConversationCommandResponse{
		ConversationId:         string(conversationID),
		ConversationKind:       conversationKindToProto(preparation.Kind),
		AuthoritySequence:      int64(preparation.Head.Sequence),
		AuthorityHash:          optionalHashBytes(preparation.Head.EventHash),
		MembershipEpoch:        int64(preparation.Head.MembershipEpoch),
		MlsEpoch:               int64(preparation.Head.MLSEpoch),
		RequiredEndpoints:      endpointsToActorDeviceRefs(preparation.RequiredEndpoints),
		DeliveryPlanSha256:     preparation.DeliveryPlanHash.Bytes(),
		AuthorityStationPeerId: string(preparation.AuthorityStation),
	}
}

func membershipPlanToProto(
	plan entity.AuthorityPlan,
	authorityStation valueobject.StationID,
) *chat.PrepareConversationMembershipResponse {
	return &chat.PrepareConversationMembershipResponse{
		AuthorityPlanId:        string(plan.ID),
		ExpiresAt:              timestamppb.New(plan.ExpiresAt.UTC()),
		AuthorityStationPeerId: string(authorityStation),
		AuthoritySequence:      int64(plan.AuthorityHead.Sequence),
		AuthorityHash:          optionalHashBytes(plan.AuthorityHead.EventHash),
		FromMembershipEpoch:    int64(plan.AuthorityHead.MembershipEpoch),
		FromMlsEpoch:           int64(plan.AuthorityHead.MLSEpoch),
		PreEndpoints:           endpointsToActorDeviceRefs(plan.PreEndpoints),
		PostEndpoints:          endpointsToActorDeviceRefs(plan.PostEndpoints),
		AddedEndpoints:         endpointsToActorDeviceRefs(plan.AddedEndpoints),
		RemovedEndpoints:       endpointsToActorDeviceRefs(plan.RemovedEndpoints),
		ReservedKeyPackages:    reservationsToProto(plan.KeyPackageReservations),
		AuthorityPlanSha256:    plan.Hash.Bytes(),
	}
}

func endpointsToActorDeviceRefs(
	endpoints []valueobject.Endpoint,
) []*actormodel.ActorDeviceRef {
	mapped := make([]*actormodel.ActorDeviceRef, 0, len(endpoints))
	for _, endpoint := range endpoints {
		mapped = append(mapped, &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: string(endpoint.Actor)},
			DeviceId: string(endpoint.Device),
		})
	}

	return mapped
}

func reservationsToProto(
	reservations []valueobject.KeyPackageReservation,
) []*keyexchangemodel.MlsKeyPackageReservation {
	mapped := make([]*keyexchangemodel.MlsKeyPackageReservation, 0, len(reservations))
	for _, reservation := range reservations {
		mapped = append(mapped, &keyexchangemodel.MlsKeyPackageReservation{
			Target: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: string(reservation.Endpoint.Actor),
				},
				DeviceId: string(reservation.Endpoint.Device),
			},
			PackageId:        reservation.PackageID,
			KeyPackage:       append([]byte(nil), reservation.KeyPackage...),
			KeyPackageSha256: reservation.PackageHash.Bytes(),
		})
	}

	return mapped
}

func conversationToProto(
	snapshot aggregate.Snapshot,
) (*chat.Conversation, error) {
	status, err := conversationStatusToProto(snapshot.Status)
	if err != nil {
		return nil, err
	}

	return &chat.Conversation{
		ConversationId:         string(snapshot.ID),
		Kind:                   conversationKindToProto(snapshot.Kind),
		AuthorityStationPeerId: string(snapshot.AuthorityStation),
		MembershipEpoch:        int64(snapshot.Head.MembershipEpoch),
		Status:                 status,
		CreatedAt:              timestamppb.New(snapshot.CreatedAt.UTC()),
		UpdatedAt:              timestamppb.New(snapshot.UpdatedAt.UTC()),
		Name:                   snapshot.Settings.Name,
		Description:            snapshot.Settings.Description,
		AvatarCid:              snapshot.Settings.AvatarObjectID,
		OwnerPtid:              string(snapshot.Owner),
		Visibility:             conversationVisibilityToProto(snapshot.Settings.Visibility),
		DisappearTimerSeconds:  snapshot.Settings.DisappearTimerSeconds,
		MlsEpoch:               int64(snapshot.Head.MLSEpoch),
		FederationId:           string(snapshot.FederationID),
		AuthorityEpoch:         int64(snapshot.AuthorityEpoch),
	}, nil
}

func publicHeadToProto(head query.PublicHead) (*chat.ConversationPublicHead, error) {
	source, err := publicHeadSourceToProto(head.Source)
	if err != nil {
		return nil, err
	}

	return &chat.ConversationPublicHead{
		ConversationId:         string(head.ConversationID),
		Source:                 source,
		FederationId:           string(head.FederationID),
		AuthorityStationPeerId: string(head.AuthorityStation),
		AuthorityEpoch:         int64(head.AuthorityEpoch),
		GroupSeq:               int64(head.Head.Sequence),
		EventHash:              optionalHashBytes(head.Head.EventHash),
		MembershipEpoch:        int64(head.Head.MembershipEpoch),
		MlsEpoch:               int64(head.Head.MLSEpoch),
		Status:                 string(head.Status),
	}, nil
}

func memberToProto(
	conversationID valueobject.ConversationID,
	member entity.Member,
) (*chat.ConversationMember, error) {
	role, err := memberRoleToProto(member.Role)
	if err != nil {
		return nil, err
	}
	status, err := memberStatusToProto(member.Status)
	if err != nil {
		return nil, err
	}

	return &chat.ConversationMember{
		ConversationId:         string(conversationID),
		Ptid:                   string(member.Actor),
		Role:                   role,
		MemberStatus:           status,
		ActorHomeStationPeerId: string(member.HomeStation),
	}, nil
}

func memberSettingsToProto(settings repository.MemberSettings) *chat.MemberSettings {
	return &chat.MemberSettings{
		Nickname:        settings.Nickname,
		Muted:           settings.Muted,
		AlertEnabled:    settings.AlertEnabled,
		Pinned:          settings.Pinned,
		Background:      settings.Background,
		ClearedAtMs:     settings.ClearedAtUnixMillis,
		BackgroundImage: settings.BackgroundImage,
	}
}

func leaveIntentFromProto(
	authenticated AuthenticatedActor,
	intent *chat.MlsLeaveIntent,
) (command.LeaveIntentRequest, error) {
	const operation = "interface.submit_mls_leave_intent"

	if strings.TrimSpace(authenticated.PTID) != authenticated.PTID ||
		strings.TrimSpace(authenticated.DeviceID) != authenticated.DeviceID ||
		authenticated.PTID == "" || authenticated.DeviceID == "" ||
		intent.GetActorPtid() != authenticated.PTID ||
		intent.GetActorDeviceId() != authenticated.DeviceID {
		return command.LeaveIntentRequest{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			operation,
			"intent.actor",
			"does not match the authenticated actor device",
		)
	}
	if intent.GetAuthorityEpoch() <= 0 ||
		intent.GetAuthoritySequence() < 0 ||
		intent.GetObservedMembershipEpoch() < 0 ||
		intent.GetObservedMlsEpoch() < 0 {
		return command.LeaveIntentRequest{}, invalid(
			operation,
			"authority_head",
			"contains a negative or zero epoch",
		)
	}
	federationID, err := valueobject.NewFederationID(intent.GetFederationId())
	if err != nil {
		return command.LeaveIntentRequest{}, err
	}
	conversationID, err := valueobject.NewConversationID(intent.GetConversationId())
	if err != nil {
		return command.LeaveIntentRequest{}, err
	}
	actor, err := valueobject.NewEndpoint(
		intent.GetActorPtid(),
		intent.GetActorDeviceId(),
	)
	if err != nil {
		return command.LeaveIntentRequest{}, err
	}
	homeStation, err := valueobject.NewStationID(intent.GetHomeStationPeerId())
	if err != nil {
		return command.LeaveIntentRequest{}, err
	}
	authorityStation, err := valueobject.NewStationID(
		intent.GetAuthorityStationPeerId(),
	)
	if err != nil {
		return command.LeaveIntentRequest{}, err
	}
	authorityHash, err := valueobject.NewHash(intent.GetAuthorityHash())
	if err != nil {
		return command.LeaveIntentRequest{}, err
	}

	return command.LeaveIntentRequest{
		Version:          intent.GetVersion(),
		ID:               intent.GetIntentId(),
		FederationID:     federationID,
		ConversationID:   conversationID,
		Actor:            actor,
		SigningKeyID:     intent.GetActorSigningKeyId(),
		HomeStation:      homeStation,
		AuthorityStation: authorityStation,
		AuthorityEpoch: valueobject.AuthorityEpoch(
			intent.GetAuthorityEpoch(),
		),
		AuthorityHead: valueobject.AuthorityHead{
			Sequence:  valueobject.Sequence(intent.GetAuthoritySequence()),
			EventHash: authorityHash,
			MembershipEpoch: valueobject.Epoch(
				intent.GetObservedMembershipEpoch(),
			),
			MLSEpoch: valueobject.Epoch(intent.GetObservedMlsEpoch()),
		},
		Signature: append([]byte(nil), intent.GetActorSignature()...),
		CreatedAt: time.UnixMilli(intent.GetCreatedAtUnixMs()).UTC(),
		ExpiresAt: time.UnixMilli(intent.GetExpiresAtUnixMs()).UTC(),
	}, nil
}

func leaveIntentToProto(intent repository.LeaveIntent) *chat.MlsLeaveIntent {
	return &chat.MlsLeaveIntent{
		Version:                 intent.Version,
		IntentId:                intent.ID,
		FederationId:            string(intent.FederationID),
		AuthorityStationPeerId:  string(intent.AuthorityStation),
		AuthorityEpoch:          int64(intent.AuthorityEpoch),
		HomeStationPeerId:       string(intent.HomeStation),
		ConversationId:          string(intent.ConversationID),
		ActorPtid:               string(intent.Actor.Actor),
		ActorDeviceId:           string(intent.Actor.Device),
		ActorSigningKeyId:       intent.SigningKeyID,
		ObservedMembershipEpoch: int64(intent.AuthorityHead.MembershipEpoch),
		ObservedMlsEpoch:        int64(intent.AuthorityHead.MLSEpoch),
		CreatedAtUnixMs:         intent.CreatedAt.UnixMilli(),
		ExpiresAtUnixMs:         intent.ExpiresAt.UnixMilli(),
		ActorSignature:          append([]byte(nil), intent.Signature...),
		AuthoritySequence:       int64(intent.AuthorityHead.Sequence),
		AuthorityHash:           intent.AuthorityHead.EventHash.Bytes(),
	}
}

func conversationStatusToProto(
	status valueobject.ConversationStatus,
) (chat.ConversationStatus, error) {
	switch status {
	case valueobject.ConversationStatusActive:
		return chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE, nil
	case valueobject.ConversationStatusDissolved:
		return chat.ConversationStatus_CONVERSATION_STATUS_DISSOLVED, nil
	case valueobject.ConversationStatusDegradedReadOnly:
		return chat.ConversationStatus_CONVERSATION_STATUS_DEGRADED_READ_ONLY, nil
	case valueobject.ConversationStatusOrphanedReadOnly:
		return chat.ConversationStatus_CONVERSATION_STATUS_ORPHANED_READ_ONLY, nil
	default:
		return 0, invalid(
			"interface.map_conversation_status",
			"status",
			"is not supported",
		)
	}
}

func publicHeadSourceToProto(
	source query.Source,
) (chat.ConversationPublicHeadSource, error) {
	switch source {
	case query.SourceAuthority:
		return chat.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_AUTHORITY, nil
	case query.SourceFollower:
		return chat.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_FOLLOWER, nil
	default:
		return 0, invalid(
			"interface.map_public_head_source",
			"source",
			"is not supported",
		)
	}
}

func memberRoleToProto(role valueobject.MemberRole) (chat.MemberRole, error) {
	switch role {
	case valueobject.MemberRoleMember:
		return chat.MemberRole_MEMBER_ROLE_MEMBER, nil
	case valueobject.MemberRoleAdmin:
		return chat.MemberRole_MEMBER_ROLE_ADMIN, nil
	case valueobject.MemberRoleOwner:
		return chat.MemberRole_MEMBER_ROLE_OWNER, nil
	default:
		return 0, invalid(
			"interface.map_member_role",
			"role",
			"is not supported",
		)
	}
}

func memberStatusToProto(status valueobject.MemberStatus) (chat.MemberStatus, error) {
	switch status {
	case valueobject.MemberStatusActive:
		return chat.MemberStatus_MEMBER_STATUS_ACTIVE, nil
	case valueobject.MemberStatusLeft:
		return chat.MemberStatus_MEMBER_STATUS_LEFT, nil
	case valueobject.MemberStatusRemoved:
		return chat.MemberStatus_MEMBER_STATUS_REMOVED, nil
	default:
		return 0, invalid(
			"interface.map_member_status",
			"status",
			"is not supported",
		)
	}
}

var _ ClientCommandApplication = (*command.Service)(nil)
var _ ClientQueryApplication = (*query.Service)(nil)
