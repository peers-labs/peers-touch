package aggregate

import (
	"bytes"
	"fmt"
	"sort"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type Participant struct {
	Actor       valueobject.PTID
	HomeStation valueobject.StationID
	Role        valueobject.MemberRole
}

type CreateInput struct {
	ID               valueobject.ConversationID
	Kind             valueobject.ConversationKind
	FederationID     valueobject.FederationID
	AuthorityStation valueobject.StationID
	AuthorityEpoch   valueobject.AuthorityEpoch
	Owner            valueobject.PTID
	Participants     []Participant
	Devices          []entity.MemberDevice
	Settings         valueobject.ConversationSettings
	CommandID        valueobject.CommandID
	Creator          valueobject.Endpoint
	Deliveries       []valueobject.PreparedDelivery
	EventPayload     []byte
	CreatedAt        time.Time
	EventSealer      domainevent.Sealer
}

type Snapshot struct {
	ID               valueobject.ConversationID
	Kind             valueobject.ConversationKind
	Status           valueobject.ConversationStatus
	FederationID     valueobject.FederationID
	AuthorityStation valueobject.StationID
	AuthorityEpoch   valueobject.AuthorityEpoch
	Owner            valueobject.PTID
	Head             valueobject.AuthorityHead
	Settings         valueobject.ConversationSettings
	Members          []entity.Member
	Devices          []entity.MemberDevice
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type Conversation struct {
	id               valueobject.ConversationID
	kind             valueobject.ConversationKind
	status           valueobject.ConversationStatus
	federationID     valueobject.FederationID
	authorityStation valueobject.StationID
	authorityEpoch   valueobject.AuthorityEpoch
	owner            valueobject.PTID
	head             valueobject.AuthorityHead
	settings         valueobject.ConversationSettings
	members          map[valueobject.PTID]entity.Member
	devices          map[string]entity.MemberDevice
	createdAt        time.Time
	updatedAt        time.Time
}

type Command struct {
	ID                      valueobject.CommandID
	ConversationID          valueobject.ConversationID
	AuthorityStation        valueobject.StationID
	Sender                  valueobject.Endpoint
	ObservedMembershipEpoch valueobject.Epoch
	ObservedMLSEpoch        valueobject.Epoch
	DeliveryPlanHash        valueobject.Hash
	Kind                    domainevent.Kind
	MessageID               valueobject.MessageID
	ReplyToMessageID        valueobject.MessageID
	ThreadRootMessageID     valueobject.MessageID
	Reaction                string
	Payload                 []byte
	Deliveries              []valueobject.PreparedDelivery
	RequiredEndpoints       []valueobject.Endpoint
	ObjectIDs               []valueobject.ObjectID
	CommittedAt             time.Time
	EventSealer             domainevent.Sealer
}

type MembershipTransition struct {
	Command
	TransitionID      valueobject.TransitionID
	AuthorityPlanID   valueobject.PlanID
	AuthorityPlanHash valueobject.Hash
	FromMembership    valueobject.Epoch
	FromMLS           valueobject.Epoch
	ToMLS             valueobject.Epoch
	Changes           []entity.MembershipChange
	PreEndpoints      []valueobject.Endpoint
	PostEndpoints     []valueobject.Endpoint
	LeaveIntentID     string
}

type MemberAuthorityCommand struct {
	Command
	Action                 domainevent.MemberAuthorityAction
	Target                 valueobject.PTID
	Role                   *valueobject.MemberRole
	Muted                  *bool
	MutedUntil             *time.Time
	ObservedAuthorityHead  valueobject.AuthorityHead
	ObservedFederationID   valueobject.FederationID
	ObservedAuthorityEpoch valueobject.AuthorityEpoch
	Deadline               time.Time
}

type SettingsCommand struct {
	Command
	Patch valueobject.SettingsPatch
}

type DissolveCommand struct {
	Command
}

type CommandPreparation struct {
	Kind              valueobject.ConversationKind
	AuthorityStation  valueobject.StationID
	Head              valueobject.AuthorityHead
	RequiredEndpoints []valueobject.Endpoint
	DeliveryPlanHash  valueobject.Hash
}

type MembershipPreview struct {
	Head             valueobject.AuthorityHead
	PreEndpoints     []valueobject.Endpoint
	PostEndpoints    []valueobject.Endpoint
	AddedEndpoints   []valueobject.Endpoint
	RemovedEndpoints []valueobject.Endpoint
}

type Transition struct {
	Event           domainevent.Record
	Deliveries      []valueobject.PreparedDelivery
	ObjectIDs       []valueobject.ObjectID
	RecipientActors []valueobject.PTID
}

func CreateDirect(input CreateInput) (*Conversation, Transition, error) {
	if input.Kind == "" {
		input.Kind = valueobject.ConversationKindDirect
	}
	if input.Kind != valueobject.ConversationKindDirect || len(input.Participants) != 2 {
		return nil, Transition{}, invalid("aggregate.create_direct", "participants", "direct conversation requires two participants")
	}
	computedID, err := valueobject.DirectConversationID(
		input.Participants[0].Actor,
		input.Participants[1].Actor,
	)
	if err != nil {
		return nil, Transition{}, err
	}
	if input.ID == "" {
		input.ID = computedID
	}
	if input.ID != computedID {
		return nil, Transition{}, invalid("aggregate.create_direct", "conversation_id", "does not match the participant pair")
	}
	input.Owner = input.Participants[0].Actor
	if input.Participants[1].Actor < input.Owner {
		input.Owner = input.Participants[1].Actor
	}
	for index := range input.Participants {
		input.Participants[index].Role = valueobject.MemberRoleMember
	}
	return create(input, valueobject.Epoch(1), 0)
}

func CreateGroup(input CreateInput) (*Conversation, Transition, error) {
	if input.Kind == "" {
		input.Kind = valueobject.ConversationKindGroup
	}
	if input.Kind != valueobject.ConversationKindGroup || input.Owner == "" ||
		len(input.Participants) == 0 {
		return nil, Transition{}, invalid("aggregate.create_group", "participants", "group owner and participants are required")
	}
	for index := range input.Participants {
		if input.Participants[index].Actor == input.Owner {
			input.Participants[index].Role = valueobject.MemberRoleOwner
		} else if input.Participants[index].Role == "" {
			input.Participants[index].Role = valueobject.MemberRoleMember
		}
	}
	return create(input, valueobject.Epoch(1), valueobject.Epoch(1))
}

func create(
	input CreateInput,
	membershipEpoch valueobject.Epoch,
	mlsEpoch valueobject.Epoch,
) (*Conversation, Transition, error) {
	if input.ID == "" || input.FederationID == "" ||
		input.AuthorityStation == "" || input.AuthorityEpoch == 0 ||
		input.CommandID == "" ||
		input.Creator.Validate() != nil || input.CreatedAt.IsZero() {
		return nil, Transition{}, invalid("aggregate.create", "input", "complete creation identity and time are required")
	}
	if err := input.Kind.Validate(); err != nil {
		return nil, Transition{}, err
	}
	if err := input.Settings.Validate(); err != nil {
		return nil, Transition{}, err
	}
	conversation := &Conversation{
		id:               input.ID,
		kind:             input.Kind,
		status:           valueobject.ConversationStatusActive,
		federationID:     input.FederationID,
		authorityStation: input.AuthorityStation,
		authorityEpoch:   input.AuthorityEpoch,
		owner:            input.Owner,
		head: valueobject.AuthorityHead{
			MembershipEpoch: membershipEpoch,
			MLSEpoch:        mlsEpoch,
		},
		settings:  input.Settings,
		members:   make(map[valueobject.PTID]entity.Member, len(input.Participants)),
		devices:   make(map[string]entity.MemberDevice, len(input.Devices)),
		createdAt: input.CreatedAt.UTC(),
		updatedAt: input.CreatedAt.UTC(),
	}
	for _, participant := range input.Participants {
		if participant.Actor == "" || participant.HomeStation == "" {
			return nil, Transition{}, invalid("aggregate.create", "participant", "actor and home Station are required")
		}
		if _, duplicate := conversation.members[participant.Actor]; duplicate {
			return nil, Transition{}, invalid("aggregate.create", "participants", "contains a duplicate actor")
		}
		member, err := entity.NewMember(
			participant.Actor,
			participant.Role,
			participant.HomeStation,
			1,
		)
		if err != nil {
			return nil, Transition{}, err
		}
		conversation.members[participant.Actor] = member
	}
	owner, ownerExists := conversation.members[input.Owner]
	if !ownerExists || owner.Role != valueobject.MemberRoleOwner && input.Kind == valueobject.ConversationKindGroup {
		return nil, Transition{}, invalid("aggregate.create", "owner", "must be an active owner participant")
	}
	for _, device := range input.Devices {
		if err := device.Validate(); err != nil {
			return nil, Transition{}, err
		}
		if !device.Active || device.JoinedAt != 1 {
			return nil, Transition{}, invalid(
				"aggregate.create",
				"devices",
				"all initial devices must be active and joined at the genesis sequence",
			)
		}
		member, memberExists := conversation.members[device.Endpoint.Actor]
		if !memberExists || !member.Active() {
			return nil, Transition{}, invalid("aggregate.create", "devices", "device actor is not an active member")
		}
		if device.HomeStation != member.HomeStation {
			return nil, Transition{}, invalid(
				"aggregate.create",
				"devices",
				"device Home Station must match its actor membership",
			)
		}
		key := device.Endpoint.Key()
		if _, duplicate := conversation.devices[key]; duplicate {
			return nil, Transition{}, invalid("aggregate.create", "devices", "contains a duplicate endpoint")
		}
		conversation.devices[key] = device
	}
	if err := conversation.validateState(1); err != nil {
		return nil, Transition{}, err
	}
	if !conversation.isActiveEndpoint(input.Creator) {
		return nil, Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.create",
			"creator",
			"must be an active member device",
		)
	}
	required := conversation.ActiveEndpoints()
	if err := domainservice.ValidateExactDeliverySet(required, input.Deliveries); err != nil {
		return nil, Transition{}, err
	}
	if err := conversation.validateCreationDeliveryKinds(input.Creator, input.Deliveries); err != nil {
		return nil, Transition{}, err
	}
	createdFact := domainevent.NewConversationCreatedFact(input.EventPayload)
	createdFact.Created = &domainevent.ConversationCreated{
		Kind:    conversation.kind,
		Name:    conversation.settings.Name,
		Owner:   conversation.owner,
		Members: conversation.ActiveMemberActors(),
	}
	createdFact.PostState = conversation.eventState()
	transition, err := conversation.commit(
		input.CommandID,
		input.Creator,
		createdFact,
		input.Deliveries,
		nil,
		input.CreatedAt,
		input.EventSealer,
	)
	if err != nil {
		return nil, Transition{}, err
	}
	return conversation, transition, nil
}

func Rehydrate(snapshot Snapshot) (*Conversation, error) {
	if snapshot.ID == "" || snapshot.FederationID == "" ||
		snapshot.AuthorityStation == "" || snapshot.AuthorityEpoch == 0 ||
		snapshot.Owner == "" ||
		snapshot.CreatedAt.IsZero() || snapshot.UpdatedAt.IsZero() {
		return nil, invalid("aggregate.rehydrate", "snapshot", "persisted aggregate is incomplete")
	}
	if err := snapshot.Kind.Validate(); err != nil {
		return nil, err
	}
	if err := snapshot.Status.Validate(); err != nil {
		return nil, err
	}
	if err := snapshot.Settings.Validate(); err != nil {
		return nil, err
	}
	if snapshot.UpdatedAt.Before(snapshot.CreatedAt) {
		return nil, invalid(
			"aggregate.rehydrate",
			"updated_at",
			"cannot precede the creation time",
		)
	}
	if snapshot.Head.Sequence == 0 && !snapshot.Head.EventHash.IsZero() ||
		snapshot.Head.Sequence > 0 && snapshot.Head.EventHash.IsZero() {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"aggregate.rehydrate",
			"authority_head",
			"sequence and event hash disagree",
		)
	}
	if snapshot.Kind == valueobject.ConversationKindGroup &&
		(snapshot.Head.MembershipEpoch == 0 ||
			snapshot.Head.MLSEpoch == 0 ||
			snapshot.Head.MembershipEpoch < snapshot.Head.MLSEpoch) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleMembershipEpoch,
			"aggregate.rehydrate",
			"authority_head",
			"group membership epoch must be at least the non-zero MLS epoch",
		)
	}
	conversation := &Conversation{
		id:               snapshot.ID,
		kind:             snapshot.Kind,
		status:           snapshot.Status,
		federationID:     snapshot.FederationID,
		authorityStation: snapshot.AuthorityStation,
		authorityEpoch:   snapshot.AuthorityEpoch,
		owner:            snapshot.Owner,
		head:             snapshot.Head,
		settings:         snapshot.Settings,
		members:          make(map[valueobject.PTID]entity.Member, len(snapshot.Members)),
		devices:          make(map[string]entity.MemberDevice, len(snapshot.Devices)),
		createdAt:        snapshot.CreatedAt.UTC(),
		updatedAt:        snapshot.UpdatedAt.UTC(),
	}
	for _, member := range snapshot.Members {
		if _, duplicate := conversation.members[member.Actor]; duplicate {
			return nil, invalid(
				"aggregate.rehydrate",
				"members",
				"contains a duplicate actor",
			)
		}
		conversation.members[member.Actor] = member
	}
	for _, device := range snapshot.Devices {
		key := device.Endpoint.Key()
		if _, duplicate := conversation.devices[key]; duplicate {
			return nil, invalid(
				"aggregate.rehydrate",
				"devices",
				"contains a duplicate endpoint",
			)
		}
		conversation.devices[key] = device
	}
	if err := conversation.validateState(snapshot.Head.Sequence); err != nil {
		return nil, err
	}
	return conversation, nil
}

