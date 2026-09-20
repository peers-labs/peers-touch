package event

import (
	"bytes"
	"encoding/binary"
	"sort"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type Kind string

const (
	KindConversationCreated   Kind = "conversation_created"
	KindMessageCommitted      Kind = "message_committed"
	KindMessageEdited         Kind = "message_edited"
	KindMessageRetracted      Kind = "message_retracted"
	KindReactionCommitted     Kind = "reaction_committed"
	KindMessagePinCommitted   Kind = "message_pin_committed"
	KindMembershipCommitted   Kind = "membership_transition_committed"
	KindMemberAuthority       Kind = "member_authority_committed"
	KindConversationSettings  Kind = "conversation_settings_changed"
	KindConversationDissolved Kind = "conversation_dissolved"
)

type Fact struct {
	Kind              Kind
	MessageID         valueobject.MessageID
	Payload           []byte
	MembershipChanges []entity.MembershipChange
	Created           *ConversationCreated
	PostState         *ConversationState
	MemberAuthority   *MemberAuthorityMutation
	SettingsPatch     valueobject.SettingsPatch
}

type MemberAuthorityAction string

const (
	MemberAuthorityActionUpdateMember      MemberAuthorityAction = "update_member"
	MemberAuthorityActionTransferOwnership MemberAuthorityAction = "transfer_ownership"
)

type MemberAuthorityMutation struct {
	Action              MemberAuthorityAction
	Target              valueobject.PTID
	Role                *valueobject.MemberRole
	Muted               *bool
	MutedUntil          *time.Time
	PreviousOwner       valueobject.PTID
	Owner               valueobject.PTID
	FromMembershipEpoch valueobject.Epoch
	ToMembershipEpoch   valueobject.Epoch
}

type ConversationCreated struct {
	Kind    valueobject.ConversationKind
	Name    string
	Owner   valueobject.PTID
	Members []valueobject.PTID
}

type ConversationState struct {
	Kind            valueobject.ConversationKind
	FederationID    valueobject.FederationID
	AuthorityEpoch  valueobject.AuthorityEpoch
	Owner           valueobject.PTID
	Settings        valueobject.ConversationSettings
	ActiveMembers   []entity.Member
	ActiveEndpoints []valueobject.Endpoint
	ActiveDevices   []entity.MemberDevice
	MembershipEpoch valueobject.Epoch
	MLSEpoch        valueobject.Epoch
}

func NewConversationCreatedFact(payload []byte) Fact {
	return Fact{Kind: KindConversationCreated, Payload: cloneBytes(payload)}
}

func NewCommandCommittedFact(kind Kind, messageID valueobject.MessageID, payload []byte) Fact {
	return Fact{Kind: kind, MessageID: messageID, Payload: cloneBytes(payload)}
}

func NewMembershipTransitionFact(
	changes []entity.MembershipChange,
	payload []byte,
) Fact {
	return Fact{
		Kind:              KindMembershipCommitted,
		Payload:           cloneBytes(payload),
		MembershipChanges: append([]entity.MembershipChange(nil), changes...),
	}
}

func NewMemberAuthorityFact(
	mutation MemberAuthorityMutation,
	payload []byte,
) Fact {
	return Fact{
		Kind:            KindMemberAuthority,
		Payload:         cloneBytes(payload),
		MemberAuthority: cloneMemberAuthorityMutation(&mutation),
	}
}

func NewSettingsChangedFact(patch valueobject.SettingsPatch, payload []byte) Fact {
	return Fact{
		Kind:          KindConversationSettings,
		Payload:       cloneBytes(payload),
		SettingsPatch: cloneSettingsPatch(patch),
	}
}

func NewConversationDissolvedFact(payload []byte) Fact {
	return Fact{Kind: KindConversationDissolved, Payload: cloneBytes(payload)}
}

type Record struct {
	ID                  valueobject.EventID
	ConversationID      valueobject.ConversationID
	Sequence            valueobject.Sequence
	CommandID           valueobject.CommandID
	Actor               valueobject.Endpoint
	PreviousHash        valueobject.Hash
	Hash                valueobject.Hash
	HashScheme          HashScheme
	EncodedBytes        []byte
	CommittedAt         time.Time
	MembershipEpoch     valueobject.Epoch
	MLSEpoch            valueobject.Epoch
	AuthorityStation    valueobject.StationID
	DeliveryCommitments []valueobject.Hash
	Fact                Fact
}

type HashScheme string

const (
	HashSchemeDomain    HashScheme = "domain"
	HashSchemeTransport HashScheme = "transport"
)

type RecordInput struct {
	ID                  valueobject.EventID
	ConversationID      valueobject.ConversationID
	Sequence            valueobject.Sequence
	CommandID           valueobject.CommandID
	Actor               valueobject.Endpoint
	PreviousHash        valueobject.Hash
	CommittedAt         time.Time
	MembershipEpoch     valueobject.Epoch
	MLSEpoch            valueobject.Epoch
	AuthorityStation    valueobject.StationID
	DeliveryCommitments []valueobject.Hash
	Fact                Fact
}

type Sealer interface {
	Seal(input RecordInput) (Record, error)
}

type CanonicalSealer struct{}

func (CanonicalSealer) Seal(input RecordInput) (Record, error) {
	record, err := sealRecord(input, valueobject.Hash{}, HashSchemeDomain, nil)
	if err != nil {
		return Record{}, err
	}
	record.EncodedBytes = record.CanonicalBytes()
	record.Hash = valueobject.HashBytes(record.EncodedBytes)
	return record, nil
}

func NewRecord(input RecordInput) (Record, error) {
	return CanonicalSealer{}.Seal(input)
}

func SealRecord(input RecordInput, hash valueobject.Hash) (Record, error) {
	return SealTransportRecord(input, hash, nil)
}

func SealTransportRecord(
	input RecordInput,
	hash valueobject.Hash,
	encoded []byte,
) (Record, error) {
	if hash.IsZero() {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.seal_record",
			"event_hash",
			"is required",
		)
	}
	if len(encoded) == 0 {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.seal_transport_record",
			"encoded_event",
			"is required",
		)
	}
	return sealRecord(input, hash, HashSchemeTransport, encoded)
}

