package http

import (
	"bytes"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type AuthenticatedActor struct {
	PTID     string
	DeviceID string
}

func MapSubmitCommand(
	authenticated AuthenticatedActor,
	request *chat.SubmitConversationAuthorityCommandRequest,
	preparation aggregate.CommandPreparation,
	plan *entity.AuthorityPlan,
	now time.Time,
) (command.SubmitRequest, error) {
	if request == nil || request.Command == nil {
		return command.SubmitRequest{}, invalid("interface.map_submit_command", "command", "is required")
	}
	wire := request.Command
	if wire.Sender == nil ||
		wire.Sender.Ptid != authenticated.PTID ||
		wire.Sender.DeviceId != authenticated.DeviceID {
		return command.SubmitRequest{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"interface.map_submit_command",
			"sender",
			"does not match the authenticated endpoint",
		)
	}
	if preparation.Kind.Validate() != nil ||
		preparation.AuthorityStation == "" ||
		wire.AuthorityStationId != string(preparation.AuthorityStation) {
		return command.SubmitRequest{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"interface.map_submit_command",
			"authority_station_id",
			"does not match the prepared Conversation authority",
		)
	}
	conversationID, err := valueobject.NewConversationID(wire.ConversationId)
	if err != nil {
		return command.SubmitRequest{}, err
	}
	commandID, err := valueobject.NewCommandID(wire.CommandId)
	if err != nil {
		return command.SubmitRequest{}, err
	}
	sender, err := valueobject.NewEndpoint(wire.Sender.Ptid, wire.Sender.DeviceId)
	if err != nil {
		return command.SubmitRequest{}, err
	}
	if wire.ClientTimestamp == nil || !wire.ClientTimestamp.IsValid() {
		return command.SubmitRequest{}, invalid(
			"interface.map_submit_command",
			"client_timestamp",
			"is required and must be valid",
		)
	}
	deliveryPlanHash, err := valueobject.NewHash(wire.DeliveryPlanSha256)
	if err != nil {
		return command.SubmitRequest{}, err
	}
	exactBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	if err != nil {
		return command.SubmitRequest{}, fmt.Errorf(
			"conversation interface: marshal canonical command: %w",
			err,
		)
	}
	mapped := aggregate.Command{
		ID:                      commandID,
		ConversationID:          conversationID,
		AuthorityStation:        preparation.AuthorityStation,
		Sender:                  sender,
		ObservedMembershipEpoch: valueobject.Epoch(wire.ObservedMembershipEpoch),
		ObservedMLSEpoch:        valueobject.Epoch(wire.ObservedMlsEpoch),
		DeliveryPlanHash:        deliveryPlanHash,
		RequiredEndpoints:       preparation.RequiredEndpoints,
		Payload:                 exactBytes,
		CommittedAt:             now.UTC(),
	}
	result := command.SubmitRequest{
		Command:           mapped,
		ExactCommandBytes: exactBytes,
	}
	switch payload := wire.Payload.(type) {
	case *chat.ChatCommand_SendMessage:
		mapped.Kind = domainevent.KindMessageCommitted
		mapped.MessageID = valueobject.MessageID(payload.SendMessage.GetMessageId())
		mapped.ReplyToMessageID = valueobject.MessageID(payload.SendMessage.GetReplyToMessageId())
		mapped.ThreadRootMessageID = valueobject.MessageID(
			payload.SendMessage.GetThreadRootMessageId(),
		)
		mapped.ObjectIDs = objectIDs(payload.SendMessage.GetAttachments())
		mapped.Deliveries, err = mapContentDeliveries(
			wire,
			preparation.Kind,
			preparation.RequiredEndpoints,
			payload.SendMessage.GetDirectPayloads(),
			payload.SendMessage.GetMlsApplicationPayload(),
			payload.SendMessage.GetMlsApplicationPayloadSha256(),
			valueobject.DeliveryKindMLSApplication,
		)
	case *chat.ChatCommand_EditMessage:
		mapped.Kind = domainevent.KindMessageEdited
		mapped.MessageID = valueobject.MessageID(payload.EditMessage.GetMessageId())
		mapped.Deliveries, err = mapContentDeliveries(
			wire,
			preparation.Kind,
			preparation.RequiredEndpoints,
			payload.EditMessage.GetDirectPayloads(),
			payload.EditMessage.GetMlsApplicationPayload(),
			payload.EditMessage.GetMlsApplicationPayloadSha256(),
			valueobject.DeliveryKindMLSApplication,
		)
	case *chat.ChatCommand_RetractMessage:
		mapped.Kind = domainevent.KindMessageRetracted
		mapped.MessageID = valueobject.MessageID(payload.RetractMessage.GetMessageId())
		mapped.Deliveries, err = mapPublicDeliveries(wire, preparation.RequiredEndpoints)
	case *chat.ChatCommand_Reaction:
		mapped.Kind = domainevent.KindReactionCommitted
		mapped.MessageID = valueobject.MessageID(payload.Reaction.GetMessageId())
		mapped.Reaction = payload.Reaction.GetReaction()
		mapped.Deliveries, err = mapPublicDeliveries(wire, preparation.RequiredEndpoints)
	case *chat.ChatCommand_PinMessage:
		mapped.Kind = domainevent.KindMessagePinCommitted
		mapped.MessageID = valueobject.MessageID(payload.PinMessage.GetMessageId())
		mapped.Deliveries, err = mapPublicDeliveries(wire, preparation.RequiredEndpoints)
	case *chat.ChatCommand_UpdateConversation:
		mapped.Kind = domainevent.KindConversationSettings
		mapped.Deliveries, err = mapPublicDeliveries(wire, preparation.RequiredEndpoints)
		result.Settings = mapSettingsPatch(payload.UpdateConversation)
	case *chat.ChatCommand_DissolveConversation:
		if preparation.Kind != valueobject.ConversationKindGroup {
			return command.SubmitRequest{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnsupportedTransition,
				"interface.map_submit_command",
				"dissolve_conversation",
				"requires a group conversation",
			)
		}
		mapped.Kind = domainevent.KindConversationDissolved
		mapped.Deliveries, err = mapPublicDeliveries(wire, preparation.RequiredEndpoints)
		result.Dissolve = true
	case *chat.ChatCommand_MembershipTransition:
		if preparation.Kind != valueobject.ConversationKindGroup {
			return command.SubmitRequest{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnsupportedTransition,
				"interface.map_submit_command",
				"membership_transition",
				"requires a group conversation",
			)
		}
		if plan == nil {
			return command.SubmitRequest{}, invalid(
				"interface.map_submit_command",
				"authority_plan",
				"is required for membership transitions",
			)
		}
		if payload.MembershipTransition.GetAuthorityPlanId() != string(plan.ID) ||
			!bytes.Equal(
				payload.MembershipTransition.GetAuthorityPlanSha256(),
				plan.Hash.Bytes(),
			) ||
			!bytes.Equal(wire.DeliveryPlanSha256, plan.Hash.Bytes()) {
			return command.SubmitRequest{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanStale,
				"interface.map_submit_command",
				"authority_plan",
				"does not match the signed command",
			)
		}
		mapped.Kind = domainevent.KindMembershipCommitted
		mapped.RequiredEndpoints = endpointUnion(plan.PreEndpoints, plan.PostEndpoints)
		mapped.Deliveries, err = mapMembershipDeliveries(wire, payload.MembershipTransition, *plan)
		result.AuthorityPlanID = plan.ID
		result.AuthorityPlanHash = plan.Hash
		result.Membership = &aggregate.MembershipTransition{
			Command:           mapped,
			TransitionID:      valueobject.TransitionID(payload.MembershipTransition.GetTransitionId()),
			AuthorityPlanID:   plan.ID,
			AuthorityPlanHash: plan.Hash,
			FromMembership:    valueobject.Epoch(payload.MembershipTransition.GetFromMembershipEpoch()),
			FromMLS:           valueobject.Epoch(payload.MembershipTransition.GetFromMlsEpoch()),
			ToMLS:             valueobject.Epoch(payload.MembershipTransition.GetToMlsEpoch()),
			Changes:           mapMembershipChanges(payload.MembershipTransition.GetChanges()),
			PreEndpoints:      append([]valueobject.Endpoint(nil), plan.PreEndpoints...),
			PostEndpoints:     append([]valueobject.Endpoint(nil), plan.PostEndpoints...),
			LeaveIntentID:     payload.MembershipTransition.GetLeaveIntentId(),
		}
	default:
		return command.SubmitRequest{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"interface.map_submit_command",
			"payload",
			"is not supported",
		)
	}
	if err != nil {
		return command.SubmitRequest{}, err
	}
	result.Command = mapped
	return result, nil
}

func MapEvent(record domainevent.Record) (*chat.ConversationEvent, error) {
	wire := &chat.ConversationEvent{
		EventId:            string(record.ID),
		ConversationId:     string(record.ConversationID),
		Sequence:           int64(record.Sequence),
		CommandId:          string(record.CommandID),
		Actor:              endpointToProto(record.Actor),
		PreviousHash:       optionalHashBytes(record.PreviousHash),
		EventHash:          record.Hash.Bytes(),
		CommittedAt:        timestamppb.New(record.CommittedAt),
		MembershipEpoch:    int64(record.MembershipEpoch),
		MlsEpoch:           int64(record.MLSEpoch),
		AuthorityStationId: string(record.AuthorityStation),
	}
	for _, commitment := range record.DeliveryCommitments {
		wire.DeliveryCommitments = append(wire.DeliveryCommitments, commitment.Bytes())
	}
	var source chat.ChatCommand
	if record.Fact.Kind != domainevent.KindConversationCreated {
		if err := proto.Unmarshal(record.Fact.Payload, &source); err != nil {
			return nil, fmt.Errorf("conversation interface: decode event source command: %w", err)
		}
	}
	switch record.Fact.Kind {
	case domainevent.KindConversationCreated:
		created := record.Fact.Created
		if created == nil {
			return nil, invalid("interface.map_event", "fact", "creation fact is missing")
		}
		members := make([]string, 0, len(created.Members))
		for _, member := range created.Members {
			members = append(members, string(member))
		}
		wire.Payload = &chat.ConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedFact{
				Kind:        conversationKindToProto(created.Kind),
				Name:        created.Name,
				OwnerPtid:   string(created.Owner),
				MemberPtids: members,
				PostState:   mapConversationState(record.Fact.PostState),
			},
		}
	case domainevent.KindMessageCommitted:
		intent := source.GetSendMessage()
		if intent == nil {
			return nil, invalid("interface.map_event", "fact", "message command payload is missing")
		}
		wire.Payload = &chat.ConversationEvent_MessageCommitted{
			MessageCommitted: &chat.MessageCommittedFact{
				MessageId:           intent.MessageId,
				Sender:              endpointToProto(record.Actor),
				ContentKind:         intent.ContentKind,
				ReplyToMessageId:    intent.ReplyToMessageId,
				ThreadRootMessageId: intent.ThreadRootMessageId,
				Attachments:         intent.Attachments,
				ClientTimestamp:     source.ClientTimestamp,
			},
		}
	case domainevent.KindMessageEdited:
		intent := source.GetEditMessage()
		if intent == nil {
			return nil, invalid("interface.map_event", "fact", "edit command payload is missing")
		}
		wire.Payload = &chat.ConversationEvent_MessageEdited{
			MessageEdited: &chat.MessageEditedFact{
				MessageId: intent.GetMessageId(),
				Editor:    endpointToProto(record.Actor),
				EditedAt:  timestamppb.New(record.CommittedAt),
			},
		}
	case domainevent.KindMessageRetracted:
		intent := source.GetRetractMessage()
		if intent == nil {
			return nil, invalid("interface.map_event", "fact", "retract command payload is missing")
		}
		wire.Payload = &chat.ConversationEvent_MessageRetracted{
			MessageRetracted: &chat.MessageRetractedFact{
				MessageId:   intent.GetMessageId(),
				Retractor:   endpointToProto(record.Actor),
				RetractedAt: timestamppb.New(record.CommittedAt),
			},
		}
	case domainevent.KindReactionCommitted:
		intent := source.GetReaction()
		if intent == nil {
			return nil, invalid("interface.map_event", "fact", "reaction command payload is missing")
		}
		wire.Payload = &chat.ConversationEvent_ReactionCommitted{
			ReactionCommitted: &chat.ReactionCommittedFact{
				MessageId: intent.GetMessageId(),
				Actor:     endpointToProto(record.Actor),
				Reaction:  intent.GetReaction(),
				Removed:   intent.GetRemove(),
			},
		}
	case domainevent.KindMessagePinCommitted:
		intent := source.GetPinMessage()
		if intent == nil {
			return nil, invalid("interface.map_event", "fact", "pin command payload is missing")
		}
		wire.Payload = &chat.ConversationEvent_MessagePinCommitted{
			MessagePinCommitted: &chat.MessagePinCommittedFact{
				MessageId: intent.GetMessageId(),
				Actor:     endpointToProto(record.Actor),
				Removed:   intent.GetRemove(),
			},
		}
	case domainevent.KindConversationSettings:
		patch := record.Fact.SettingsPatch
		wire.Payload = &chat.ConversationEvent_ConversationUpdated{
			ConversationUpdated: &chat.ConversationUpdatedFact{
				Name:                  patch.Name,
				Description:           patch.Description,
				AvatarObjectId:        patch.AvatarObjectID,
				DisappearTimerSeconds: patch.DisappearTimerSeconds,
				Visibility:            optionalConversationVisibilityToProto(patch.Visibility),
			},
		}
	case domainevent.KindMembershipCommitted:
		intent := source.GetMembershipTransition()
		if intent == nil {
			return nil, invalid("interface.map_event", "fact", "membership command payload is missing")
		}
		wire.Payload = &chat.ConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chat.MembershipTransitionCommittedFact{
				TransitionId:        intent.GetTransitionId(),
				FromMembershipEpoch: intent.GetFromMembershipEpoch(),
				ToMembershipEpoch:   int64(record.MembershipEpoch),
				FromMlsEpoch:        intent.GetFromMlsEpoch(),
				ToMlsEpoch:          intent.GetToMlsEpoch(),
				Changes:             mapCommittedChanges(intent.GetChanges()),
				MlsCommitSha256:     intent.GetMlsCommitSha256(),
				LeaveIntentId:       intent.GetLeaveIntentId(),
				PostState:           mapConversationState(record.Fact.PostState),
			},
		}
	case domainevent.KindConversationDissolved:
		wire.Payload = &chat.ConversationEvent_ConversationDissolved{
			ConversationDissolved: &chat.ConversationDissolvedFact{
				DissolvedByPtid: string(record.Actor.Actor),
			},
		}
	default:
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"interface.map_event",
			"fact",
			"is not mapped by the transport adapter",
		)
	}
	return wire, nil
}