// ReconcileCommittedMembershipProjection validates authority-visible state and
// restores lifecycle metadata that is intentionally absent from the wire snapshot.
func ReconcileCommittedMembershipProjection(
	current Snapshot,
	changes []entity.MembershipChange,
	post Snapshot,
) (Snapshot, error) {
	conversation, err := Rehydrate(current)
	if err != nil {
		return Snapshot{}, err
	}
	if conversation.kind != valueobject.ConversationKindGroup {
		return Snapshot{},
			membershipProjectionError("membership transition requires a group Conversation")
	}
	if post.ID != current.ID ||
		post.Kind != current.Kind ||
		post.Status != current.Status ||
		post.FederationID != current.FederationID ||
		post.AuthorityStation != current.AuthorityStation ||
		post.AuthorityEpoch != current.AuthorityEpoch ||
		post.Owner != current.Owner ||
		post.Settings != current.Settings ||
		!post.CreatedAt.Equal(current.CreatedAt) ||
		post.Head.Sequence != current.Head.Sequence.Next() ||
		post.Head.MembershipEpoch != current.Head.MembershipEpoch.Next() ||
		post.Head.MLSEpoch != current.Head.MLSEpoch.Next() {
		return Snapshot{}, membershipProjectionError(
			"post-state scope, metadata, or authority head does not match the transition",
		)
	}
	if err := validateMembershipChangeBatch(changes); err != nil {
		return Snapshot{}, membershipProjectionError(err.Error())
	}
	candidate := conversation.clone()
	for _, change := range changes {
		if err := candidate.applyMembershipChange(change, post.Head.Sequence); err != nil {
			return Snapshot{}, membershipProjectionError(err.Error())
		}
	}
	candidate.head.MembershipEpoch = post.Head.MembershipEpoch
	candidate.head.MLSEpoch = post.Head.MLSEpoch
	if err := candidate.validateState(post.Head.Sequence); err != nil {
		return Snapshot{}, membershipProjectionError(err.Error())
	}
	expectedMembers := activeMembers(candidate.Members())
	expectedDevices := activeDevices(candidate.MemberDevices())
	if !equalCommittedMembers(expectedMembers, post.Members) ||
		!equalCommittedMemberDevices(expectedDevices, post.Devices) {
		return Snapshot{}, membershipProjectionError(
			"declared membership changes do not produce the committed post-state",
		)
	}
	post.Members = expectedMembers
	post.Devices = expectedDevices

	return post, nil
}

