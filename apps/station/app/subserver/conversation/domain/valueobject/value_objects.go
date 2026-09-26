package valueobject

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
)

type ConversationID string
type CommandID string
type EventID string
type PlanID string
type TransitionID string
type PTID string
type DeviceID string
type StationID string
type FederationID string
type MessageID string
type ObjectID string

func NewConversationID(value string) (ConversationID, error) {
	return validatedString[ConversationID]("conversation_id", value)
}

func NewCommandID(value string) (CommandID, error) {
	return validatedString[CommandID]("command_id", value)
}

func NewEventID(value string) (EventID, error) {
	return validatedString[EventID]("event_id", value)
}

func NewPlanID(value string) (PlanID, error) {
	return validatedString[PlanID]("plan_id", value)
}

func NewTransitionID(value string) (TransitionID, error) {
	return validatedString[TransitionID]("transition_id", value)
}

func NewPTID(value string) (PTID, error) {
	return validatedString[PTID]("ptid", value)
}

func NewDeviceID(value string) (DeviceID, error) {
	return validatedString[DeviceID]("device_id", value)
}

func NewStationID(value string) (StationID, error) {
	return validatedString[StationID]("station_id", value)
}

func NewFederationID(value string) (FederationID, error) {
	return validatedString[FederationID]("federation_id", value)
}

func NewMessageID(value string) (MessageID, error) {
	return validatedString[MessageID]("message_id", value)
}

func NewObjectID(value string) (ObjectID, error) {
	return validatedString[ObjectID]("object_id", value)
}

func validatedString[T ~string](field string, value string) (T, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "", conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.validate",
			field,
			"is required",
		)
	}
	return T(normalized), nil
}

type Hash [sha256.Size]byte

func HashBytes(value []byte) Hash {
	return sha256.Sum256(value)
}

func NewHash(value []byte) (Hash, error) {
	if len(value) != sha256.Size {
		return Hash{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.hash",
			"hash",
			fmt.Sprintf("must be %d bytes", sha256.Size),
		)
	}
	var hash Hash
	copy(hash[:], value)
	return hash, nil
}

func (h Hash) Bytes() []byte {
	return append([]byte(nil), h[:]...)
}

func (h Hash) String() string {
	return hex.EncodeToString(h[:])
}

func (h Hash) IsZero() bool {
	return h == Hash{}
}

type Sequence uint64

func (s Sequence) Next() Sequence {
	return s + 1
}

func (s Sequence) String() string {
	return strconv.FormatUint(uint64(s), 10)
}

type Epoch uint64

func (e Epoch) Next() Epoch {
	return e + 1
}

func (e Epoch) String() string {
	return strconv.FormatUint(uint64(e), 10)
}

type AuthorityEpoch uint64

func (e AuthorityEpoch) String() string {
	return strconv.FormatUint(uint64(e), 10)
}

type ConversationKind string

const (
	ConversationKindDirect ConversationKind = "direct"
	ConversationKindGroup  ConversationKind = "group"
)

func (k ConversationKind) Validate() error {
	switch k {
	case ConversationKindDirect, ConversationKindGroup:
		return nil
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.conversation_kind",
			"kind",
			"is not supported",
		)
	}
}

type ConversationStatus string

const (
	ConversationStatusActive           ConversationStatus = "active"
	ConversationStatusDissolved        ConversationStatus = "dissolved"
	ConversationStatusDegradedReadOnly ConversationStatus = "degraded_read_only"
	ConversationStatusOrphanedReadOnly ConversationStatus = "orphaned_read_only"
)

func (s ConversationStatus) Writable() bool {
	return s == ConversationStatusActive
}

func (s ConversationStatus) Validate() error {
	switch s {
	case ConversationStatusActive,
		ConversationStatusDissolved,
		ConversationStatusDegradedReadOnly,
		ConversationStatusOrphanedReadOnly:
		return nil
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.conversation_status",
			"status",
			"is not supported",
		)
	}
}

type MemberRole string

const (
	MemberRoleMember MemberRole = "member"
	MemberRoleAdmin  MemberRole = "admin"
	MemberRoleOwner  MemberRole = "owner"
)

func (r MemberRole) CanManageMembership() bool {
	return r == MemberRoleOwner || r == MemberRoleAdmin
}

func (r MemberRole) Validate() error {
	switch r {
	case MemberRoleMember, MemberRoleAdmin, MemberRoleOwner:
		return nil
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.member_role",
			"role",
			"is not supported",
		)
	}
}

type MemberStatus string