func sealRecord(
	input RecordInput,
	hash valueobject.Hash,
	scheme HashScheme,
	encoded []byte,
) (Record, error) {
	if input.ID == "" || input.ConversationID == "" || input.Sequence == 0 ||
		input.CommandID == "" || input.Actor.Validate() != nil ||
		input.AuthorityStation == "" || input.CommittedAt.IsZero() ||
		input.Fact.Kind == "" {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"event.new_record",
			"event",
			"identity, sequence, actor, authority, time, and fact are required",
		)
	}
	if input.Sequence == 1 && !input.PreviousHash.IsZero() {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.new_record",
			"previous_hash",
			"genesis event cannot have a previous hash",
		)
	}
	if input.Sequence > 1 && input.PreviousHash.IsZero() {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.new_record",
			"previous_hash",
			"non-genesis event requires a previous hash",
		)
	}
	// Canonical timestamps use the persistence precision so a database
	// round-trip cannot alter the event hash input.
	committedAt := input.CommittedAt.UTC().Truncate(time.Microsecond)
	record := Record{
		ID:                  input.ID,
		ConversationID:      input.ConversationID,
		Sequence:            input.Sequence,
		CommandID:           input.CommandID,
		Actor:               input.Actor,
		PreviousHash:        input.PreviousHash,
		CommittedAt:         committedAt,
		MembershipEpoch:     input.MembershipEpoch,
		MLSEpoch:            input.MLSEpoch,
		AuthorityStation:    input.AuthorityStation,
		DeliveryCommitments: sortedHashes(input.DeliveryCommitments),
		Fact:                cloneFact(input.Fact),
		Hash:                hash,
		HashScheme:          scheme,
		EncodedBytes:        cloneBytes(encoded),
	}
	return record, nil
}