func ReconcileCommittedMemberAuthorityProjection(
	current Snapshot,
	mutation domainevent.MemberAuthorityMutation,
	post Snapshot,
) (Snapshot, error) {
	conversation, err := Rehydrate(current)
	if err != nil {
		return Snapshot{}, err
	}
	if conversation.kind != valueobject.ConversationKindGroup {
		return Snapshot{}, membershipProjectionError(
			"member authority transition requires a group Conversation",
		)
	}
	if post.ID != current.ID ||
		post.Kind != current.Kind ||
		post.Status != current.Status ||
		post.FederationID != current.FederationID ||
		post.AuthorityStation != current.AuthorityStation ||
		post.AuthorityEpoch != current.AuthorityEpoch ||
		post.Settings != current.Settings ||
		!post.CreatedAt.Equal(current.CreatedAt) ||
		post.Head.Sequence != current.Head.Sequence.Next() ||
		post.Head.MembershipEpoch != current.Head.MembershipEpoch.Next() ||
		post.Head.MLSEpoch != current.Head.MLSEpoch ||
		mutation.FromMembershipEpoch != current.Head.MembershipEpoch ||
		mutation.ToMembershipEpoch != post.Head.MembershipEpoch {
		return Snapshot{}, membershipProjectionError(
			"member authority post-state does not match the current aggregate head",
		)
	}
	candidate := conversation.clone()
	if err := candidate.applyMemberAuthorityMutation(mutation); err != nil {
		return Snapshot{}, membershipProjectionError(err.Error())
	}
	candidate.head.MembershipEpoch = post.Head.MembershipEpoch
	if err := candidate.validateState(post.Head.Sequence); err != nil {
		return Snapshot{}, membershipProjectionError(err.Error())
	}
	expected := candidate.Snapshot()
	if expected.Owner != post.Owner ||
		!equalCommittedMembers(activeMembers(expected.Members), post.Members) ||
		!equalCommittedMemberDevices(activeDevices(expected.Devices), post.Devices) {
		return Snapshot{}, membershipProjectionError(
			"member authority mutation does not produce the committed post-state",
		)
	}
	post.Owner = expected.Owner
	post.Members = activeMembers(expected.Members)
	post.Devices = activeDevices(expected.Devices)

	return post, nil
}

func (c *Conversation) Snapshot() Snapshot {
	return Snapshot{
		ID:               c.id,
		Kind:             c.kind,
		Status:           c.status,
		FederationID:     c.federationID,
		AuthorityStation: c.authorityStation,
		AuthorityEpoch:   c.authorityEpoch,
		Owner:            c.owner,
		Head:             c.head,
		Settings:         c.settings,
		Members:          c.Members(),
		Devices:          c.MemberDevices(),
		CreatedAt:        c.createdAt,
		UpdatedAt:        c.updatedAt,
	}
}

func (c *Conversation) AuthorityHead() valueobject.AuthorityHead {
	return c.head
}

func (c *Conversation) FederationID() valueobject.FederationID {
	return c.federationID
}

func (c *Conversation) AuthorityEpoch() valueobject.AuthorityEpoch {
	return c.authorityEpoch
}

func (c *Conversation) ID() valueobject.ConversationID {
	return c.id
}

func (c *Conversation) Kind() valueobject.ConversationKind {
	return c.kind
}

func (c *Conversation) Status() valueobject.ConversationStatus {
	return c.status
}

func (c *Conversation) Settings() valueobject.ConversationSettings {
	return c.settings
}

func (c *Conversation) Members() []entity.Member {
	members := make([]entity.Member, 0, len(c.members))
	for _, member := range c.members {
		members = append(members, member)
	}
	sort.Slice(members, func(i int, j int) bool {
		return members[i].Actor < members[j].Actor
	})
	return members
}

func (c *Conversation) MemberDevices() []entity.MemberDevice {
	devices := make([]entity.MemberDevice, 0, len(c.devices))
	for _, device := range c.devices {
		devices = append(devices, device)
	}
	sort.Slice(devices, func(i int, j int) bool {
		return devices[i].Endpoint.Key() < devices[j].Endpoint.Key()
	})
	return devices
}

func (c *Conversation) ActiveEndpoints() []valueobject.Endpoint {
	endpoints := make([]valueobject.Endpoint, 0, len(c.devices))
	for _, device := range c.devices {
		member, exists := c.members[device.Endpoint.Actor]
		if device.Active && exists && member.Active() {
			endpoints = append(endpoints, device.Endpoint)
		}
	}
	return valueobject.SortEndpoints(endpoints)
}

func (c *Conversation) ActiveMemberActors() []valueobject.PTID {
	actors := make([]valueobject.PTID, 0, len(c.members))
	for _, member := range c.members {
		if member.Active() {
			actors = append(actors, member.Actor)
		}
	}
	sort.Slice(actors, func(i int, j int) bool {
		return actors[i] < actors[j]
	})
	return actors
}

func (c *Conversation) IsActiveMember(actor valueobject.PTID) bool {
	member, exists := c.members[actor]
	return exists && member.Active()
}

func (c *Conversation) IsActiveMemberEndpoint(endpoint valueobject.Endpoint) bool {
	if endpoint.Validate() != nil || !c.IsActiveMember(endpoint.Actor) {
		return false
	}
	if c.kind == valueobject.ConversationKindDirect {
		return true
	}
	return c.isActiveEndpoint(endpoint)
}

func (c *Conversation) PrepareCommand(
	sender valueobject.Endpoint,
	requiredEndpoints []valueobject.Endpoint,
) (CommandPreparation, error) {
	if err := c.requireWritableSender(sender); err != nil {
		return CommandPreparation{}, err
	}
	if err := c.validateRequiredEndpoints(requiredEndpoints); err != nil {
		return CommandPreparation{}, err
	}
	planHash := deliveryPlanHash(c.id, c.head, requiredEndpoints)
	return CommandPreparation{
		Kind:              c.kind,
		AuthorityStation:  c.authorityStation,
		Head:              c.head,
		RequiredEndpoints: valueobject.SortEndpoints(requiredEndpoints),
		DeliveryPlanHash:  planHash,
	}, nil
}

func (c *Conversation) PreviewMembership(
	sender valueobject.Endpoint,
	changes []entity.MembershipChange,
) (MembershipPreview, error) {
	if c.kind != valueobject.ConversationKindGroup {
		return MembershipPreview{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeMembershipConflict,
			"aggregate.preview_membership",
			"conversation",
			"membership transition requires a group conversation",
		)
	}
	if err := c.requireWritableSender(sender); err != nil {
		return MembershipPreview{}, err
	}
	member := c.members[sender.Actor]
	if !member.Role.CanManageMembership() {
		return MembershipPreview{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.preview_membership",
			"sender",
			"does not manage membership",
		)
	}
	if err := validateMembershipChangeBatch(changes); err != nil {
		return MembershipPreview{}, err
	}
	candidate := c.clone()
	preEndpoints := candidate.ActiveEndpoints()
	nextSequence := c.head.Sequence.Next()
	for _, change := range changes {
		if change.Action == entity.MembershipActionLeave &&
			change.Actor == sender.Actor &&
			change.Actor != c.owner {
			return MembershipPreview{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"aggregate.preview_membership",
				"leave",
				"departing actor cannot author its own MLS removal",
			)
		}
		if err := candidate.applyMembershipChange(change, nextSequence); err != nil {
			return MembershipPreview{}, err
		}
	}
	if err := candidate.validateState(nextSequence); err != nil {
		return MembershipPreview{}, err
	}
	postEndpoints := candidate.ActiveEndpoints()
	return MembershipPreview{
		Head:             c.head,
		PreEndpoints:     preEndpoints,
		PostEndpoints:    postEndpoints,
		AddedEndpoints:   endpointDifference(postEndpoints, preEndpoints),
		RemovedEndpoints: endpointDifference(preEndpoints, postEndpoints),
	}, nil
}