func MapRejectCode(err error) chat.ConversationCommandRejectCode {
	switch conversationdomain.CodeOf(err) {
	case conversationdomain.ErrorCodeCommandConflict:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_CONFLICT
	case conversationdomain.ErrorCodeStaleAuthorityHead:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_STALE_DELIVERY_PLAN
	case conversationdomain.ErrorCodeStaleMembershipEpoch:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_MEMBERSHIP_EPOCH_STALE
	case conversationdomain.ErrorCodeStaleMLSEpoch:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_MLS_EPOCH_MISMATCH
	case conversationdomain.ErrorCodeInactive:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_CONVERSATION_STATE
	case conversationdomain.ErrorCodeReadOnly:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_GROUP_READ_ONLY
	case conversationdomain.ErrorCodeUnauthorized:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_SENDER_UNAUTHORIZED
	case conversationdomain.ErrorCodeDeliverySetMismatch:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_DELIVERY_SET
	case conversationdomain.ErrorCodeAuthorityPlanExpired:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_AUTHORITY_PLAN_EXPIRED
	case conversationdomain.ErrorCodeAuthorityPlanStale,
		conversationdomain.ErrorCodeAuthorityPlanState:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_AUTHORITY_PLAN_STALE
	case conversationdomain.ErrorCodeProposalExpired:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_EXPIRED
	case conversationdomain.ErrorCodeProposalBinding:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH
	case conversationdomain.ErrorCodeProposalSignature:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_ACTOR_SIGNATURE
	case conversationdomain.ErrorCodeActorKeyUnavailable:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_UNAVAILABLE
	case conversationdomain.ErrorCodeActorKeyRevoked:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_REVOKED
	case conversationdomain.ErrorCodeFederationInactive:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INACTIVE_FEDERATION_STATION
	case conversationdomain.ErrorCodeProposalInvalid:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL
	case conversationdomain.ErrorCodeUnsupportedTransition:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSUPPORTED_COMMAND
	case conversationdomain.ErrorCodeInvalidArgument:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL
	case conversationdomain.ErrorCodeNotFound,
		conversationdomain.ErrorCodeMembershipConflict,
		conversationdomain.ErrorCodeDeviceConflict:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_CONVERSATION_STATE
	case conversationdomain.ErrorCodeOwnerProtected:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_PERMISSION_DENIED
	case conversationdomain.ErrorCodeHashChainInvalid:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_GROUP_READ_ONLY
	default:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED
	}
}