const (
	MemberStatusActive  MemberStatus = "active"
	MemberStatusLeft    MemberStatus = "left"
	MemberStatusRemoved MemberStatus = "removed"
)

func (s MemberStatus) Validate() error {
	switch s {
	case MemberStatusActive, MemberStatusLeft, MemberStatusRemoved:
		return nil
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.member_status",
			"status",
			"is not supported",
		)
	}
}

type Endpoint struct {
	Actor  PTID
	Device DeviceID
}

func NewEndpoint(actor string, device string) (Endpoint, error) {
	ptid, err := NewPTID(actor)
	if err != nil {
		return Endpoint{}, err
	}
	deviceID, err := NewDeviceID(device)
	if err != nil {
		return Endpoint{}, err
	}
	return Endpoint{Actor: ptid, Device: deviceID}, nil
}

func (e Endpoint) Validate() error {
	if _, err := NewPTID(string(e.Actor)); err != nil {
		return err
	}
	if _, err := NewDeviceID(string(e.Device)); err != nil {
		return err
	}
	return nil
}

func (e Endpoint) Key() string {
	return hex.EncodeToString(CanonicalTuple([]byte(e.Actor), []byte(e.Device)))
}

func SortEndpoints(endpoints []Endpoint) []Endpoint {
	sorted := append([]Endpoint(nil), endpoints...)
	sort.Slice(sorted, func(i int, j int) bool {
		if sorted[i].Actor == sorted[j].Actor {
			return sorted[i].Device < sorted[j].Device
		}
		return sorted[i].Actor < sorted[j].Actor
	})
	return sorted
}

func EqualEndpointSets(left []Endpoint, right []Endpoint) bool {
	if len(left) != len(right) {
		return false
	}
	left = SortEndpoints(left)
	right = SortEndpoints(right)
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

type AuthorityHead struct {
	Sequence        Sequence
	EventHash       Hash
	MembershipEpoch Epoch
	MLSEpoch        Epoch
}

type DeliveryKind string

const (
	DeliveryKindDirectCiphertext DeliveryKind = "direct_ciphertext"
	DeliveryKindMLSApplication   DeliveryKind = "mls_application"
	DeliveryKindMLSCommit        DeliveryKind = "mls_commit"
	DeliveryKindMLSWelcome       DeliveryKind = "mls_welcome"
	DeliveryKindPublicEvent      DeliveryKind = "public_event"
	DeliveryKindConversation     DeliveryKind = "conversation_state"
	DeliveryKindMLSRetirement    DeliveryKind = "mls_retirement"
)

func (k DeliveryKind) CommitmentCode() (uint32, error) {
	switch k {
	case DeliveryKindDirectCiphertext:
		return 1, nil
	case DeliveryKindMLSApplication:
		return 2, nil
	case DeliveryKindMLSCommit:
		return 3, nil
	case DeliveryKindMLSWelcome:
		return 4, nil
	case DeliveryKindPublicEvent:
		return 5, nil
	case DeliveryKindConversation:
		return 6, nil
	case DeliveryKindMLSRetirement:
		return 7, nil
	default:
		return 0, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.delivery_kind",
			"kind",
			"is not supported",
		)
	}
}

type PreparedDelivery struct {
	Recipient   Endpoint
	HomeStation StationID
	Kind        DeliveryKind
	Opaque      []byte
	PayloadHash Hash
}

func NewPreparedDelivery(
	recipient Endpoint,
	homeStation StationID,
	kind DeliveryKind,
	opaque []byte,
) (PreparedDelivery, error) {
	if err := recipient.Validate(); err != nil {
		return PreparedDelivery{}, err
	}
	if strings.TrimSpace(string(homeStation)) == "" {
		return PreparedDelivery{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.prepared_delivery",
			"home_station",
			"is required",
		)
	}
	if kind == "" || len(opaque) == 0 {
		return PreparedDelivery{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.prepared_delivery",
			"payload",
			"kind and opaque payload are required",
		)
	}
	payload := append([]byte(nil), opaque...)
	return PreparedDelivery{
		Recipient:   recipient,
		HomeStation: homeStation,
		Kind:        kind,
		Opaque:      payload,
		PayloadHash: HashBytes(payload),
	}, nil
}

func (d PreparedDelivery) Clone() PreparedDelivery {
	d.Opaque = append([]byte(nil), d.Opaque...)
	return d
}

type DeliveryCommitment struct {
	Recipient Endpoint
	Hash      Hash
}

type KeyPackageReservation struct {
	ID                   string
	Endpoint             Endpoint
	PackageID            string
	KeyPackage           []byte
	PackageHash          Hash
	HomeStation          StationID
	IrreversiblyConsumed bool
}