func (c *Conversation) ApplyCommand(command Command) (Transition, error) {
	if command.Kind == domainevent.KindMembershipCommitted ||
		command.Kind == domainevent.KindConversationSettings ||
		command.Kind == domainevent.KindConversationDissolved ||
		command.Kind == domainevent.KindConversationCreated {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"aggregate.apply_command",
			"kind",
			"requires a dedicated aggregate transition",
		)
	}
	if err := c.validateCommand(command); err != nil {
		return Transition{}, err
	}
	if err := c.validateOrdinaryCommand(command); err != nil {
		return Transition{}, err
	}
	return c.commit(
		command.ID,
		command.Sender,
		domainevent.NewCommandCommittedFact(command.Kind, command.MessageID, command.Payload),
		command.Deliveries,
		command.ObjectIDs,
		command.CommittedAt,
		command.EventSealer,
	)
}

func (c *Conversation) ApplyMembershipTransition(
	transition MembershipTransition,
) (Transition, error) {
	if c.kind != valueobject.ConversationKindGroup {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeMembershipConflict,
			"aggregate.apply_membership",
			"conversation",
			"membership transition requires a group conversation",
		)
	}
	if err := c.validateCommandBase(transition.Command); err != nil {
		return Transition{}, err
	}
	if transition.Kind != domainevent.KindMembershipCommitted ||
		transition.TransitionID == "" || transition.AuthorityPlanID == "" ||
		transition.AuthorityPlanHash.IsZero() ||
		transition.FromMembership != c.head.MembershipEpoch ||
		transition.FromMLS != c.head.MLSEpoch ||
		transition.ToMLS != c.head.MLSEpoch.Next() {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleMembershipEpoch,
			"aggregate.apply_membership",
			"authority_plan",
			"does not match the current aggregate head",
		)
	}
	if !bytes.Equal(transition.DeliveryPlanHash[:], transition.AuthorityPlanHash[:]) {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"aggregate.apply_membership",
			"delivery_plan_hash",
			"does not match the authority plan",
		)
	}
	sender := c.members[transition.Sender.Actor]
	if !sender.Role.CanManageMembership() {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.apply_membership",
			"sender",
			"does not manage membership",
		)
	}
	if err := validateMembershipChangeBatch(transition.Changes); err != nil {
		return Transition{}, err
	}
	candidate := c.clone()
	preEndpoints := candidate.ActiveEndpoints()
	nextSequence := candidate.head.Sequence.Next()
	for _, change := range transition.Changes {
		if change.Action == entity.MembershipActionLeave &&
			change.Actor == transition.Sender.Actor &&
			change.Actor != c.owner {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"aggregate.apply_membership",
				"leave",
				"departing actor cannot author its own MLS removal",
			)
		}
		if err := candidate.applyMembershipChange(change, nextSequence); err != nil {
			return Transition{}, err
		}
	}
	if err := candidate.validateState(nextSequence); err != nil {
		return Transition{}, err
	}
	postEndpoints := candidate.ActiveEndpoints()
	if !valueobject.EqualEndpointSets(preEndpoints, transition.PreEndpoints) {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"aggregate.apply_membership",
			"pre_endpoints",
			"does not match the aggregate pre-transition leaf set",
		)
	}
	if !valueobject.EqualEndpointSets(postEndpoints, transition.PostEndpoints) {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"aggregate.apply_membership",
			"post_endpoints",
			"does not match the aggregate post-transition leaf set",
		)
	}
	requiredEndpoints := endpointUnion(preEndpoints, postEndpoints)
	if !valueobject.EqualEndpointSets(requiredEndpoints, transition.RequiredEndpoints) {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"aggregate.apply_membership",
			"required_endpoints",
			"does not match the transition endpoint union",
		)
	}
	if err := domainservice.ValidateExactDeliverySet(requiredEndpoints, transition.Deliveries); err != nil {
		return Transition{}, err
	}
	if err := validateMembershipDeliveryKinds(transition); err != nil {
		return Transition{}, err
	}
	candidate.head.MembershipEpoch = candidate.head.MembershipEpoch.Next()
	candidate.head.MLSEpoch = transition.ToMLS
	membershipFact := domainevent.NewMembershipTransitionFact(
		transition.Changes,
		transition.Payload,
	)
	membershipFact.PostState = candidate.eventState()
	result, err := candidate.commit(
		transition.ID,
		transition.Sender,
		membershipFact,
		transition.Deliveries,
		transition.ObjectIDs,
		transition.CommittedAt,
		transition.EventSealer,
	)
	if err != nil {
		return Transition{}, err
	}
	*c = *candidate
	return result, nil
}

func (c *Conversation) ApplyMemberAuthority(
	command MemberAuthorityCommand,
) (Transition, error) {
	if c.kind != valueobject.ConversationKindGroup {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeMembershipConflict,
			"aggregate.apply_member_authority",
			"conversation",
			"member authority mutation requires a group conversation",
		)
	}
	if command.Kind != domainevent.KindMemberAuthority {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"aggregate.apply_member_authority",
			"kind",
			"is not a member authority command",
		)
	}
	if err := c.validateCommand(command.Command); err != nil {
		return Transition{}, err
	}
	if command.ObservedFederationID != c.federationID ||
		command.ObservedAuthorityEpoch != c.authorityEpoch ||
		command.ObservedAuthorityHead.Sequence != c.head.Sequence ||
		command.ObservedAuthorityHead.EventHash != c.head.EventHash {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"aggregate.apply_member_authority",
			"authority_head",
			"does not match the current Conversation authority",
		)
	}
	if command.Deadline.IsZero() || !command.Deadline.After(command.CommittedAt) {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandExpired,
			"aggregate.apply_member_authority",
			"deadline",
			"has expired",
		)
	}
	operator := c.members[command.Sender.Actor]
	target, exists := c.members[command.Target]
	if !exists || !target.Active() {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeTargetNotMember,
			"aggregate.apply_member_authority",
			"target_ptid",
			"is not an active Conversation member",
		)
	}
	mutation := domainevent.MemberAuthorityMutation{
		Action:              command.Action,
		Target:              command.Target,
		Role:                cloneMemberRole(command.Role),
		Muted:               cloneBool(command.Muted),
		MutedUntil:          cloneTime(command.MutedUntil),
		PreviousOwner:       c.owner,
		Owner:               c.owner,
		FromMembershipEpoch: c.head.MembershipEpoch,
		ToMembershipEpoch:   c.head.MembershipEpoch.Next(),
	}
	switch command.Action {
	case domainevent.MemberAuthorityActionUpdateMember:
		if command.Role == nil && command.Muted == nil {
			return Transition{}, invalid(
				"aggregate.apply_member_authority",
				"patch",
				"must update role or mute state",
			)
		}
		if command.Target == c.owner {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.apply_member_authority",
				"target_ptid",
				"owner authority can only change through ownership transfer",
			)
		}
		if command.Role != nil {
			if *command.Role == valueobject.MemberRoleOwner {
				return Transition{}, conversationdomain.NewError(
					conversationdomain.ErrorCodeOwnerProtected,
					"aggregate.apply_member_authority",
					"role",
					"owner role can only change through ownership transfer",
				)
			}
			if *command.Role != valueobject.MemberRoleMember &&
				*command.Role != valueobject.MemberRoleAdmin {
				return Transition{}, invalid(
					"aggregate.apply_member_authority",
					"role",
					"must be member or admin",
				)
			}
			if operator.Role != valueobject.MemberRoleOwner {
				return Transition{}, conversationdomain.NewError(
					conversationdomain.ErrorCodeUnauthorized,
					"aggregate.apply_member_authority",
					"role",
					"only the owner may assign member or admin role",
				)
			}
		}
		if command.Muted != nil {
			if !operator.Role.CanManageMembership() ||
				operator.Role == valueobject.MemberRoleAdmin &&
					target.Role != valueobject.MemberRoleMember {
				return Transition{}, conversationdomain.NewError(
					conversationdomain.ErrorCodeUnauthorized,
					"aggregate.apply_member_authority",
					"muted",
					"operator cannot manage the target mute state",
				)
			}
			if *command.Muted && command.MutedUntil != nil &&
				!command.MutedUntil.After(command.CommittedAt) {
				return Transition{}, conversationdomain.NewError(
					conversationdomain.ErrorCodeCommandExpired,
					"aggregate.apply_member_authority",
					"muted_until",
					"has expired",
				)
			}
		}
	case domainevent.MemberAuthorityActionTransferOwnership:
		if command.Sender.Actor != c.owner ||
			operator.Role != valueobject.MemberRoleOwner {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"aggregate.apply_member_authority",
				"operator",
				"only the current owner may transfer ownership",
			)
		}
		if command.Target == c.owner {
			return Transition{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.apply_member_authority",
				"target_ptid",
				"is already the owner",
			)
		}
		if command.Role != nil || command.Muted != nil || command.MutedUntil != nil {
			return Transition{}, invalid(
				"aggregate.apply_member_authority",
				"patch",
				"owner transfer does not accept member update fields",
			)
		}
		ownerRole := valueobject.MemberRoleOwner
		unmuted := false
		mutation.Role = &ownerRole
		mutation.Muted = &unmuted
		mutation.Owner = command.Target
	default:
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"aggregate.apply_member_authority",
			"action",
			"is not supported",
		)
	}
	candidate := c.clone()
	if err := candidate.applyMemberAuthorityMutation(mutation); err != nil {
		return Transition{}, err
	}
	if command.Action == domainevent.MemberAuthorityActionUpdateMember &&
		equalMemberAuthorityState(target, candidate.members[command.Target]) {
		return Transition{}, invalid(
			"aggregate.apply_member_authority",
			"patch",
			"does not change the target member authority state",
		)
	}
	candidate.head.MembershipEpoch = candidate.head.MembershipEpoch.Next()
	if err := candidate.validateState(candidate.head.Sequence.Next()); err != nil {
		return Transition{}, err
	}
	fact := domainevent.NewMemberAuthorityFact(mutation, command.Payload)
	fact.PostState = candidate.eventState()
	result, err := candidate.commit(
		command.ID,
		command.Sender,
		fact,
		command.Deliveries,
		command.ObjectIDs,
		command.CommittedAt,
		command.EventSealer,
	)
	if err != nil {
		return Transition{}, err
	}
	*c = *candidate
	return result, nil
}