func mapContentDeliveries(
	command *chat.ChatCommand,
	conversationKind valueobject.ConversationKind,
	required []valueobject.Endpoint,
	direct []*chat.PreparedEndpointPayload,
	groupPayload []byte,
	groupPayloadHash []byte,
	groupKind valueobject.DeliveryKind,
) ([]valueobject.PreparedDelivery, error) {
	switch conversationKind {
	case valueobject.ConversationKindDirect:
		if len(groupPayload) != 0 || len(groupPayloadHash) != 0 {
			return nil, deliverySetMismatch(
				"interface.map_content_deliveries",
				"mls_application_payload",
				"is not allowed for a Direct conversation",
			)
		}
	case valueobject.ConversationKindGroup:
		if len(direct) != 0 || len(groupPayload) == 0 {
			return nil, deliverySetMismatch(
				"interface.map_content_deliveries",
				"payload",
				"a Group conversation requires one MLS application payload",
			)
		}
	default:
		return nil, invalid(
			"interface.map_content_deliveries",
			"conversation_kind",
			"is invalid",
		)
	}
	if len(groupPayload) > 0 && len(direct) > 0 {
		return nil, invalid(
			"interface.map_content_deliveries",
			"payload",
			"cannot contain both direct and group payloads",
		)
	}
	directByEndpoint := make(map[string]*chat.PreparedEndpointPayload, len(direct))
	for _, payload := range direct {
		if payload == nil || payload.Recipient == nil {
			return nil, invalid("interface.map_content_deliveries", "direct_payload", "recipient is required")
		}
		endpoint, err := valueobject.NewEndpoint(payload.Recipient.Ptid, payload.Recipient.DeviceId)
		if err != nil {
			return nil, err
		}
		if payload.Kind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT {
			return nil, deliverySetMismatch(
				"interface.map_content_deliveries",
				"direct_payload.kind",
				"must be direct ciphertext",
			)
		}
		if err := validatePayloadHash(
			"interface.map_content_deliveries",
			"direct_payload.payload_sha256",
			payload.OpaquePayload,
			payload.PayloadSha256,
		); err != nil {
			return nil, err
		}
		if _, duplicate := directByEndpoint[endpoint.Key()]; duplicate {
			return nil, deliverySetMismatch(
				"interface.map_content_deliveries",
				"direct_payload.recipient",
				"is duplicated",
			)
		}
		directByEndpoint[endpoint.Key()] = payload
	}
	var groupHash valueobject.Hash
	if len(groupPayload) > 0 {
		if err := validatePayloadHash(
			"interface.map_content_deliveries",
			"mls_application_payload_sha256",
			groupPayload,
			groupPayloadHash,
		); err != nil {
			return nil, err
		}
		groupHash, _ = valueobject.NewHash(groupPayloadHash)
	}
	deliveries := make([]valueobject.PreparedDelivery, 0, len(required))
	for _, endpoint := range required {
		if endpoint == (valueobject.Endpoint{
			Actor:  valueobject.PTID(command.Sender.Ptid),
			Device: valueobject.DeviceID(command.Sender.DeviceId),
		}) {
			if _, supplied := directByEndpoint[endpoint.Key()]; supplied {
				return nil, deliverySetMismatch(
					"interface.map_content_deliveries",
					"direct_payload.recipient",
					"must not target the sending endpoint",
				)
			}
			delivery, err := publicDelivery(command, endpoint)
			if err != nil {
				return nil, err
			}
			deliveries = append(deliveries, delivery)
			continue
		}
		if len(groupPayload) > 0 {
			deliveries = append(deliveries, preparedDeliveryWithHash(
				endpoint,
				groupKind,
				groupPayload,
				groupHash,
			))
			continue
		}
		payload := directByEndpoint[endpoint.Key()]
		if payload == nil {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"interface.map_content_deliveries",
				"direct_payloads",
				"does not cover every required endpoint",
			)
		}
		hash, _ := valueobject.NewHash(payload.PayloadSha256)
		deliveries = append(deliveries, preparedDeliveryWithHash(
			endpoint,
			deliveryKind(payload.Kind),
			payload.OpaquePayload,
			hash,
		))
		delete(directByEndpoint, endpoint.Key())
	}
	if len(directByEndpoint) != 0 {
		return nil, deliverySetMismatch(
			"interface.map_content_deliveries",
			"direct_payloads",
			"contains a recipient outside the required endpoint set",
		)
	}
	return deliveries, nil
}