func (r KeyPackageReservation) Validate() error {
	if strings.TrimSpace(r.ID) == "" ||
		r.Endpoint.Validate() != nil ||
		strings.TrimSpace(r.PackageID) == "" ||
		len(r.KeyPackage) == 0 ||
		r.PackageHash.IsZero() ||
		strings.TrimSpace(string(r.HomeStation)) == "" ||
		string(r.HomeStation) != strings.TrimSpace(string(r.HomeStation)) ||
		HashBytes(r.KeyPackage) != r.PackageHash {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.key_package_reservation",
			"reservation",
			"identity, endpoint, package, hash, and Home Station are required",
		)
	}
	return nil
}

func SortKeyPackageReservations(
	values []KeyPackageReservation,
) []KeyPackageReservation {
	result := make([]KeyPackageReservation, 0, len(values))
	for _, value := range values {
		value.KeyPackage = append([]byte(nil), value.KeyPackage...)
		result = append(result, value)
	}
	sort.Slice(result, func(i int, j int) bool {
		if result[i].Endpoint.Key() != result[j].Endpoint.Key() {
			return result[i].Endpoint.Key() < result[j].Endpoint.Key()
		}
		if result[i].PackageID != result[j].PackageID {
			return result[i].PackageID < result[j].PackageID
		}
		return result[i].ID < result[j].ID
	})
	return result
}

type ConversationSettings struct {
	Name           string
	Description    string
	AvatarObjectID string
	Visibility     ConversationVisibility
}

type ConversationVisibility string

const (
	ConversationVisibilityPublic  ConversationVisibility = "public"
	ConversationVisibilityPrivate ConversationVisibility = "private"
)

type SettingsPatch struct {
	Name           *string
	Description    *string
	AvatarObjectID *string
	Visibility     *ConversationVisibility
}

func (s ConversationSettings) Validate() error {
	if s.Visibility == "" {
		return nil
	}
	return s.Visibility.Validate()
}

func (p SettingsPatch) Validate() error {
	if p.Visibility == nil {
		return nil
	}
	return p.Visibility.Validate()
}

func (v ConversationVisibility) Validate() error {
	switch v {
	case ConversationVisibilityPublic, ConversationVisibilityPrivate:
		return nil
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.conversation_visibility",
			"visibility",
			"must be public or private",
		)
	}
}

func (s ConversationSettings) Apply(patch SettingsPatch) ConversationSettings {
	patch = patch.Normalized()
	updated := s
	if patch.Name != nil {
		updated.Name = *patch.Name
	}
	if patch.Description != nil {
		updated.Description = *patch.Description
	}
	if patch.AvatarObjectID != nil {
		updated.AvatarObjectID = *patch.AvatarObjectID
	}
	if patch.Visibility != nil {
		updated.Visibility = *patch.Visibility
	}
	return updated
}

func (p SettingsPatch) Normalized() SettingsPatch {
	normalized := p
	if p.Name != nil {
		value := strings.TrimSpace(*p.Name)
		normalized.Name = &value
	}
	if p.Description != nil {
		value := strings.TrimSpace(*p.Description)
		normalized.Description = &value
	}
	if p.AvatarObjectID != nil {
		value := strings.TrimSpace(*p.AvatarObjectID)
		normalized.AvatarObjectID = &value
	}
	return normalized
}

func DirectConversationID(left PTID, right PTID) (ConversationID, error) {
	if left == "" || right == "" || left == right {
		return "", conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.direct_conversation_id",
			"actors",
			"two distinct actors are required",
		)
	}
	actors := []string{string(left), string(right)}
	sort.Strings(actors)
	sum := sha256.Sum256(CanonicalTuple(
		[]byte("peers-touch/direct-conversation"),
		[]byte(actors[0]),
		[]byte(actors[1]),
	))
	return ConversationID("direct-" + hex.EncodeToString(sum[:16])), nil
}

func DeterministicEventID(conversationID ConversationID, commandID CommandID) EventID {
	sum := sha256.Sum256(CanonicalTuple(
		[]byte("peers-touch/conversation-event"),
		[]byte(conversationID),
		[]byte(commandID),
	))
	return EventID(hex.EncodeToString(sum[:16]))
}

func CanonicalTuple(fields ...[]byte) []byte {
	var buffer bytes.Buffer
	var size [4]byte
	for _, field := range fields {
		binary.BigEndian.PutUint32(size[:], uint32(len(field)))
		buffer.Write(size[:])
		buffer.Write(field)
	}
	return buffer.Bytes()
}