func (c *Conversation) UpdateSettings(command SettingsCommand) (Transition, error) {
	if err := c.validateCommand(command.Command); err != nil {
		return Transition{}, err
	}
	if err := command.Patch.Validate(); err != nil {
		return Transition{}, err
	}
	member := c.members[command.Sender.Actor]
	if c.kind == valueobject.ConversationKindGroup && !member.Role.CanManageMembership() {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.update_settings",
			"sender",
			"does not manage group settings",
		)
	}
	candidate := c.clone()
	normalizedPatch := command.Patch.Normalized()
	candidate.settings = candidate.settings.Apply(normalizedPatch)
	result, err := candidate.commit(
		command.ID,
		command.Sender,
		domainevent.NewSettingsChangedFact(normalizedPatch, command.Payload),
		command.Deliveries,
		command.ObjectIDs,
		command.CommittedAt,
		command.EventSealer,
	)
	if err != nil {
		return Transition{}, err
	}
	*c = *candidate
	return result, nil
}

func (c *Conversation) Dissolve(command DissolveCommand) (Transition, error) {
	if c.kind != valueobject.ConversationKindGroup {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"aggregate.dissolve",
			"conversation",
			"only group conversations can be dissolved",
		)
	}
	if err := c.validateCommand(command.Command); err != nil {
		return Transition{}, err
	}
	if command.Sender.Actor != c.owner {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.dissolve",
			"sender",
			"only the owner may dissolve the conversation",
		)
	}
	candidate := c.clone()
	candidate.status = valueobject.ConversationStatusDissolved
	result, err := candidate.commit(
		command.ID,
		command.Sender,
		domainevent.NewConversationDissolvedFact(command.Payload),
		command.Deliveries,
		command.ObjectIDs,
		command.CommittedAt,
		command.EventSealer,
	)
	if err != nil {
		return Transition{}, err
	}
	*c = *candidate
	return result, nil
}

func (c *Conversation) validateCommand(command Command) error {
	if err := c.validateCommandBase(command); err != nil {
		return err
	}
	preparation, err := c.PrepareCommand(command.Sender, command.RequiredEndpoints)
	if err != nil {
		return err
	}
	if command.DeliveryPlanHash.IsZero() ||
		!bytes.Equal(command.DeliveryPlanHash[:], preparation.DeliveryPlanHash[:]) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"aggregate.validate_command",
			"delivery_plan_hash",
			"does not match the current authority head",
		)
	}
	return domainservice.ValidateExactDeliverySet(
		preparation.RequiredEndpoints,
		command.Deliveries,
	)
}

func (c *Conversation) validateOrdinaryCommand(command Command) error {
	switch command.Kind {
	case domainevent.KindMessageCommitted:
		if command.MessageID == "" ||
			command.ReplyToMessageID == command.MessageID ||
			command.ThreadRootMessageID == command.MessageID {
			return invalid(
				"aggregate.validate_command",
				"message",
				"message identity is required and cannot reference itself",
			)
		}
		if c.members[command.Sender.Actor].MutedAt(command.CommittedAt) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeMemberMuted,
				"aggregate.validate_command",
				"sender",
				"is muted in this Conversation",
			)
		}
	case domainevent.KindMessageEdited,
		domainevent.KindMessageRetracted,
		domainevent.KindMessagePinCommitted:
		if command.MessageID == "" {
			return invalid("aggregate.validate_command", "message_id", "is required")
		}
	case domainevent.KindReactionCommitted:
		if command.MessageID == "" || command.Reaction == "" {
			return invalid(
				"aggregate.validate_command",
				"reaction",
				"message identity and reaction are required",
			)
		}
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"aggregate.validate_command",
			"kind",
			"is not a supported ordinary command",
		)
	}
	for _, delivery := range command.Deliveries {
		expected := valueobject.DeliveryKindPublicEvent
		if command.Kind == domainevent.KindMessageCommitted ||
			command.Kind == domainevent.KindMessageEdited {
			switch {
			case delivery.Recipient == command.Sender:
				expected = valueobject.DeliveryKindPublicEvent
			case c.kind == valueobject.ConversationKindDirect:
				expected = valueobject.DeliveryKindDirectCiphertext
			case c.kind == valueobject.ConversationKindGroup:
				expected = valueobject.DeliveryKindMLSApplication
			}
		}
		if delivery.Kind != expected {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"aggregate.validate_command",
				"delivery_kind",
				"does not match the command and Conversation kind",
			)
		}
	}
	return nil
}

func (c *Conversation) validateCreationDeliveryKinds(
	creator valueobject.Endpoint,
	deliveries []valueobject.PreparedDelivery,
) error {
	for _, delivery := range deliveries {
		expected := valueobject.DeliveryKindConversation
		if c.kind == valueobject.ConversationKindGroup {
			expected = valueobject.DeliveryKindMLSWelcome
			if delivery.Recipient == creator {
				expected = valueobject.DeliveryKindPublicEvent
			}
		}
		if delivery.Kind != expected {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"aggregate.validate_creation",
				"delivery_kind",
				"does not match the Conversation kind and creation endpoint role",
			)
		}
	}
	return nil
}