func mapPublicDeliveries(
	command *chat.ChatCommand,
	required []valueobject.Endpoint,
) ([]valueobject.PreparedDelivery, error) {
	deliveries := make([]valueobject.PreparedDelivery, 0, len(required))
	for _, endpoint := range required {
		delivery, err := publicDelivery(command, endpoint)
		if err != nil {
			return nil, err
		}
		deliveries = append(deliveries, delivery)
	}
	return deliveries, nil
}

func mapMembershipDeliveries(
	command *chat.ChatCommand,
	intent *chat.MembershipTransitionIntent,
	plan entity.AuthorityPlan,
) ([]valueobject.PreparedDelivery, error) {
	eventID := valueobject.DeterministicEventID(
		valueobject.ConversationID(command.ConversationId),
		valueobject.CommandID(command.CommandId),
	)
	if err := validatePayloadHash(
		"interface.map_membership_deliveries",
		"mls_commit_sha256",
		intent.MlsCommit,
		intent.MlsCommitSha256,
	); err != nil {
		return nil, err
	}
	welcomeByEndpoint := make(map[string]*chat.PreparedEndpointPayload, len(intent.WelcomePayloads))
	for _, welcome := range intent.WelcomePayloads {
		if welcome == nil || welcome.Recipient == nil {
			return nil, invalid("interface.map_membership_deliveries", "welcome", "recipient is required")
		}
		endpoint, err := valueobject.NewEndpoint(welcome.Recipient.Ptid, welcome.Recipient.DeviceId)
		if err != nil {
			return nil, err
		}
		if welcome.Kind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME {
			return nil, deliverySetMismatch(
				"interface.map_membership_deliveries",
				"welcome.kind",
				"must be an MLS Welcome",
			)
		}
		if err := validatePayloadHash(
			"interface.map_membership_deliveries",
			"welcome.payload_sha256",
			welcome.OpaquePayload,
			welcome.PayloadSha256,
		); err != nil {
			return nil, err
		}
		if _, duplicate := welcomeByEndpoint[endpoint.Key()]; duplicate {
			return nil, deliverySetMismatch(
				"interface.map_membership_deliveries",
				"welcome.recipient",
				"is duplicated",
			)
		}
		welcomeByEndpoint[endpoint.Key()] = welcome
	}
	added := endpointSet(plan.AddedEndpoints)
	removed := endpointSet(plan.RemovedEndpoints)
	post := endpointSet(plan.PostEndpoints)
	sender := valueobject.Endpoint{
		Actor:  valueobject.PTID(command.Sender.Ptid),
		Device: valueobject.DeviceID(command.Sender.DeviceId),
	}
	deliveries := make([]valueobject.PreparedDelivery, 0, len(plan.PreEndpoints)+len(plan.PostEndpoints))
	for _, endpoint := range endpointUnion(plan.PreEndpoints, plan.PostEndpoints) {
		switch {
		case containsEndpoint(removed, endpoint):
			payload, err := deterministicProto(&chat.MlsRetirementMarker{
				ConversationId:  command.ConversationId,
				EventId:         string(eventID),
				TransitionId:    intent.TransitionId,
				RemovedEndpoint: endpointToProto(endpoint),
			})
			if err != nil {
				return nil, err
			}
			deliveries = append(deliveries, preparedDelivery(
				endpoint,
				valueobject.DeliveryKindMLSRetirement,
				payload,
			))
		case containsEndpoint(added, endpoint):
			welcome := welcomeByEndpoint[endpoint.Key()]
			if welcome == nil {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeDeliverySetMismatch,
					"interface.map_membership_deliveries",
					"welcome_payloads",
					"does not cover every added endpoint",
				)
			}
			payload, err := wrapMlsTransitionPayload(
				chat.MlsQueuePayloadKind_MLS_QUEUE_PAYLOAD_KIND_WELCOME,
				command,
				intent,
				endpoint,
				eventID,
				plan.AuthorityHead.Sequence.Next(),
				plan.AuthorityHead.MembershipEpoch.Next(),
				valueobject.Epoch(intent.ToMlsEpoch),
				welcome.OpaquePayload,
				welcome.PayloadSha256,
			)
			if err != nil {
				return nil, err
			}
			deliveries = append(deliveries, preparedDelivery(
				endpoint,
				valueobject.DeliveryKindMLSWelcome,
				payload,
			))
			delete(welcomeByEndpoint, endpoint.Key())
		case endpoint == sender:
			delivery, err := publicDelivery(command, endpoint)
			if err != nil {
				return nil, err
			}
			deliveries = append(deliveries, delivery)
		case containsEndpoint(post, endpoint):
			payload, err := wrapMlsTransitionPayload(
				chat.MlsQueuePayloadKind_MLS_QUEUE_PAYLOAD_KIND_COMMIT,
				command,
				intent,
				endpoint,
				eventID,
				plan.AuthorityHead.Sequence.Next(),
				plan.AuthorityHead.MembershipEpoch.Next(),
				valueobject.Epoch(intent.ToMlsEpoch),
				intent.MlsCommit,
				intent.MlsCommitSha256,
			)
			if err != nil {
				return nil, err
			}
			deliveries = append(deliveries, preparedDelivery(
				endpoint,
				valueobject.DeliveryKindMLSCommit,
				payload,
			))
		default:
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"interface.map_membership_deliveries",
				"endpoint",
				"is outside the authority plan",
			)
		}
	}
	if len(welcomeByEndpoint) != 0 {
		return nil, deliverySetMismatch(
			"interface.map_membership_deliveries",
			"welcome_payloads",
			"contains a recipient outside the added endpoint set",
		)
	}
	return deliveries, nil
}