func Rehydrate(record Record) (Record, error) {
	if record.Hash.IsZero() {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.rehydrate",
			"event_hash",
			"is required",
		)
	}
	if len(record.EncodedBytes) == 0 {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.rehydrate",
			"encoded_event",
			"is required",
		)
	}
	if record.HashScheme == "" {
		record.HashScheme = HashSchemeDomain
	}
	if record.HashScheme == HashSchemeDomain {
		encodedHash := valueobject.HashBytes(record.EncodedBytes)
		if !bytes.Equal(encodedHash[:], record.Hash[:]) {
			return Record{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"event.rehydrate",
				"encoded_event",
				"does not match the event hash",
			)
		}
		if !bytes.Equal(record.EncodedBytes, record.CanonicalBytes()) {
			return Record{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"event.rehydrate",
				"event_hash",
				"does not match canonical event bytes",
			)
		}
	} else if record.HashScheme != HashSchemeTransport {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.rehydrate",
			"hash_scheme",
			"is not supported",
		)
	}
	record.DeliveryCommitments = sortedHashes(record.DeliveryCommitments)
	record.Fact = cloneFact(record.Fact)
	record.CommittedAt = record.CommittedAt.UTC()
	return record, nil
}

func Verify(record Record, sealer Sealer) (Record, error) {
	rehydrated, err := Rehydrate(record)
	if err != nil {
		return Record{}, err
	}
	if sealer == nil {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"event.verify",
			"sealer",
			"is required",
		)
	}
	expected, err := sealer.Seal(rehydrated.Input())
	if err != nil {
		return Record{}, err
	}
	if expected.Hash != rehydrated.Hash ||
		!bytes.Equal(expected.Bytes(), rehydrated.Bytes()) {
		return Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"event.verify",
			"event",
			"does not match the configured canonical encoding",
		)
	}
	return rehydrated, nil
}

func (r Record) CanonicalBytes() []byte {
	fields := [][]byte{
		[]byte("peers-touch/conversation-domain-event"),
		[]byte(r.ID),
		[]byte(r.ConversationID),
		uint64Bytes(uint64(r.Sequence)),
		[]byte(r.CommandID),
		[]byte(r.Actor.Actor),
		[]byte(r.Actor.Device),
		r.PreviousHash[:],
		int64Bytes(r.CommittedAt.UnixNano()),
		uint64Bytes(uint64(r.MembershipEpoch)),
		uint64Bytes(uint64(r.MLSEpoch)),
		[]byte(r.AuthorityStation),
		[]byte(r.Fact.Kind),
		[]byte(r.Fact.MessageID),
		r.Fact.Payload,
		conversationCreatedBytes(r.Fact.Created),
		conversationStateBytes(r.Fact.PostState),
		memberAuthorityBytes(r.Fact.MemberAuthority),
		settingsBytes(r.Fact.SettingsPatch),
	}
	for _, change := range r.Fact.MembershipChanges {
		fields = append(fields,
			[]byte(change.Action),
			[]byte(change.Actor),
			[]byte(change.Device),
			[]byte(change.HomeStation),
			[]byte(change.Role),
		)
	}
	for _, commitment := range sortedHashes(r.DeliveryCommitments) {
		fields = append(fields, commitment[:])
	}
	return valueobject.CanonicalTuple(fields...)
}

func memberAuthorityBytes(mutation *MemberAuthorityMutation) []byte {
	if mutation == nil {
		return nil
	}
	fields := [][]byte{
		[]byte(mutation.Action),
		[]byte(mutation.Target),
		optionalMemberRoleBytes(mutation.Role),
		optionalBoolBytes(mutation.Muted),
		optionalTimeBytes(mutation.MutedUntil),
		[]byte(mutation.PreviousOwner),
		[]byte(mutation.Owner),
		uint64Bytes(uint64(mutation.FromMembershipEpoch)),
		uint64Bytes(uint64(mutation.ToMembershipEpoch)),
	}
	return valueobject.CanonicalTuple(fields...)
}

func optionalMemberRoleBytes(value *valueobject.MemberRole) []byte {
	if value == nil {
		return []byte{0}
	}
	return append([]byte{1}, []byte(*value)...)
}