func validateMembershipDeliveryKinds(transition MembershipTransition) error {
	added := endpointKeySet(transition.PostEndpoints)
	for _, endpoint := range transition.PreEndpoints {
		delete(added, endpoint.Key())
	}
	removed := endpointKeySet(transition.PreEndpoints)
	for _, endpoint := range transition.PostEndpoints {
		delete(removed, endpoint.Key())
	}
	for _, delivery := range transition.Deliveries {
		expected := valueobject.DeliveryKindMLSCommit
		switch {
		case containsEndpointKey(removed, delivery.Recipient):
			expected = valueobject.DeliveryKindMLSRetirement
		case containsEndpointKey(added, delivery.Recipient):
			expected = valueobject.DeliveryKindMLSWelcome
		case delivery.Recipient == transition.Sender:
			expected = valueobject.DeliveryKindPublicEvent
		}
		if delivery.Kind != expected {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"aggregate.validate_membership",
				"delivery_kind",
				"does not match the endpoint role in the MLS transition",
			)
		}
	}
	return nil
}

func endpointKeySet(endpoints []valueobject.Endpoint) map[string]struct{} {
	result := make(map[string]struct{}, len(endpoints))
	for _, endpoint := range endpoints {
		result[endpoint.Key()] = struct{}{}
	}
	return result
}

func containsEndpointKey(values map[string]struct{}, endpoint valueobject.Endpoint) bool {
	_, exists := values[endpoint.Key()]
	return exists
}

func (c *Conversation) validateCommandBase(command Command) error {
	if command.ID == "" || command.ConversationID != c.id ||
		command.AuthorityStation != c.authorityStation ||
		command.Sender.Validate() != nil || command.CommittedAt.IsZero() ||
		command.Kind == "" || len(command.Payload) == 0 {
		return invalid(
			"aggregate.validate_command",
			"command",
			"identity, authority, sender, kind, payload, and time are required",
		)
	}
	if err := c.requireWritableSender(command.Sender); err != nil {
		return err
	}
	if command.ObservedMembershipEpoch != c.head.MembershipEpoch {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleMembershipEpoch,
			"aggregate.validate_command",
			"observed_membership_epoch",
			"is stale",
		)
	}
	if command.ObservedMLSEpoch != c.head.MLSEpoch {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleMLSEpoch,
			"aggregate.validate_command",
			"observed_mls_epoch",
			"is stale",
		)
	}
	return nil
}

func (c *Conversation) commit(
	commandID valueobject.CommandID,
	actor valueobject.Endpoint,
	fact domainevent.Fact,
	deliveries []valueobject.PreparedDelivery,
	objectIDs []valueobject.ObjectID,
	at time.Time,
	sealer domainevent.Sealer,
) (Transition, error) {
	if commandID == "" || actor.Validate() != nil || at.IsZero() {
		return Transition{}, invalid("aggregate.commit", "command", "identity, actor, and time are required")
	}
	eventID := valueobject.DeterministicEventID(c.id, commandID)
	commitments, err := domainservice.BuildDeliveryCommitments(c.id, eventID, deliveries)
	if err != nil {
		return Transition{}, err
	}
	hashes := make([]valueobject.Hash, 0, len(commitments))
	for _, commitment := range commitments {
		hashes = append(hashes, commitment.Hash)
	}
	if sealer == nil {
		return Transition{}, invalid(
			"aggregate.commit",
			"event_sealer",
			"canonical transport event sealer is required",
		)
	}
	record, err := sealer.Seal(domainevent.RecordInput{
		ID:                  eventID,
		ConversationID:      c.id,
		Sequence:            c.head.Sequence.Next(),
		CommandID:           commandID,
		Actor:               actor,
		PreviousHash:        c.head.EventHash,
		CommittedAt:         at,
		MembershipEpoch:     c.head.MembershipEpoch,
		MLSEpoch:            c.head.MLSEpoch,
		AuthorityStation:    c.authorityStation,
		DeliveryCommitments: hashes,
		Fact:                fact,
	})
	if err != nil {
		return Transition{}, err
	}
	if record.HashScheme != domainevent.HashSchemeTransport {
		return Transition{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"aggregate.commit",
			"hash_scheme",
			"must use the canonical transport event encoding",
		)
	}
	c.head.Sequence = record.Sequence
	c.head.EventHash = record.Hash
	c.updatedAt = at.UTC()
	recipients := c.ActiveMemberActors()
	return Transition{
		Event:           record,
		Deliveries:      cloneDeliveries(deliveries),
		ObjectIDs:       append([]valueobject.ObjectID(nil), objectIDs...),
		RecipientActors: recipients,
	}, nil
}

func (c *Conversation) requireWritableSender(sender valueobject.Endpoint) error {
	if !c.status.Writable() {
		code := conversationdomain.ErrorCodeInactive
		if c.status == valueobject.ConversationStatusDegradedReadOnly ||
			c.status == valueobject.ConversationStatusOrphanedReadOnly {
			code = conversationdomain.ErrorCodeReadOnly
		}
		return conversationdomain.NewError(
			code,
			"aggregate.require_writable_sender",
			"conversation",
			"is not writable",
		)
	}
	if !c.IsActiveMemberEndpoint(sender) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"aggregate.require_writable_sender",
			"sender",
			"is not an active member device",
		)
	}
	return nil
}

func (c *Conversation) validateRequiredEndpoints(required []valueobject.Endpoint) error {
	if len(required) == 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"aggregate.validate_required_endpoints",
			"required_endpoints",
			"cannot be empty",
		)
	}
	seen := make(map[string]struct{}, len(required))
	for _, endpoint := range required {
		key := endpoint.Key()
		if _, duplicate := seen[key]; duplicate ||
			!c.IsActiveMemberEndpoint(endpoint) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"aggregate.validate_required_endpoints",
				"required_endpoints",
				"contains a duplicate or inactive endpoint",
			)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func (c *Conversation) applyMembershipChange(
	change entity.MembershipChange,
	sequence valueobject.Sequence,
) error {
	if err := change.Validate(); err != nil {
		return err
	}
	member, exists := c.members[change.Actor]
	switch change.Action {
	case entity.MembershipActionAddActor:
		if exists && member.Active() {
			return membershipConflict("actor is already active")
		}
		if change.Role == valueobject.MemberRoleOwner {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.apply_membership_change",
				"role",
				"cannot assign a second owner",
			)
		}
		added, err := entity.NewMember(change.Actor, change.Role, change.HomeStation, sequence)
		if err != nil {
			return err
		}
		c.members[change.Actor] = added
		if change.Device != "" {
			return c.addDevice(change, sequence)
		}
	case entity.MembershipActionRemoveActor, entity.MembershipActionLeave:
		if !exists || !member.Active() {
			return membershipConflict("actor is not active")
		}
		if change.Actor == c.owner {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.apply_membership_change",
				"actor",
				"owner cannot leave or be removed",
			)
		}
		status := valueobject.MemberStatusRemoved
		if change.Action == entity.MembershipActionLeave {
			status = valueobject.MemberStatusLeft
		}
		updated, err := member.Leave(sequence, status)
		if err != nil {
			return err
		}
		c.members[change.Actor] = updated
		for key, device := range c.devices {
			if device.Endpoint.Actor == change.Actor && device.Active {
				removed, err := device.Remove(sequence)
				if err != nil {
					return err
				}
				c.devices[key] = removed
			}
		}
	case entity.MembershipActionChangeRole:
		if !exists || !member.Active() {
			return membershipConflict("actor is not active")
		}
		if change.Actor != c.owner && change.Role == valueobject.MemberRoleOwner {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.apply_membership_change",
				"role",
				"cannot assign a second owner",
			)
		}
		if change.Actor == c.owner && change.Role != valueobject.MemberRoleOwner {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.apply_membership_change",
				"role",
				"owner role cannot be changed",
			)
		}
		updated, err := member.WithRole(change.Role)
		if err != nil {
			return err
		}
		c.members[change.Actor] = updated
	case entity.MembershipActionAddDevice:
		if !exists || !member.Active() {
			return membershipConflict("device actor is not active")
		}
		if change.HomeStation != member.HomeStation {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeviceConflict,
				"aggregate.apply_membership_change",
				"home_station",
				"must match the actor membership",
			)
		}
		return c.addDevice(change, sequence)
	case entity.MembershipActionRemoveDevice:
		key := valueobject.Endpoint{Actor: change.Actor, Device: change.Device}.Key()
		device, deviceExists := c.devices[key]
		if !deviceExists || !device.Active {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeviceConflict,
				"aggregate.apply_membership_change",
				"device",
				"is not active",
			)
		}
		removed, err := device.Remove(sequence)
		if err != nil {
			return err
		}
		c.devices[key] = removed
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"aggregate.apply_membership_change",
			"action",
			"is not supported",
		)
	}
	return nil
}