func publicDelivery(
	command *chat.ChatCommand,
	endpoint valueobject.Endpoint,
) (valueobject.PreparedDelivery, error) {
	eventID := valueobject.DeterministicEventID(
		valueobject.ConversationID(command.ConversationId),
		valueobject.CommandID(command.CommandId),
	)
	payload, err := deterministicProto(&chat.PublicEventMarker{
		ConversationId:  command.ConversationId,
		EventId:         string(eventID),
		CommandId:       command.CommandId,
		SendingEndpoint: command.Sender,
	})
	if err != nil {
		return valueobject.PreparedDelivery{}, err
	}
	return preparedDelivery(endpoint, valueobject.DeliveryKindPublicEvent, payload), nil
}

func preparedDelivery(
	endpoint valueobject.Endpoint,
	kind valueobject.DeliveryKind,
	payload []byte,
) valueobject.PreparedDelivery {
	copy := append([]byte(nil), payload...)
	return valueobject.PreparedDelivery{
		Recipient:   endpoint,
		Kind:        kind,
		Opaque:      copy,
		PayloadHash: valueobject.HashBytes(copy),
	}
}

func preparedDeliveryWithHash(
	endpoint valueobject.Endpoint,
	kind valueobject.DeliveryKind,
	payload []byte,
	hash valueobject.Hash,
) valueobject.PreparedDelivery {
	copy := append([]byte(nil), payload...)
	return valueobject.PreparedDelivery{
		Recipient:   endpoint,
		Kind:        kind,
		Opaque:      copy,
		PayloadHash: hash,
	}
}