func optionalBoolBytes(value *bool) []byte {
	if value == nil {
		return []byte{0}
	}
	if *value {
		return []byte{1, 1}
	}
	return []byte{1, 0}
}

func optionalTimeBytes(value *time.Time) []byte {
	if value == nil {
		return []byte{0}
	}
	return append([]byte{1}, int64Bytes(value.UTC().UnixNano())...)
}

func (r Record) Clone() Record {
	r.DeliveryCommitments = sortedHashes(r.DeliveryCommitments)
	r.Fact = cloneFact(r.Fact)
	r.EncodedBytes = cloneBytes(r.EncodedBytes)
	return r
}

func (r Record) Input() RecordInput {
	return RecordInput{
		ID:                  r.ID,
		ConversationID:      r.ConversationID,
		Sequence:            r.Sequence,
		CommandID:           r.CommandID,
		Actor:               r.Actor,
		PreviousHash:        r.PreviousHash,
		CommittedAt:         r.CommittedAt,
		MembershipEpoch:     r.MembershipEpoch,
		MLSEpoch:            r.MLSEpoch,
		AuthorityStation:    r.AuthorityStation,
		DeliveryCommitments: sortedHashes(r.DeliveryCommitments),
		Fact:                cloneFact(r.Fact),
	}
}

func (r Record) Bytes() []byte {
	return cloneBytes(r.EncodedBytes)
}

func sortedHashes(values []valueobject.Hash) []valueobject.Hash {
	sorted := append([]valueobject.Hash(nil), values...)
	sort.Slice(sorted, func(i int, j int) bool {
		return bytes.Compare(sorted[i][:], sorted[j][:]) < 0
	})
	return sorted
}

func cloneFact(fact Fact) Fact {
	fact.Payload = cloneBytes(fact.Payload)
	fact.MembershipChanges = append([]entity.MembershipChange(nil), fact.MembershipChanges...)
	fact.Created = cloneCreated(fact.Created)
	fact.PostState = cloneConversationState(fact.PostState)
	fact.MemberAuthority = cloneMemberAuthorityMutation(fact.MemberAuthority)
	fact.SettingsPatch = cloneSettingsPatch(fact.SettingsPatch)
	return fact
}

func cloneMemberAuthorityMutation(
	mutation *MemberAuthorityMutation,
) *MemberAuthorityMutation {
	if mutation == nil {
		return nil
	}
	copy := *mutation
	if mutation.Role != nil {
		role := *mutation.Role
		copy.Role = &role
	}
	if mutation.Muted != nil {
		muted := *mutation.Muted
		copy.Muted = &muted
	}
	if mutation.MutedUntil != nil {
		mutedUntil := mutation.MutedUntil.UTC()
		copy.MutedUntil = &mutedUntil
	}
	return &copy
}

func cloneCreated(created *ConversationCreated) *ConversationCreated {
	if created == nil {
		return nil
	}
	copy := *created
	copy.Members = append([]valueobject.PTID(nil), created.Members...)
	return &copy
}

func cloneConversationState(state *ConversationState) *ConversationState {
	if state == nil {
		return nil
	}
	copy := *state
	copy.ActiveMembers = append([]entity.Member(nil), state.ActiveMembers...)
	copy.ActiveEndpoints = append([]valueobject.Endpoint(nil), state.ActiveEndpoints...)
	copy.ActiveDevices = append([]entity.MemberDevice(nil), state.ActiveDevices...)
	return &copy
}