func (c *Conversation) applyMemberAuthorityMutation(
	mutation domainevent.MemberAuthorityMutation,
) error {
	target, exists := c.members[mutation.Target]
	if !exists || !target.Active() {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeTargetNotMember,
			"aggregate.apply_member_authority_mutation",
			"target_ptid",
			"is not an active Conversation member",
		)
	}
	switch mutation.Action {
	case domainevent.MemberAuthorityActionUpdateMember:
		updated, err := target.WithAuthorityState(
			mutation.Role,
			mutation.Muted,
			mutation.MutedUntil,
		)
		if err != nil {
			return err
		}
		c.members[mutation.Target] = updated
	case domainevent.MemberAuthorityActionTransferOwnership:
		if mutation.PreviousOwner != c.owner ||
			mutation.Owner != mutation.Target ||
			mutation.Owner == mutation.PreviousOwner {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.apply_member_authority_mutation",
				"owner",
				"transfer owner bindings are invalid",
			)
		}
		currentOwner := c.members[c.owner]
		adminRole := valueobject.MemberRoleAdmin
		updatedOwner, err := currentOwner.WithAuthorityState(&adminRole, nil, nil)
		if err != nil {
			return err
		}
		ownerRole := valueobject.MemberRoleOwner
		unmuted := false
		updatedTarget, err := target.WithAuthorityState(&ownerRole, &unmuted, nil)
		if err != nil {
			return err
		}
		c.members[currentOwner.Actor] = updatedOwner
		c.members[target.Actor] = updatedTarget
		c.owner = target.Actor
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"aggregate.apply_member_authority_mutation",
			"action",
			"is not supported",
		)
	}
	return nil
}

func validateMembershipChangeBatch(changes []entity.MembershipChange) error {
	if len(changes) == 0 {
		return membershipConflict("membership transition must contain at least one change")
	}
	actorLifecycle := make(map[valueobject.PTID]entity.MembershipAction, len(changes))
	roleChanges := make(map[valueobject.PTID]struct{}, len(changes))
	deviceChanges := make(map[valueobject.PTID]int, len(changes))
	endpointChanges := make(map[string]struct{}, len(changes))

	for _, change := range changes {
		if err := change.Validate(); err != nil {
			return err
		}
		switch change.Action {
		case entity.MembershipActionAddActor:
			if _, exists := actorLifecycle[change.Actor]; exists ||
				deviceChanges[change.Actor] > 0 {
				return membershipConflict("actor lifecycle changes conflict within one transition")
			}
			if _, exists := roleChanges[change.Actor]; exists {
				return membershipConflict("actor role and lifecycle changes conflict within one transition")
			}
			actorLifecycle[change.Actor] = change.Action
			if change.Device != "" {
				if err := recordEndpointChange(endpointChanges, change); err != nil {
					return err
				}
				deviceChanges[change.Actor]++
			}
		case entity.MembershipActionRemoveActor, entity.MembershipActionLeave:
			if _, exists := actorLifecycle[change.Actor]; exists ||
				deviceChanges[change.Actor] > 0 {
				return membershipConflict("actor lifecycle changes conflict within one transition")
			}
			if _, exists := roleChanges[change.Actor]; exists {
				return membershipConflict("actor role and lifecycle changes conflict within one transition")
			}
			actorLifecycle[change.Actor] = change.Action
		case entity.MembershipActionChangeRole:
			if _, exists := actorLifecycle[change.Actor]; exists {
				return membershipConflict("actor role and lifecycle changes conflict within one transition")
			}
			if _, duplicate := roleChanges[change.Actor]; duplicate {
				return membershipConflict("actor role changes conflict within one transition")
			}
			roleChanges[change.Actor] = struct{}{}
		case entity.MembershipActionAddDevice, entity.MembershipActionRemoveDevice:
			if lifecycle, exists := actorLifecycle[change.Actor]; exists &&
				lifecycle != entity.MembershipActionAddActor {
				return membershipConflict("actor removal and device changes conflict within one transition")
			}
			if err := recordEndpointChange(endpointChanges, change); err != nil {
				return err
			}
			deviceChanges[change.Actor]++
		}
	}
	return nil
}

func recordEndpointChange(
	seen map[string]struct{},
	change entity.MembershipChange,
) error {
	endpoint := valueobject.Endpoint{Actor: change.Actor, Device: change.Device}
	key := endpoint.Key()
	if _, duplicate := seen[key]; duplicate {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeDeviceConflict,
			"aggregate.validate_membership_change_batch",
			"endpoint",
			"has conflicting changes within one transition",
		)
	}
	seen[key] = struct{}{}
	return nil
}

func (c *Conversation) addDevice(
	change entity.MembershipChange,
	sequence valueobject.Sequence,
) error {
	endpoint := valueobject.Endpoint{Actor: change.Actor, Device: change.Device}
	key := endpoint.Key()
	if existing, exists := c.devices[key]; exists && existing.Active {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeDeviceConflict,
			"aggregate.add_device",
			"device",
			"is already active",
		)
	}
	device, err := entity.NewMemberDevice(endpoint, change.HomeStation, sequence)
	if err != nil {
		return err
	}
	c.devices[key] = device
	return nil
}

func (c *Conversation) isActiveEndpoint(endpoint valueobject.Endpoint) bool {
	device, exists := c.devices[endpoint.Key()]
	return exists && device.Active
}

func (c *Conversation) validateState(maxSequence valueobject.Sequence) error {
	for _, member := range c.members {
		if err := member.Validate(); err != nil {
			return err
		}
		if member.JoinedAt > maxSequence || member.LeftAt > maxSequence {
			return invalid(
				"aggregate.validate_state",
				"members",
				"contains a lifecycle sequence beyond the authority head",
			)
		}
	}
	for _, device := range c.devices {
		if err := device.Validate(); err != nil {
			return err
		}
		if device.JoinedAt > maxSequence || device.LeftAt > maxSequence {
			return invalid(
				"aggregate.validate_state",
				"devices",
				"contains a lifecycle sequence beyond the authority head",
			)
		}
		member, exists := c.members[device.Endpoint.Actor]
		if !exists || device.Active && (!member.Active() || device.HomeStation != member.HomeStation) {
			return invalid(
				"aggregate.validate_state",
				"devices",
				"contains an orphaned or inconsistently routed active member device",
			)
		}
	}
	if len(c.members) == 0 || len(c.devices) == 0 {
		return invalid(
			"aggregate.validate_state",
			"snapshot",
			"must contain members and member devices",
		)
	}
	if err := c.validateDirectInvariant(); err != nil {
		return err
	}
	return c.validateOwnerInvariant()
}