func wrapMlsTransitionPayload(
	kind chat.MlsQueuePayloadKind,
	command *chat.ChatCommand,
	intent *chat.MembershipTransitionIntent,
	recipient valueobject.Endpoint,
	eventID valueobject.EventID,
	authoritySequence valueobject.Sequence,
	toMembershipEpoch valueobject.Epoch,
	toMLSEpoch valueobject.Epoch,
	opaque []byte,
	payloadHash []byte,
) ([]byte, error) {
	return deterministicProto(&chat.MlsQueuePayload{
		Kind:                kind,
		ConversationId:      command.ConversationId,
		TransitionId:        intent.TransitionId,
		EventId:             string(eventID),
		AuthoritySequence:   int64(authoritySequence),
		FromMembershipEpoch: intent.FromMembershipEpoch,
		ToMembershipEpoch:   int64(toMembershipEpoch),
		FromMlsEpoch:        intent.FromMlsEpoch,
		ToMlsEpoch:          int64(toMLSEpoch),
		Recipient:           endpointToProto(recipient),
		OpaqueMlsBytes:      append([]byte(nil), opaque...),
		PayloadSha256:       append([]byte(nil), payloadHash...),
	})
}

func validatePayloadHash(
	operation string,
	field string,
	payload []byte,
	declared []byte,
) error {
	hash, err := valueobject.NewHash(declared)
	if err != nil || len(payload) == 0 {
		return deliverySetMismatch(operation, field, "is missing or malformed")
	}
	actual := valueobject.HashBytes(payload)
	if !bytes.Equal(actual[:], hash[:]) {
		return deliverySetMismatch(operation, field, "does not match the payload")
	}
	return nil
}