func cloneSettingsPatch(patch valueobject.SettingsPatch) valueobject.SettingsPatch {
	return valueobject.SettingsPatch{
		Name:                  cloneStringPointer(patch.Name),
		Description:           cloneStringPointer(patch.Description),
		AvatarObjectID:        cloneStringPointer(patch.AvatarObjectID),
		Visibility:            cloneVisibilityPointer(patch.Visibility),
		DisappearTimerSeconds: cloneUint32Pointer(patch.DisappearTimerSeconds),
	}
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func cloneVisibilityPointer(
	value *valueobject.ConversationVisibility,
) *valueobject.ConversationVisibility {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func cloneUint32Pointer(value *uint32) *uint32 {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func cloneBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

func uint64Bytes(value uint64) []byte {
	bytes := make([]byte, 8)
	binary.BigEndian.PutUint64(bytes, value)
	return bytes
}

func int64Bytes(value int64) []byte {
	return uint64Bytes(uint64(value))
}

func settingsBytes(patch valueobject.SettingsPatch) []byte {
	var fields [][]byte
	appendString := func(value *string) {
		if value == nil {
			fields = append(fields, optionalFieldBytes(false, nil))
			return
		}
		fields = append(fields, optionalFieldBytes(true, []byte(*value)))
	}
	appendString(patch.Name)
	appendString(patch.Description)
	appendString(patch.AvatarObjectID)
	if patch.Visibility == nil {
		fields = append(fields, optionalFieldBytes(false, nil))
	} else {
		fields = append(fields, optionalFieldBytes(true, []byte(*patch.Visibility)))
	}
	if patch.DisappearTimerSeconds == nil {
		fields = append(fields, optionalFieldBytes(false, nil))
	} else {
		var encoded [4]byte
		binary.BigEndian.PutUint32(encoded[:], *patch.DisappearTimerSeconds)
		fields = append(fields, optionalFieldBytes(true, encoded[:]))
	}
	return valueobject.CanonicalTuple(fields...)
}

func optionalFieldBytes(present bool, value []byte) []byte {
	if !present {
		return []byte{0}
	}
	return append([]byte{1}, value...)
}

func conversationCreatedBytes(created *ConversationCreated) []byte {
	if created == nil {
		return nil
	}
	fields := [][]byte{
		[]byte(created.Kind),
		[]byte(created.Name),
		[]byte(created.Owner),
	}
	members := append([]valueobject.PTID(nil), created.Members...)
	sort.Slice(members, func(i int, j int) bool {
		return members[i] < members[j]
	})
	for _, member := range members {
		fields = append(fields, []byte(member))
	}
	return valueobject.CanonicalTuple(fields...)
}

func conversationStateBytes(state *ConversationState) []byte {
	if state == nil {
		return nil
	}
	fields := [][]byte{
		[]byte(state.Kind),
		[]byte(state.FederationID),
		[]byte(state.AuthorityEpoch.String()),
		[]byte(state.Owner),
		[]byte(state.Settings.Name),
		[]byte(state.Settings.Description),
		[]byte(state.Settings.AvatarObjectID),
		[]byte(state.Settings.Visibility),
		uint64Bytes(uint64(state.Settings.DisappearTimerSeconds)),
		uint64Bytes(uint64(state.MembershipEpoch)),
		uint64Bytes(uint64(state.MLSEpoch)),
	}
	members := append([]entity.Member(nil), state.ActiveMembers...)
	sort.Slice(members, func(i int, j int) bool {
		return members[i].Actor < members[j].Actor
	})
	for _, member := range members {
		fields = append(fields,
			[]byte(member.Actor),
			[]byte(member.Role),
			[]byte(member.Status),
			[]byte(member.HomeStation),
			uint64Bytes(uint64(member.JoinedAt)),
			optionalBoolBytes(&member.Muted),
			optionalTimeBytes(member.MutedUntil),
		)
	}
	for _, endpoint := range valueobject.SortEndpoints(state.ActiveEndpoints) {
		fields = append(fields, []byte(endpoint.Actor), []byte(endpoint.Device))
	}
	devices := append([]entity.MemberDevice(nil), state.ActiveDevices...)
	sort.Slice(devices, func(i int, j int) bool {
		return devices[i].Endpoint.Key() < devices[j].Endpoint.Key()
	})
	for _, device := range devices {
		fields = append(fields,
			[]byte(device.Endpoint.Actor),
			[]byte(device.Endpoint.Device),
			[]byte(device.HomeStation),
			uint64Bytes(uint64(device.JoinedAt)),
		)
	}
	return valueobject.CanonicalTuple(fields...)
}