func (c *Conversation) validateDirectInvariant() error {
	if c.kind != valueobject.ConversationKindDirect {
		return nil
	}
	if c.head.MembershipEpoch != 1 || c.head.MLSEpoch != 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleMembershipEpoch,
			"aggregate.validate_direct",
			"authority_head",
			"direct conversation epochs must remain membership one and MLS zero",
		)
	}
	if len(c.members) != 2 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeMembershipConflict,
			"aggregate.validate_direct",
			"members",
			"direct conversation must contain exactly two active members",
		)
	}
	actors := make([]valueobject.PTID, 0, len(c.members))
	for _, member := range c.members {
		if !member.Active() || member.Role != valueobject.MemberRoleMember {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeMembershipConflict,
				"aggregate.validate_direct",
				"members",
				"direct conversation members must be active member-role actors",
			)
		}
		actors = append(actors, member.Actor)
	}
	expectedID, err := valueobject.DirectConversationID(actors[0], actors[1])
	if err != nil {
		return err
	}
	if c.id != expectedID {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"aggregate.validate_direct",
			"conversation_id",
			"does not match the deterministic participant pair",
		)
	}
	expectedOwner := actors[0]
	if actors[1] < expectedOwner {
		expectedOwner = actors[1]
	}
	if c.owner != expectedOwner {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeOwnerProtected,
			"aggregate.validate_direct",
			"owner",
			"must be the canonical actor from the deterministic participant pair",
		)
	}
	return nil
}

func (c *Conversation) validateOwnerInvariant() error {
	if c.kind != valueobject.ConversationKindGroup {
		return nil
	}
	owner, exists := c.members[c.owner]
	if !exists || !owner.Active() || owner.Role != valueobject.MemberRoleOwner {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeOwnerProtected,
			"aggregate.validate_owner",
			"owner",
			"must remain the active canonical owner",
		)
	}
	activeOwnerDevices := 0
	for _, member := range c.members {
		if member.Active() && member.Role == valueobject.MemberRoleOwner && member.Actor != c.owner {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"aggregate.validate_owner",
				"owner",
				"must be unique",
			)
		}
	}
	for _, device := range c.devices {
		if device.Active && device.Endpoint.Actor == c.owner {
			activeOwnerDevices++
		}
	}
	if activeOwnerDevices == 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeOwnerProtected,
			"aggregate.validate_owner",
			"owner_device",
			"must retain an active endpoint",
		)
	}
	return nil
}

func (c *Conversation) clone() *Conversation {
	cloned := *c
	cloned.members = make(map[valueobject.PTID]entity.Member, len(c.members))
	for key, member := range c.members {
		cloned.members[key] = member
	}
	cloned.devices = make(map[string]entity.MemberDevice, len(c.devices))
	for key, device := range c.devices {
		cloned.devices[key] = device
	}
	return &cloned
}

func (c *Conversation) eventState() *domainevent.ConversationState {
	return &domainevent.ConversationState{
		Kind:            c.kind,
		FederationID:    c.federationID,
		AuthorityEpoch:  c.authorityEpoch,
		Owner:           c.owner,
		Settings:        c.settings,
		ActiveMembers:   activeMembers(c.Members()),
		ActiveEndpoints: c.ActiveEndpoints(),
		ActiveDevices:   activeDevices(c.MemberDevices()),
		MembershipEpoch: c.head.MembershipEpoch,
		MLSEpoch:        c.head.MLSEpoch,
	}
}

func deliveryPlanHash(
	conversationID valueobject.ConversationID,
	head valueobject.AuthorityHead,
	endpoints []valueobject.Endpoint,
) valueobject.Hash {
	fields := [][]byte{
		[]byte("peers-touch/conversation-delivery-plan"),
		[]byte(conversationID),
		[]byte(fmt.Sprintf("%d", head.Sequence)),
		head.EventHash[:],
		[]byte(fmt.Sprintf("%d", head.MembershipEpoch)),
		[]byte(fmt.Sprintf("%d", head.MLSEpoch)),
	}
	for _, endpoint := range valueobject.SortEndpoints(endpoints) {
		fields = append(fields, []byte(endpoint.Actor), []byte(endpoint.Device))
	}
	return valueobject.HashBytes(valueobject.CanonicalTuple(fields...))
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

func endpointDifference(
	left []valueobject.Endpoint,
	right []valueobject.Endpoint,
) []valueobject.Endpoint {
	rightKeys := make(map[string]struct{}, len(right))
	for _, endpoint := range right {
		rightKeys[endpoint.Key()] = struct{}{}
	}
	result := make([]valueobject.Endpoint, 0)
	for _, endpoint := range left {
		if _, exists := rightKeys[endpoint.Key()]; !exists {
			result = append(result, endpoint)
		}
	}
	return valueobject.SortEndpoints(result)
}

func endpointSubset(
	subset []valueobject.Endpoint,
	superset []valueobject.Endpoint,
) bool {
	supersetKeys := make(map[string]struct{}, len(superset))
	for _, endpoint := range superset {
		supersetKeys[endpoint.Key()] = struct{}{}
	}
	seen := make(map[string]struct{}, len(subset))
	for _, endpoint := range subset {
		key := endpoint.Key()
		if _, exists := supersetKeys[key]; !exists {
			return false
		}
		if _, duplicate := seen[key]; duplicate {
			return false
		}
		seen[key] = struct{}{}
	}
	return true
}

func cloneDeliveries(deliveries []valueobject.PreparedDelivery) []valueobject.PreparedDelivery {
	cloned := make([]valueobject.PreparedDelivery, 0, len(deliveries))
	for _, delivery := range deliveries {
		cloned = append(cloned, delivery.Clone())
	}
	return cloned
}

func activeMembers(members []entity.Member) []entity.Member {
	active := make([]entity.Member, 0, len(members))
	for _, member := range members {
		if member.Active() {
			active = append(active, member)
		}
	}
	return active
}

func activeDevices(devices []entity.MemberDevice) []entity.MemberDevice {
	active := make([]entity.MemberDevice, 0, len(devices))
	for _, device := range devices {
		if device.Active {
			active = append(active, device)
		}
	}
	return active
}

func equalCommittedMembers(left []entity.Member, right []entity.Member) bool {
	if len(left) != len(right) {
		return false
	}
	expected := make(map[valueobject.PTID]entity.Member, len(left))
	for _, member := range left {
		expected[member.Actor] = member
	}
	seen := make(map[valueobject.PTID]struct{}, len(right))
	for _, member := range right {
		want, exists := expected[member.Actor]
		if !exists ||
			member.Role != want.Role ||
			member.Status != want.Status ||
			member.HomeStation != want.HomeStation ||
			member.Muted != want.Muted ||
			!equalOptionalTime(member.MutedUntil, want.MutedUntil) {
			return false
		}
		if _, duplicate := seen[member.Actor]; duplicate {
			return false
		}
		seen[member.Actor] = struct{}{}
	}
	return true
}

func equalOptionalTime(left *time.Time, right *time.Time) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Equal(*right)
}

func equalMemberAuthorityState(left entity.Member, right entity.Member) bool {
	return left.Role == right.Role &&
		left.Muted == right.Muted &&
		equalOptionalTime(left.MutedUntil, right.MutedUntil)
}

func cloneMemberRole(value *valueobject.MemberRole) *valueobject.MemberRole {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func cloneBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	copy := value.UTC().Truncate(time.Microsecond)
	return &copy
}

func equalCommittedMemberDevices(left []entity.MemberDevice, right []entity.MemberDevice) bool {
	if len(left) != len(right) {
		return false
	}
	expected := make(map[string]entity.MemberDevice, len(left))
	for _, device := range left {
		expected[device.Endpoint.Key()] = device
	}
	seen := make(map[string]struct{}, len(right))
	for _, device := range right {
		key := device.Endpoint.Key()
		want, exists := expected[key]
		if !exists ||
			device.Endpoint != want.Endpoint ||
			device.HomeStation != want.HomeStation ||
			device.Active != want.Active {
			return false
		}
		if _, duplicate := seen[key]; duplicate {
			return false
		}
		seen[key] = struct{}{}
	}
	return true
}

func membershipProjectionError(message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"aggregate.validate_membership_projection",
		"post_state",
		message,
	)
}

func invalid(operation string, field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		operation,
		field,
		message,
	)
}

func membershipConflict(message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeMembershipConflict,
		"aggregate.apply_membership_change",
		"membership",
		message,
	)
}