func deterministicProto(message proto.Message) ([]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("conversation interface: encode endpoint payload: %w", err)
	}
	return encoded, nil
}

func deliverySetMismatch(operation string, field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeDeliverySetMismatch,
		operation,
		field,
		message,
	)
}

func mapMembershipChanges(
	changes []*chat.MessagingMembershipChangeIntent,
) []entity.MembershipChange {
	mapped := make([]entity.MembershipChange, 0, len(changes))
	for _, change := range changes {
		if change == nil {
			continue
		}
		mapped = append(mapped, entity.MembershipChange{
			Action:      membershipAction(change.Action),
			Actor:       valueobject.PTID(change.Ptid),
			Device:      valueobject.DeviceID(change.DeviceId),
			HomeStation: valueobject.StationID(change.HomeStationId),
			Role:        valueobject.MemberRole(change.Role),
		})
	}
	return mapped
}

func mapCommittedChanges(
	changes []*chat.MessagingMembershipChangeIntent,
) []*chat.MessagingMembershipChangeCommitted {
	mapped := make([]*chat.MessagingMembershipChangeCommitted, 0, len(changes))
	for _, change := range changes {
		if change == nil {
			continue
		}
		mapped = append(mapped, &chat.MessagingMembershipChangeCommitted{
			Action:        change.Action,
			Ptid:          change.Ptid,
			DeviceId:      change.DeviceId,
			HomeStationId: change.HomeStationId,
			Role:          change.Role,
		})
	}
	return mapped
}

func membershipAction(action chat.MessagingMembershipAction) entity.MembershipAction {
	switch action {
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR:
		return entity.MembershipActionAddActor
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR:
		return entity.MembershipActionRemoveActor
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_LEAVE:
		return entity.MembershipActionLeave
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_CHANGE_ROLE:
		return entity.MembershipActionChangeRole
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE:
		return entity.MembershipActionAddDevice
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE:
		return entity.MembershipActionRemoveDevice
	default:
		return ""
	}
}

func deliveryKind(kind chat.PreparedEndpointPayloadKind) valueobject.DeliveryKind {
	switch kind {
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT:
		return valueobject.DeliveryKindDirectCiphertext
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_APPLICATION:
		return valueobject.DeliveryKindMLSApplication
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_COMMIT:
		return valueobject.DeliveryKindMLSCommit
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME:
		return valueobject.DeliveryKindMLSWelcome
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT:
		return valueobject.DeliveryKindPublicEvent
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_CONVERSATION_STATE:
		return valueobject.DeliveryKindConversation
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_RETIREMENT:
		return valueobject.DeliveryKindMLSRetirement
	default:
		return ""
	}
}

func mapSettingsPatch(intent *chat.UpdateConversationIntent) *valueobject.SettingsPatch {
	if intent == nil {
		return nil
	}
	return &valueobject.SettingsPatch{
		Name:                  intent.Name,
		Description:           intent.Description,
		AvatarObjectID:        intent.AvatarObjectId,
		Visibility:            conversationVisibilityFromProto(intent.Visibility),
		DisappearTimerSeconds: intent.DisappearTimerSeconds,
	}
}

func objectIDs(descriptors []*chat.EncryptedObjectDescriptor) []valueobject.ObjectID {
	ids := make([]valueobject.ObjectID, 0, len(descriptors))
	for _, descriptor := range descriptors {
		if descriptor != nil && descriptor.ObjectId != "" {
			ids = append(ids, valueobject.ObjectID(descriptor.ObjectId))
		}
	}
	return ids
}

func endpointUnion(left []valueobject.Endpoint, right []valueobject.Endpoint) []valueobject.Endpoint {
	byKey := make(map[string]valueobject.Endpoint, len(left)+len(right))
	for _, endpoint := range append(append([]valueobject.Endpoint(nil), left...), right...) {
		byKey[endpoint.Key()] = endpoint
	}
	result := make([]valueobject.Endpoint, 0, len(byKey))
	for _, endpoint := range byKey {
		result = append(result, endpoint)
	}
	return valueobject.SortEndpoints(result)
}

func endpointSet(endpoints []valueobject.Endpoint) map[string]struct{} {
	set := make(map[string]struct{}, len(endpoints))
	for _, endpoint := range endpoints {
		set[endpoint.Key()] = struct{}{}
	}
	return set
}

func containsEndpoint(set map[string]struct{}, endpoint valueobject.Endpoint) bool {
	_, exists := set[endpoint.Key()]
	return exists
}

func endpointToProto(endpoint valueobject.Endpoint) *chat.CryptoEndpoint {
	return &chat.CryptoEndpoint{
		Ptid:     string(endpoint.Actor),
		DeviceId: string(endpoint.Device),
	}
}

func conversationKindToProto(kind valueobject.ConversationKind) chat.ConversationKind {
	switch kind {
	case valueobject.ConversationKindDirect:
		return chat.ConversationKind_CONVERSATION_KIND_DIRECT
	case valueobject.ConversationKindGroup:
		return chat.ConversationKind_CONVERSATION_KIND_GROUP
	default:
		return chat.ConversationKind_CONVERSATION_KIND_UNSPECIFIED
	}
}

func mapConversationState(
	state *domainevent.ConversationState,
) *chat.ConversationAuthoritySnapshot {
	if state == nil {
		return nil
	}
	members := make([]*chat.ConversationAuthorityMember, 0, len(state.ActiveMembers))
	for _, member := range state.ActiveMembers {
		members = append(members, &chat.ConversationAuthorityMember{
			Ptid:          string(member.Actor),
			Role:          string(member.Role),
			HomeStationId: string(member.HomeStation),
		})
	}
	endpoints := make([]*chat.CryptoEndpoint, 0, len(state.ActiveEndpoints))
	for _, endpoint := range state.ActiveEndpoints {
		endpoints = append(endpoints, endpointToProto(endpoint))
	}
	endpointRoutes := make(
		[]*chat.ConversationAuthorityEndpoint,
		0,
		len(state.ActiveDevices),
	)
	for _, device := range state.ActiveDevices {
		endpointRoutes = append(endpointRoutes, &chat.ConversationAuthorityEndpoint{
			Endpoint:      endpointToProto(device.Endpoint),
			HomeStationId: string(device.HomeStation),
		})
	}
	return &chat.ConversationAuthoritySnapshot{
		Kind:                  conversationKindToProto(state.Kind),
		Name:                  state.Settings.Name,
		OwnerPtid:             string(state.Owner),
		ActiveMembers:         members,
		ActiveEndpoints:       endpoints,
		MembershipEpoch:       int64(state.MembershipEpoch),
		MlsEpoch:              int64(state.MLSEpoch),
		ActiveEndpointRoutes:  endpointRoutes,
		FederationId:          string(state.FederationID),
		AuthorityEpoch:        int64(state.AuthorityEpoch),
		Description:           state.Settings.Description,
		AvatarObjectId:        state.Settings.AvatarObjectID,
		Visibility:            conversationVisibilityToProto(state.Settings.Visibility),
		DisappearTimerSeconds: state.Settings.DisappearTimerSeconds,
	}
}

func conversationVisibilityFromProto(
	visibility *chat.GroupVisibilityV1,
) *valueobject.ConversationVisibility {
	if visibility == nil {
		return nil
	}
	mapped := valueobject.ConversationVisibility("")
	switch *visibility {
	case chat.GroupVisibilityV1_GROUP_VISIBILITY_V1_PUBLIC:
		mapped = valueobject.ConversationVisibilityPublic
	case chat.GroupVisibilityV1_GROUP_VISIBILITY_V1_PRIVATE:
		mapped = valueobject.ConversationVisibilityPrivate
	}
	return &mapped
}

func optionalConversationVisibilityToProto(
	visibility *valueobject.ConversationVisibility,
) *chat.GroupVisibilityV1 {
	if visibility == nil {
		return nil
	}
	mapped := conversationVisibilityToProto(*visibility)
	return &mapped
}

func conversationVisibilityToProto(
	visibility valueobject.ConversationVisibility,
) chat.GroupVisibilityV1 {
	switch visibility {
	case valueobject.ConversationVisibilityPublic:
		return chat.GroupVisibilityV1_GROUP_VISIBILITY_V1_PUBLIC
	case valueobject.ConversationVisibilityPrivate:
		return chat.GroupVisibilityV1_GROUP_VISIBILITY_V1_PRIVATE
	default:
		return chat.GroupVisibilityV1_GROUP_VISIBILITY_V1_UNSPECIFIED
	}
}

func optionalHashBytes(hash valueobject.Hash) []byte {
	if hash.IsZero() {
		return nil
	}
	return hash.Bytes()
}

func invalid(operation string, field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		operation,
		field,
		message,
	)
}
