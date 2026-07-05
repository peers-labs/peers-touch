package group_chat

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type group struct {
	ID              string
	Name            string
	Description     string
	OwnerDID        string
	MemberCount     int32
	Status          string
	DissolvedAt     time.Time
	MembershipEpoch int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type message struct {
	ID               string
	GroupID          string
	SenderDID        string
	Type             int32
	Content          string
	EncryptedPayload []byte
	ReplyToID        string
	ThreadRootID     string
	// Recalled — see messageModel.Recalled. Renamed from `Deleted`
	// for parity with the proto + friend_chat. The semantic was
	// already "recalled (tombstone)" not "soft-deleted".
	Recalled    bool
	EditedAt    time.Time
	Attachments []domain.Attachment
	SentAt      time.Time
}

var (
	groupChatIDMu           sync.Mutex
	groupChatIDLastUnixNano int64
	groupChatIDSeq          int64
)

func nextGroupChatID(prefix string, now time.Time) string {
	groupChatIDMu.Lock()
	defer groupChatIDMu.Unlock()

	unixNano := now.UnixNano()
	if unixNano <= groupChatIDLastUnixNano {
		unixNano = groupChatIDLastUnixNano
		groupChatIDSeq++
	} else {
		groupChatIDLastUnixNano = unixNano
		groupChatIDSeq = 0
	}
	return fmt.Sprintf("%s-%d-%012d", prefix, unixNano, groupChatIDSeq)
}

type member struct {
	GroupID    string
	ActorDID   string
	Actor      domain.FederatedActorRef
	Role       int32
	Nickname   string
	Muted      bool
	MutedUntil time.Time
	JoinedAt   time.Time
	InvitedBy  string
}

func memberFromModel(row memberModel) *member {
	return &member{
		GroupID:    row.GroupULID,
		ActorDID:   row.ActorDID,
		Actor:      federatedActorFromMemberModel(row),
		Role:       row.Role,
		Nickname:   row.Nickname,
		Muted:      row.Muted,
		MutedUntil: derefTime(row.MutedUntil),
		JoinedAt:   row.JoinedAt,
		InvitedBy:  row.InvitedBy,
	}
}

func memberToDomain(item *member) *domain.Member {
	if item == nil {
		return nil
	}
	return &domain.Member{
		GroupID:    item.GroupID,
		ActorDID:   item.ActorDID,
		Actor:      memberActorRef(item),
		Role:       item.Role,
		Nickname:   item.Nickname,
		Muted:      item.Muted,
		MutedUntil: item.MutedUntil,
		JoinedAt:   item.JoinedAt,
		InvitedBy:  item.InvitedBy,
	}
}

func federatedActorFromMemberModel(row memberModel) domain.FederatedActorRef {
	return domain.FederatedActorRef{
		ActorDID:          row.ActorDID,
		HomeStationPeerID: row.ActorHomeStationPeerID,
		HomeStationDomain: row.ActorHomeStationDomain,
		FederatedHandle:   row.ActorFederatedHandle,
		ProfileVersion:    row.ActorProfileVersion,
		FederationID:      row.ActorFederationID,
	}
}

func memberActorRef(item *member) domain.FederatedActorRef {
	if item == nil {
		return domain.FederatedActorRef{}
	}
	actor := item.Actor
	if strings.TrimSpace(actor.ActorDID) == "" {
		actor.ActorDID = item.ActorDID
	}
	return actor
}

type invitation struct {
	ID         string
	GroupID    string
	InviterDID string
	InviteeDID string
	Status     int32
	ExpireAt   time.Time
	CreatedAt  time.Time
}

type groupSetting struct {
	IsMuted            bool
	IsPinned           bool
	ShowMemberNickname bool
	AlertEnabled       bool
	Background         string
	ClearedAtUnixMs    int64
}

type offlineMessage struct {
	ID         string
	GroupID    string
	MessageID  string
	ReceiverID string
	CreatedAt  time.Time
}

type threadRead struct {
	GroupID    string
	RootID     string
	ActorDID   string
	LastReadID string
	LastReadAt time.Time
}

type proposalEventPayloadJSON struct {
	ProposalULID         string `json:"proposal_ulid"`
	Command              int32  `json:"command"`
	CommandPayloadSHA256 string `json:"command_payload_sha256"`
	ActorDID             string `json:"actor_did"`
	HomeStationPeerID    string `json:"home_station_peer_id"`
}

const (
	groupInvitationStatusPending     int32 = 1
	groupInvitationStatusAccepted    int32 = 2
	groupInvitationStatusExpired     int32 = 4
	defaultInvitationTTL                   = 7 * 24 * time.Hour
	foundationAuthorityEpoch               = 1
	foundationLocalAuthorityStation        = "local"
	federationOutboxStatusPending          = "pending"
	federationOutboxStatusApplied          = "applied"
	federationOutboxStatusRetryWait        = "retry_wait"
	proposalOutboxStatusPending            = "pending"
	proposalOutboxStatusAccepted           = "accepted"
	proposalOutboxStatusRetryWait          = "retry_wait"
	skdmOutboxStatusPending                = "pending"
	skdmOutboxStatusRetryWait              = "retry_wait"
	skdmOutboxStatusDelivered              = "delivered"
	followerProjectionStatusActive         = "active"
	followerProjectionStatusDegraded       = "degraded"
	followerProjectionStatusReadOnly       = "read_only"
)

var (
	errAuthorityEventIdempotencyConflict = errors.New("authority event idempotency conflict")
	errFollowerProjectionForkProtection  = errors.New("follower projection fork protection")
	errProposalOutboxIdempotencyConflict = errors.New("proposal outbox idempotency conflict")
)

func groupStatus(status string) string {
	if strings.TrimSpace(status) == "" {
		return domain.GroupStatusActive
	}
	return status
}

func isGroupDissolved(status string) bool {
	return groupStatus(status) == domain.GroupStatusDissolved
}

func groupMembershipEpoch(epoch int64) int64 {
	if epoch <= 0 {
		return 1
	}
	return epoch
}

func hashGroupAuthorityEvent(prevHash, groupID string, seq int64, eventType, actorDID, messageULID string, membershipEpoch int64, payload string) string {
	h := sha256.Sum256([]byte(strings.Join([]string{
		prevHash,
		groupID,
		strconv.FormatInt(seq, 10),
		eventType,
		actorDID,
		messageULID,
		strconv.FormatInt(groupMembershipEpoch(membershipEpoch), 10),
		payload,
	}, "\n")))
	return hex.EncodeToString(h[:])
}

func authorityEventIdempotencyKey(groupID, eventType, actorDID, messageULID string, membershipEpoch int64, payload string) string {
	h := sha256.Sum256([]byte(strings.Join([]string{
		groupID,
		eventType,
		actorDID,
		messageULID,
		strconv.FormatInt(groupMembershipEpoch(membershipEpoch), 10),
		payload,
	}, "\n")))
	return hex.EncodeToString(h[:])
}

func sha256HexBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func proposalEventPayload(proposal domain.GroupProposal) (string, error) {
	payload := proposalEventPayloadJSON{
		ProposalULID:         proposal.ProposalULID,
		Command:              proposal.Command,
		CommandPayloadSHA256: sha256HexBytes(proposal.CommandPayload),
		ActorDID:             proposal.Actor.ActorDID,
		HomeStationPeerID:    proposal.Actor.HomeStationPeerID,
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func proposalOutboxPayload(proposal domain.GroupProposal) (string, error) {
	out, err := json.Marshal(proposal)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func proposalOutboxPayloadToProposal(payload string) (domain.GroupProposal, error) {
	var proposal domain.GroupProposal
	if err := json.Unmarshal([]byte(payload), &proposal); err != nil {
		return domain.GroupProposal{}, err
	}
	if strings.TrimSpace(proposal.ProposalULID) == "" {
		return domain.GroupProposal{}, errors.New("proposal outbox payload missing proposal_ulid")
	}
	return proposal, nil
}

func groupEventModelToDomain(row groupEventModel, actor domain.FederatedActorRef) domain.GroupEvent {
	return domain.GroupEvent{
		EventULID:              row.EventULID,
		GroupID:                row.GroupULID,
		Seq:                    row.Seq,
		PrevHash:               row.PrevHash,
		EventHash:              row.EventHash,
		EventType:              row.EventType,
		Actor:                  actor,
		MessageID:              row.MessageULID,
		MembershipEpoch:        groupMembershipEpoch(row.MembershipEpoch),
		AuthorityStationPeerID: row.AuthorityStationPeerID,
		AuthorityEpoch:         row.AuthorityEpoch,
		ProposalULID:           row.ProposalULID,
		IdempotencyKey:         row.IdempotencyKey,
		EventPayload:           []byte(row.Payload),
		CreatedAt:              row.CreatedAt,
	}
}

func federationOutboxPayloadToEvent(payload string) (domain.GroupEvent, error) {
	var event domain.GroupEvent
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return domain.GroupEvent{}, err
	}
	if strings.TrimSpace(event.EventULID) == "" {
		return domain.GroupEvent{}, errors.New("federation outbox payload missing event_ulid")
	}
	return event, nil
}

func federationOutboxModelToDomain(row federationOutboxModel) domain.FederationOutboxItem {
	item := domain.FederationOutboxItem{
		EventULID:              row.EventULID,
		GroupID:                row.GroupULID,
		Seq:                    row.Seq,
		TargetStationPeerID:    row.TargetStationPeerID,
		AuthorityStationPeerID: row.AuthorityStationPeerID,
		AuthorityEpoch:         row.AuthorityEpoch,
		Status:                 row.Status,
		AttemptCount:           row.AttemptCount,
		NextAttemptAt:          derefTime(row.NextAttemptAt),
		LastError:              row.LastError,
		CreatedAt:              row.CreatedAt,
		UpdatedAt:              row.UpdatedAt,
	}
	if event, err := federationOutboxPayloadToEvent(row.Payload); err == nil {
		item.Event = event
	}
	return item
}

func groupProposalOutboxModelToDomain(row groupProposalOutboxModel, actor domain.FederatedActorRef) domain.GroupProposalOutboxItem {
	item := domain.GroupProposalOutboxItem{
		ProposalULID:            row.ProposalULID,
		GroupID:                 row.GroupULID,
		Actor:                   actor,
		Command:                 row.Command,
		AuthorityStationPeerID:  row.AuthorityStationPeerID,
		AuthorityEpoch:          row.AuthorityEpoch,
		ObservedMembershipEpoch: groupMembershipEpoch(row.ObservedMembershipEpoch),
		IdempotencyKey:          row.IdempotencyKey,
		Status:                  row.Status,
		AttemptCount:            row.AttemptCount,
		NextAttemptAt:           derefTime(row.NextAttemptAt),
		LastError:               row.LastError,
		CreatedAt:               row.CreatedAt,
		UpdatedAt:               row.UpdatedAt,
	}
	if proposal, err := proposalOutboxPayloadToProposal(row.Payload); err == nil {
		item.Proposal = proposal
		item.Actor = proposal.Actor
	}
	return item
}

func groupSkdmOutboxModelToDomain(row groupSkdmOutboxModel) domain.GroupSkdmEnvelope {
	return domain.GroupSkdmEnvelope{
		OutboxULID:                 row.OutboxULID,
		GroupID:                    row.GroupULID,
		MembershipEpoch:            groupMembershipEpoch(row.MembershipEpoch),
		SenderDID:                  row.SenderDID,
		SenderKeyID:                row.SenderKeyID,
		SenderHomeStationPeerID:    row.SenderHomeStationPeerID,
		RecipientDID:               row.RecipientDID,
		RecipientDeviceID:          row.RecipientDeviceID,
		RecipientHomeStationPeerID: row.RecipientHomeStationPeerID,
		EncryptedPayload:           append([]byte(nil), row.EncryptedPayload...),
		IdempotencyKey:             row.IdempotencyKey,
		Status:                     row.Status,
		AttemptCount:               row.AttemptCount,
		NextAttemptAt:              derefTime(row.NextAttemptAt),
		LastError:                  row.LastError,
		CreatedAt:                  row.CreatedAt,
		UpdatedAt:                  row.UpdatedAt,
	}
}

func followerProjectionModelToDomain(row groupFollowerProjectionModel) domain.FollowerProjection {
	return domain.FollowerProjection{
		GroupID:                row.GroupULID,
		AuthorityStationPeerID: row.AuthorityStationPeerID,
		AuthorityEpoch:         row.AuthorityEpoch,
		LastSeq:                row.LastSeq,
		LastEventHash:          row.LastEventHash,
		Status:                 row.Status,
		ProtectionReason:       row.ProtectionReason,
	}
}

func enqueueFederationOutboxTx(tx *gorm.DB, now time.Time, event groupEventModel, targetStationPeerID string, actor domain.FederatedActorRef) error {
	targetStationPeerID = strings.TrimSpace(targetStationPeerID)
	if targetStationPeerID == "" || targetStationPeerID == event.AuthorityStationPeerID {
		return nil
	}
	payload, err := json.Marshal(groupEventModelToDomain(event, actor))
	if err != nil {
		return err
	}
	row := &federationOutboxModel{
		EventULID:              event.EventULID,
		GroupULID:              event.GroupULID,
		Seq:                    event.Seq,
		TargetStationPeerID:    targetStationPeerID,
		AuthorityStationPeerID: event.AuthorityStationPeerID,
		AuthorityEpoch:         event.AuthorityEpoch,
		Status:                 federationOutboxStatusPending,
		AttemptCount:           0,
		Payload:                string(payload),
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error
}

func syncMemberActorRefTx(tx *gorm.DB, now time.Time, groupID string, actor domain.FederatedActorRef) error {
	actorDID := strings.TrimSpace(actor.ActorDID)
	if actorDID == "" || strings.TrimSpace(actor.HomeStationPeerID) == "" {
		return nil
	}
	return tx.Model(&memberModel{}).
		Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).
		Updates(map[string]interface{}{
			"actor_home_station_peer_id": actor.HomeStationPeerID,
			"actor_home_station_domain":  actor.HomeStationDomain,
			"actor_federated_handle":     actor.FederatedHandle,
			"actor_profile_version":      actor.ProfileVersion,
			"actor_federation_id":        actor.FederationID,
			"updated_at":                 now,
		}).Error
}

func upsertMemberActorRefTx(tx *gorm.DB, now time.Time, groupID string, actor domain.FederatedActorRef, role int32, nickname, invitedBy string) error {
	actorDID := strings.TrimSpace(actor.ActorDID)
	if actorDID == "" || strings.TrimSpace(actor.HomeStationPeerID) == "" {
		return nil
	}
	updates := map[string]interface{}{
		"actor_home_station_peer_id": actor.HomeStationPeerID,
		"actor_home_station_domain":  actor.HomeStationDomain,
		"actor_federated_handle":     actor.FederatedHandle,
		"actor_profile_version":      actor.ProfileVersion,
		"actor_federation_id":        actor.FederationID,
		"updated_at":                 now,
	}
	if role != 0 {
		updates["role"] = role
	}
	if strings.TrimSpace(nickname) != "" {
		updates["nickname"] = nickname
	}
	if strings.TrimSpace(invitedBy) != "" {
		updates["invited_by"] = invitedBy
	}
	result := tx.Model(&memberModel{}).
		Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	if role == 0 {
		role = domain.GroupRoleMember
	}
	return tx.Create(&memberModel{
		GroupULID:              groupID,
		ActorDID:               actorDID,
		ActorHomeStationPeerID: actor.HomeStationPeerID,
		ActorHomeStationDomain: actor.HomeStationDomain,
		ActorFederatedHandle:   actor.FederatedHandle,
		ActorProfileVersion:    actor.ProfileVersion,
		ActorFederationID:      actor.FederationID,
		Role:                   role,
		Nickname:               nickname,
		JoinedAt:               now,
		InvitedBy:              invitedBy,
		CreatedAt:              now,
		UpdatedAt:              now,
	}).Error
}

func upsertFollowerGroupTx(tx *gorm.DB, now time.Time, snapshot domain.Group) error {
	if snapshot.CreatedAt.IsZero() {
		snapshot.CreatedAt = now
	}
	if snapshot.UpdatedAt.IsZero() {
		snapshot.UpdatedAt = now
	}
	if snapshot.Status == "" {
		snapshot.Status = domain.GroupStatusActive
	}
	row := groupModel{
		ULID:            snapshot.ID,
		Name:            snapshot.Name,
		Description:     snapshot.Description,
		OwnerDID:        snapshot.OwnerDID,
		MemberCount:     snapshot.MemberCount,
		Status:          snapshot.Status,
		DissolvedAt:     timePtrOrNil(snapshot.DissolvedAt),
		MembershipEpoch: groupMembershipEpoch(snapshot.MembershipEpoch),
		CreatedAt:       snapshot.CreatedAt,
		UpdatedAt:       snapshot.UpdatedAt,
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "ulid"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"name":             row.Name,
			"description":      row.Description,
			"owner_did":        row.OwnerDID,
			"member_count":     row.MemberCount,
			"status":           row.Status,
			"dissolved_at":     row.DissolvedAt,
			"membership_epoch": row.MembershipEpoch,
			"updated_at":       row.UpdatedAt,
		}),
	}).Create(&row).Error
}

func upsertFollowerMemberTx(tx *gorm.DB, now time.Time, snapshot domain.Member) error {
	actorDID := strings.TrimSpace(snapshot.ActorDID)
	if actorDID == "" {
		actorDID = strings.TrimSpace(snapshot.Actor.ActorDID)
	}
	if actorDID == "" || strings.TrimSpace(snapshot.GroupID) == "" {
		return nil
	}
	actor := snapshot.Actor
	if strings.TrimSpace(actor.ActorDID) == "" {
		actor.ActorDID = actorDID
	}
	if snapshot.Role == 0 {
		snapshot.Role = domain.GroupRoleMember
	}
	if snapshot.JoinedAt.IsZero() {
		snapshot.JoinedAt = now
	}
	row := memberModel{
		GroupULID:              snapshot.GroupID,
		ActorDID:               actorDID,
		ActorHomeStationPeerID: actor.HomeStationPeerID,
		ActorHomeStationDomain: actor.HomeStationDomain,
		ActorFederatedHandle:   actor.FederatedHandle,
		ActorProfileVersion:    actor.ProfileVersion,
		ActorFederationID:      actor.FederationID,
		Role:                   snapshot.Role,
		Nickname:               snapshot.Nickname,
		Muted:                  snapshot.Muted,
		MutedUntil:             timePtrOrNil(snapshot.MutedUntil),
		JoinedAt:               snapshot.JoinedAt,
		InvitedBy:              snapshot.InvitedBy,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	result := tx.Model(&memberModel{}).
		Where("group_ulid = ? AND actor_did = ?", row.GroupULID, row.ActorDID).
		Updates(map[string]interface{}{
			"actor_home_station_peer_id": row.ActorHomeStationPeerID,
			"actor_home_station_domain":  row.ActorHomeStationDomain,
			"actor_federated_handle":     row.ActorFederatedHandle,
			"actor_profile_version":      row.ActorProfileVersion,
			"actor_federation_id":        row.ActorFederationID,
			"role":                       row.Role,
			"nickname":                   row.Nickname,
			"muted":                      row.Muted,
			"muted_until":                row.MutedUntil,
			"joined_at":                  row.JoinedAt,
			"invited_by":                 row.InvitedBy,
			"updated_at":                 row.UpdatedAt,
		})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return tx.Create(&row).Error
}

func upsertFollowerMessageTx(tx *gorm.DB, now time.Time, snapshot domain.Message) error {
	snapshot.ID = strings.TrimSpace(snapshot.ID)
	snapshot.GroupID = strings.TrimSpace(snapshot.GroupID)
	if snapshot.ID == "" || snapshot.GroupID == "" {
		return nil
	}
	if snapshot.SentAt.IsZero() {
		snapshot.SentAt = now
	}
	row := messageModel{
		ULID:             snapshot.ID,
		GroupULID:        snapshot.GroupID,
		SenderDID:        snapshot.SenderDID,
		Type:             snapshot.Type,
		Content:          "",
		EncryptedPayload: append([]byte(nil), snapshot.EncryptedPayload...),
		ReplyToID:        snapshot.ReplyToID,
		ThreadRootID:     snapshot.ThreadRootID,
		Recalled:         snapshot.Recalled,
		EditedAt:         timePtrOrNil(snapshot.EditedAt),
		SentAt:           snapshot.SentAt,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "ulid"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"group_ulid":        row.GroupULID,
			"sender_did":        row.SenderDID,
			"type":              row.Type,
			"content":           "",
			"encrypted_payload": row.EncryptedPayload,
			"reply_to_id":       row.ReplyToID,
			"thread_root_ulid":  row.ThreadRootID,
			"deleted":           row.Recalled,
			"edited_at":         row.EditedAt,
			"sent_at":           row.SentAt,
			"updated_at":        row.UpdatedAt,
		}),
	}).Create(&row).Error; err != nil {
		return err
	}
	for _, attachment := range snapshot.Attachments {
		if strings.TrimSpace(attachment.CID) == "" && strings.TrimSpace(attachment.Filename) == "" {
			continue
		}
		var existing MessageAttachmentModel
		err := tx.
			Where("message_ulid = ? AND cid = ? AND filename = ?", snapshot.ID, attachment.CID, attachment.Filename).
			Limit(1).
			Find(&existing).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		updates := map[string]interface{}{
			"mime_type":     attachment.MimeType,
			"size":          attachment.Size,
			"thumbnail_cid": attachment.ThumbnailCID,
			"visibility":    attachment.Visibility,
		}
		if errors.Is(err, gorm.ErrRecordNotFound) || existing.ID == 0 {
			row := MessageAttachmentModel{
				MessageULID:  snapshot.ID,
				CID:          attachment.CID,
				Filename:     attachment.Filename,
				MimeType:     attachment.MimeType,
				Size:         attachment.Size,
				ThumbnailCID: attachment.ThumbnailCID,
				Visibility:   attachment.Visibility,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			continue
		}
		if err := tx.Model(&existing).Updates(updates).Error; err != nil {
			return err
		}
	}
	return nil
}

func syncProposalLifecycleActorRefsTx(tx *gorm.DB, now time.Time, proposal domain.GroupProposal) error {
	switch chat.GroupProposalCommand(proposal.Command) {
	case chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MEMBER_JOIN:
		var payload chat.GroupMemberJoinCommandPayload
		if err := proto.Unmarshal(proposal.CommandPayload, &payload); err != nil {
			return err
		}
		member := federatedActorRefFromProto(payload.GetMember())
		if strings.TrimSpace(member.ActorDID) == "" || strings.TrimSpace(member.HomeStationPeerID) == "" {
			return errors.New("member join payload missing member ActorRef")
		}
		return upsertMemberActorRefTx(tx, now, proposal.GroupID, member, int32(payload.GetRole()), payload.GetNickname(), payload.GetInvitedByActorDid())
	case chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_MEMBER_REMOVE:
		var payload chat.GroupMemberRemoveCommandPayload
		if err := proto.Unmarshal(proposal.CommandPayload, &payload); err != nil {
			return err
		}
		member := federatedActorRefFromProto(payload.GetMember())
		if strings.TrimSpace(member.ActorDID) == "" || strings.TrimSpace(member.HomeStationPeerID) == "" {
			return errors.New("member remove payload missing member ActorRef")
		}
		return syncMemberActorRefTx(tx, now, proposal.GroupID, member)
	case chat.GroupProposalCommand_GROUP_PROPOSAL_COMMAND_OWNER_TRANSFER:
		var payload chat.GroupOwnerTransferCommandPayload
		if err := proto.Unmarshal(proposal.CommandPayload, &payload); err != nil {
			return err
		}
		nextOwner := federatedActorRefFromProto(payload.GetNextOwner())
		if strings.TrimSpace(nextOwner.ActorDID) == "" || strings.TrimSpace(nextOwner.HomeStationPeerID) == "" {
			return errors.New("owner transfer payload missing next owner ActorRef")
		}
		return syncMemberActorRefTx(tx, now, proposal.GroupID, nextOwner)
	default:
		return nil
	}
}

func federationFanoutTargetsTx(tx *gorm.DB, groupID, actorHomeStationPeerID, authorityStationPeerID string) ([]string, error) {
	authorityStationPeerID = strings.TrimSpace(authorityStationPeerID)
	seen := map[string]struct{}{}
	add := func(stationID string) {
		stationID = strings.TrimSpace(stationID)
		if stationID == "" || stationID == authorityStationPeerID {
			return
		}
		seen[stationID] = struct{}{}
	}
	add(actorHomeStationPeerID)

	var rows []memberModel
	if err := tx.Select("actor_home_station_peer_id").
		Where("group_ulid = ? AND actor_home_station_peer_id <> ''", groupID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		add(row.ActorHomeStationPeerID)
	}

	targets := make([]string, 0, len(seen))
	for stationID := range seen {
		targets = append(targets, stationID)
	}
	sort.Strings(targets)
	return targets, nil
}

func (s *service) appendAuthorityEventTx(tx *gorm.DB, now time.Time, groupID, eventType, actorDID, messageULID string, membershipEpoch int64, payload string) error {
	_, _, err := s.appendAuthorityEventRowTx(tx, now, groupID, eventType, actorDID, messageULID, membershipEpoch, payload)
	return err
}

func (s *service) appendAuthorityEventRowTx(tx *gorm.DB, now time.Time, groupID, eventType, actorDID, messageULID string, membershipEpoch int64, payload string) (*groupEventModel, bool, error) {
	return appendAuthorityEventWithIdempotencyTx(
		tx,
		now,
		groupID,
		eventType,
		actorDID,
		messageULID,
		membershipEpoch,
		s.authorityStationID(),
		foundationAuthorityEpoch,
		"",
		payload,
		authorityEventIdempotencyKey(groupID, eventType, actorDID, messageULID, membershipEpoch, payload),
	)
}

func enqueueAuthorityEventFanoutTx(tx *gorm.DB, now time.Time, event groupEventModel, actor domain.FederatedActorRef) error {
	targets, err := federationFanoutTargetsTx(tx, event.GroupULID, actor.HomeStationPeerID, event.AuthorityStationPeerID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(actor.ActorDID) == "" {
		actor.ActorDID = event.ActorDID
	}
	for _, target := range targets {
		if err := enqueueFederationOutboxTx(tx, now, event, target, actor); err != nil {
			return err
		}
	}
	return nil
}

func enqueueAuthorityEventHistoryForTargetTx(tx *gorm.DB, now time.Time, groupID, targetStationPeerID string, actor domain.FederatedActorRef) error {
	targetStationPeerID = strings.TrimSpace(targetStationPeerID)
	if targetStationPeerID == "" {
		return nil
	}
	var events []groupEventModel
	if err := tx.Where("group_ulid = ?", groupID).Order("seq ASC").Find(&events).Error; err != nil {
		return err
	}
	if strings.TrimSpace(actor.ActorDID) == "" {
		actor.ActorDID = targetStationPeerID
	}
	for _, event := range events {
		if err := enqueueFederationOutboxTx(tx, now, event, targetStationPeerID, actor); err != nil {
			return err
		}
	}
	return nil
}

func appendAuthorityEventWithIdempotencyTx(tx *gorm.DB, now time.Time, groupID, eventType, actorDID, messageULID string, membershipEpoch int64, authorityStationPeerID string, authorityEpoch int64, proposalULID, payload, idempotencyKey string) (*groupEventModel, bool, error) {
	authorityStationPeerID = strings.TrimSpace(authorityStationPeerID)
	if authorityStationPeerID == "" {
		authorityStationPeerID = foundationLocalAuthorityStation
	}
	if authorityEpoch <= 0 {
		authorityEpoch = foundationAuthorityEpoch
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = authorityEventIdempotencyKey(groupID, eventType, actorDID, messageULID, membershipEpoch, payload)
	}
	var existing groupEventModel
	err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error
	if err == nil {
		if existing.GroupULID == groupID &&
			existing.EventType == eventType &&
			existing.ActorDID == actorDID &&
			existing.MessageULID == messageULID &&
			groupMembershipEpoch(existing.MembershipEpoch) == groupMembershipEpoch(membershipEpoch) &&
			existing.AuthorityStationPeerID == authorityStationPeerID &&
			existing.AuthorityEpoch == authorityEpoch &&
			existing.ProposalULID == proposalULID &&
			existing.Payload == payload {
			return &existing, true, nil
		}
		return nil, false, errAuthorityEventIdempotencyConflict
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}

	var last groupEventModel
	err = tx.Where("group_ulid = ?", groupID).Order("seq DESC").First(&last).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	seq := int64(1)
	prevHash := ""
	if err == nil {
		seq = last.Seq + 1
		prevHash = last.EventHash
	}
	eventHash := hashGroupAuthorityEvent(prevHash, groupID, seq, eventType, actorDID, messageULID, groupMembershipEpoch(membershipEpoch), payload)
	eventULID := fmt.Sprintf("gcfe-%d-%d", now.UnixNano(), seq)
	row := &groupEventModel{
		EventULID:              eventULID,
		GroupULID:              groupID,
		Seq:                    seq,
		PrevHash:               prevHash,
		EventHash:              eventHash,
		EventType:              eventType,
		ActorDID:               actorDID,
		MessageULID:            messageULID,
		MembershipEpoch:        groupMembershipEpoch(membershipEpoch),
		AuthorityStationPeerID: authorityStationPeerID,
		AuthorityEpoch:         authorityEpoch,
		ProposalULID:           proposalULID,
		IdempotencyKey:         idempotencyKey,
		Payload:                payload,
		CreatedAt:              now,
	}
	if err := tx.Create(row).Error; err != nil {
		return nil, false, err
	}
	return row, false, nil
}

func applyFollowerEventTx(tx *gorm.DB, now time.Time, event groupEventModel) (groupFollowerProjectionModel, error) {
	authorityPeerID := strings.TrimSpace(event.AuthorityStationPeerID)
	if authorityPeerID == "" {
		authorityPeerID = foundationLocalAuthorityStation
	}
	authorityEpoch := event.AuthorityEpoch
	if authorityEpoch <= 0 {
		authorityEpoch = foundationAuthorityEpoch
	}
	var projection groupFollowerProjectionModel
	err := tx.Where("group_ulid = ? AND authority_station_peer_id = ?", event.GroupULID, authorityPeerID).First(&projection).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return groupFollowerProjectionModel{}, err
	}
	expectedSeq := int64(1)
	expectedPrevHash := ""
	if err == nil {
		if event.Seq <= projection.LastSeq {
			if event.Seq == projection.LastSeq && event.EventHash != "" && event.EventHash != projection.LastEventHash {
				projection.Status = followerProjectionStatusReadOnly
				projection.ProtectionReason = fmt.Sprintf("replay hash mismatch at seq=%d, expected hash=%s got hash=%s", event.Seq, projection.LastEventHash, event.EventHash)
				projection.UpdatedAt = now
				if saveErr := tx.Save(&projection).Error; saveErr != nil {
					return projection, saveErr
				}
				return projection, errFollowerProjectionForkProtection
			}
			return projection, nil
		}
		expectedSeq = projection.LastSeq + 1
		expectedPrevHash = projection.LastEventHash
	}
	if event.Seq != expectedSeq || event.PrevHash != expectedPrevHash {
		reason := fmt.Sprintf("expected seq=%d prev_hash=%s, got seq=%d prev_hash=%s", expectedSeq, expectedPrevHash, event.Seq, event.PrevHash)
		if err == nil {
			if updateErr := tx.Model(&projection).Updates(map[string]any{
				"authority_epoch":   authorityEpoch,
				"status":            followerProjectionStatusReadOnly,
				"protection_reason": reason,
				"updated_at":        now,
			}).Error; updateErr != nil {
				return groupFollowerProjectionModel{}, updateErr
			}
			projection.AuthorityEpoch = authorityEpoch
			projection.Status = followerProjectionStatusReadOnly
			projection.ProtectionReason = reason
			return projection, errFollowerProjectionForkProtection
		}
		projection = groupFollowerProjectionModel{
			GroupULID:              event.GroupULID,
			AuthorityStationPeerID: authorityPeerID,
			AuthorityEpoch:         authorityEpoch,
			LastSeq:                0,
			LastEventHash:          "",
			Status:                 followerProjectionStatusReadOnly,
			ProtectionReason:       reason,
			CreatedAt:              now,
			UpdatedAt:              now,
		}
		if createErr := tx.Create(&projection).Error; createErr != nil {
			return groupFollowerProjectionModel{}, createErr
		}
		return projection, errFollowerProjectionForkProtection
	}
	if err == nil && projection.Status == followerProjectionStatusReadOnly {
		return projection, errFollowerProjectionForkProtection
	}
	if err == nil {
		if updateErr := tx.Model(&projection).Updates(map[string]any{
			"authority_epoch":   authorityEpoch,
			"last_seq":          event.Seq,
			"last_event_hash":   event.EventHash,
			"status":            followerProjectionStatusActive,
			"protection_reason": "",
			"updated_at":        now,
		}).Error; updateErr != nil {
			return groupFollowerProjectionModel{}, updateErr
		}
		projection.AuthorityEpoch = authorityEpoch
		projection.LastSeq = event.Seq
		projection.LastEventHash = event.EventHash
		projection.Status = followerProjectionStatusActive
		projection.ProtectionReason = ""
		return projection, nil
	}
	projection = groupFollowerProjectionModel{
		GroupULID:              event.GroupULID,
		AuthorityStationPeerID: authorityPeerID,
		AuthorityEpoch:         authorityEpoch,
		LastSeq:                event.Seq,
		LastEventHash:          event.EventHash,
		Status:                 followerProjectionStatusActive,
		ProtectionReason:       "",
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	if createErr := tx.Create(&projection).Error; createErr != nil {
		return groupFollowerProjectionModel{}, createErr
	}
	return projection, nil
}

func groupFromModel(row groupModel) group {
	return group{
		ID:              row.ULID,
		Name:            row.Name,
		Description:     row.Description,
		OwnerDID:        row.OwnerDID,
		MemberCount:     row.MemberCount,
		Status:          groupStatus(row.Status),
		DissolvedAt:     derefTime(row.DissolvedAt),
		MembershipEpoch: groupMembershipEpoch(row.MembershipEpoch),
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}

func groupToDomain(item *group) domain.Group {
	if item == nil {
		return domain.Group{}
	}
	return domain.Group{
		ID:              item.ID,
		Name:            item.Name,
		Description:     item.Description,
		OwnerDID:        item.OwnerDID,
		MemberCount:     item.MemberCount,
		Status:          groupStatus(item.Status),
		DissolvedAt:     item.DissolvedAt,
		MembershipEpoch: groupMembershipEpoch(item.MembershipEpoch),
		CreatedAt:       item.CreatedAt,
		UpdatedAt:       item.UpdatedAt,
	}
}

type service struct {
	mu                         sync.RWMutex
	db                         *gorm.DB
	authorityStationPeerID     string
	authorityStationIDResolver func() string
	groups                     map[string]*group
	messages                   map[string][]message
	messagesByID               map[string]message
	members                    map[string]map[string]*member
	invitations                map[string]*invitation
	settings                   map[string]map[string]groupSetting
	offline                    map[string][]offlineMessage
	unread                     map[string]map[string]int64
	threadReads                map[string]threadRead
	groupEvents                map[string][]domain.GroupEvent
	followers                  map[string]domain.FollowerProjection
	proposals                  map[string]domain.GroupProposalOutboxItem
	skdmOutbox                 map[string]domain.GroupSkdmEnvelope
}

func (s *service) authorityStationID() string {
	if s == nil {
		return foundationLocalAuthorityStation
	}
	if s.authorityStationIDResolver != nil {
		authority := strings.TrimSpace(s.authorityStationIDResolver())
		if authority != "" && authority != foundationLocalAuthorityStation {
			return authority
		}
	}
	authority := strings.TrimSpace(s.authorityStationPeerID)
	if authority == "" {
		return foundationLocalAuthorityStation
	}
	return authority
}

func (s *service) CreateGroup(ownerDID, name, description string) domain.Group {
	item := s.createGroup(ownerDID, name, description)
	return groupToDomain(item)
}

func (s *service) ListGroups(actorDID string) []domain.Group {
	items := s.listGroups(actorDID)
	out := make([]domain.Group, 0, len(items))
	for _, item := range items {
		copy := item
		out = append(out, groupToDomain(&copy))
	}
	return out
}

func (s *service) mergeGroupAttachmentsIntoDomainMessages(messages []domain.Message) error {
	if s.db == nil || len(messages) == 0 {
		return nil
	}
	ids := make([]string, len(messages))
	for i := range messages {
		ids[i] = messages[i].ID
	}
	var rows []MessageAttachmentModel
	if err := s.db.Where("message_ulid IN ?", ids).Find(&rows).Error; err != nil {
		return err
	}
	m := make(map[string][]domain.Attachment)
	for _, row := range rows {
		m[row.MessageULID] = append(m[row.MessageULID], domain.Attachment{
			CID:          row.CID,
			Filename:     row.Filename,
			MimeType:     row.MimeType,
			Size:         row.Size,
			ThumbnailCID: row.ThumbnailCID,
			Visibility:   row.Visibility,
		})
	}
	for i := range messages {
		if atts, ok := m[messages[i].ID]; ok {
			messages[i].Attachments = atts
		}
	}
	return nil
}

func (s *service) SendMessage(groupID, senderDID string, messageType int32, content, replyToID, threadRootID string, attachments []domain.Attachment, encryptedPayload []byte) domain.Message {
	item := s.appendMessage(groupID, senderDID, messageType, content, replyToID, threadRootID, attachments, encryptedPayload)
	var enc []byte
	if len(item.EncryptedPayload) > 0 {
		enc = append([]byte(nil), item.EncryptedPayload...)
	}
	return domain.Message{
		ID:               item.ID,
		GroupID:          item.GroupID,
		SenderDID:        item.SenderDID,
		Type:             item.Type,
		Content:          item.Content,
		ReplyToID:        item.ReplyToID,
		ThreadRootID:     item.ThreadRootID,
		Attachments:      append([]domain.Attachment(nil), item.Attachments...),
		EncryptedPayload: enc,
		SentAt:           item.SentAt,
	}
}

func (s *service) AcceptProposal(proposal domain.GroupProposal) (domain.GroupEvent, bool, error) {
	payload, err := proposalEventPayload(proposal)
	if err != nil {
		return domain.GroupEvent{}, false, err
	}
	idempotencyKey := strings.TrimSpace(proposal.IdempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = proposal.ProposalULID
	}
	now := proposal.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	if s.db != nil {
		var row *groupEventModel
		var replay bool
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var appendErr error
			row, replay, appendErr = appendAuthorityEventWithIdempotencyTx(
				tx,
				now,
				proposal.GroupID,
				"group.proposal.accepted",
				proposal.Actor.ActorDID,
				"",
				proposal.ObservedMembershipEpoch,
				proposal.AuthorityStationPeerID,
				proposal.AuthorityEpoch,
				proposal.ProposalULID,
				payload,
				idempotencyKey,
			)
			if appendErr != nil {
				return appendErr
			}
			if replay {
				return nil
			}
			if err := syncMemberActorRefTx(tx, now, proposal.GroupID, proposal.Actor); err != nil {
				return err
			}
			if err := syncProposalLifecycleActorRefsTx(tx, now, proposal); err != nil {
				return err
			}
			targets, err := federationFanoutTargetsTx(tx, proposal.GroupID, proposal.Actor.HomeStationPeerID, row.AuthorityStationPeerID)
			if err != nil {
				return err
			}
			for _, target := range targets {
				if err := enqueueFederationOutboxTx(tx, now, *row, target, proposal.Actor); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return domain.GroupEvent{}, false, err
		}
		return groupEventModelToDomain(*row, proposal.Actor), replay, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.groupEvents == nil {
		s.groupEvents = map[string][]domain.GroupEvent{}
	}
	for _, existing := range s.groupEvents[proposal.GroupID] {
		if existing.IdempotencyKey != idempotencyKey {
			continue
		}
		if existing.ProposalULID == proposal.ProposalULID &&
			existing.Actor.ActorDID == proposal.Actor.ActorDID &&
			existing.MembershipEpoch == groupMembershipEpoch(proposal.ObservedMembershipEpoch) &&
			string(existing.EventPayload) == payload {
			return existing, true, nil
		}
		return domain.GroupEvent{}, false, errAuthorityEventIdempotencyConflict
	}
	events := s.groupEvents[proposal.GroupID]
	seq := int64(len(events) + 1)
	prevHash := ""
	if len(events) > 0 {
		prevHash = events[len(events)-1].EventHash
	}
	eventHash := hashGroupAuthorityEvent(prevHash, proposal.GroupID, seq, "group.proposal.accepted", proposal.Actor.ActorDID, "", proposal.ObservedMembershipEpoch, payload)
	event := domain.GroupEvent{
		EventULID:              fmt.Sprintf("gcfe-%d-%d", now.UnixNano(), seq),
		GroupID:                proposal.GroupID,
		Seq:                    seq,
		PrevHash:               prevHash,
		EventHash:              eventHash,
		EventType:              "group.proposal.accepted",
		Actor:                  proposal.Actor,
		MembershipEpoch:        groupMembershipEpoch(proposal.ObservedMembershipEpoch),
		AuthorityStationPeerID: foundationLocalAuthorityStation,
		AuthorityEpoch:         foundationAuthorityEpoch,
		ProposalULID:           proposal.ProposalULID,
		IdempotencyKey:         idempotencyKey,
		EventPayload:           []byte(payload),
		CreatedAt:              now,
	}
	s.groupEvents[proposal.GroupID] = append(events, event)
	return event, false, nil
}

func (s *service) ListAuthorityEventsAfter(groupID string, afterSeq int64, limit int) ([]domain.GroupEvent, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	if s.db != nil {
		var rows []groupEventModel
		if err := s.db.
			Where("group_ulid = ? AND seq > ?", groupID, afterSeq).
			Order("seq ASC").
			Limit(limit).
			Find(&rows).Error; err != nil {
			return nil, err
		}
		events := make([]domain.GroupEvent, 0, len(rows))
		for _, row := range rows {
			events = append(events, groupEventModelToDomain(row, domain.FederatedActorRef{ActorDID: row.ActorDID}))
		}
		return events, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.groupEvents[groupID]
	events := make([]domain.GroupEvent, 0, min(limit, len(items)))
	for _, event := range items {
		if event.Seq <= afterSeq {
			continue
		}
		events = append(events, event)
		if len(events) >= limit {
			break
		}
	}
	return events, nil
}

func (s *service) GetAuthorityEventCursor(groupID string) (int64, string, error) {
	if s.db != nil {
		var row groupEventModel
		err := s.db.
			Where("group_ulid = ?", groupID).
			Order("seq DESC").
			Limit(1).
			First(&row).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return 0, "", nil
			}
			return 0, "", err
		}
		return row.Seq, row.EventHash, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.groupEvents[groupID]
	if len(items) == 0 {
		return 0, "", nil
	}
	last := items[len(items)-1]
	return last.Seq, last.EventHash, nil
}

func (s *service) MaterializeFollowerProjection(snapshot domain.Group, members []domain.Member, messages []domain.Message) error {
	snapshot.ID = strings.TrimSpace(snapshot.ID)
	if snapshot.ID == "" {
		return errors.New("follower projection group id is required")
	}
	now := time.Now()
	if s.db != nil {
		return s.db.Transaction(func(tx *gorm.DB) error {
			if err := upsertFollowerGroupTx(tx, now, snapshot); err != nil {
				return err
			}
			for _, member := range members {
				member.GroupID = snapshot.ID
				if strings.TrimSpace(member.ActorDID) == "" {
					member.ActorDID = strings.TrimSpace(member.Actor.ActorDID)
				}
				if strings.TrimSpace(member.ActorDID) == "" {
					continue
				}
				if err := upsertFollowerMemberTx(tx, now, member); err != nil {
					return err
				}
			}
			for _, msg := range messages {
				msg.GroupID = snapshot.ID
				msg.Content = ""
				if strings.TrimSpace(msg.ID) == "" {
					continue
				}
				if err := upsertFollowerMessageTx(tx, now, msg); err != nil {
					return err
				}
			}
			return nil
		})
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	item := group{
		ID:              snapshot.ID,
		Name:            snapshot.Name,
		Description:     snapshot.Description,
		OwnerDID:        snapshot.OwnerDID,
		MemberCount:     snapshot.MemberCount,
		Status:          groupStatus(snapshot.Status),
		DissolvedAt:     snapshot.DissolvedAt,
		MembershipEpoch: groupMembershipEpoch(snapshot.MembershipEpoch),
		CreatedAt:       snapshot.CreatedAt,
		UpdatedAt:       snapshot.UpdatedAt,
	}
	if item.CreatedAt.IsZero() {
		item.CreatedAt = now
	}
	if item.UpdatedAt.IsZero() {
		item.UpdatedAt = now
	}
	s.groups[snapshot.ID] = &item
	if s.members[snapshot.ID] == nil {
		s.members[snapshot.ID] = make(map[string]*member)
	}
	for _, m := range members {
		if strings.TrimSpace(m.ActorDID) == "" {
			m.ActorDID = strings.TrimSpace(m.Actor.ActorDID)
		}
		if strings.TrimSpace(m.ActorDID) == "" {
			continue
		}
		if m.JoinedAt.IsZero() {
			m.JoinedAt = now
		}
		local := &member{
			GroupID:    snapshot.ID,
			ActorDID:   m.ActorDID,
			Actor:      m.Actor,
			Role:       m.Role,
			Nickname:   m.Nickname,
			Muted:      m.Muted,
			MutedUntil: m.MutedUntil,
			JoinedAt:   m.JoinedAt,
			InvitedBy:  m.InvitedBy,
		}
		if strings.TrimSpace(local.Actor.ActorDID) == "" {
			local.Actor.ActorDID = local.ActorDID
		}
		s.members[snapshot.ID][local.ActorDID] = local
	}
	if s.messagesByID == nil {
		s.messagesByID = make(map[string]message)
	}
	existing := make(map[string]struct{}, len(s.messages[snapshot.ID]))
	for _, msg := range s.messages[snapshot.ID] {
		existing[msg.ID] = struct{}{}
	}
	for _, msg := range messages {
		if strings.TrimSpace(msg.ID) == "" {
			continue
		}
		item := message{
			ID:               msg.ID,
			GroupID:          snapshot.ID,
			SenderDID:        msg.SenderDID,
			Type:             msg.Type,
			Content:          "",
			EncryptedPayload: append([]byte(nil), msg.EncryptedPayload...),
			ReplyToID:        msg.ReplyToID,
			ThreadRootID:     msg.ThreadRootID,
			Attachments:      append([]domain.Attachment(nil), msg.Attachments...),
			Recalled:         msg.Recalled,
			EditedAt:         msg.EditedAt,
			SentAt:           msg.SentAt,
		}
		if item.SentAt.IsZero() {
			item.SentAt = now
		}
		if _, ok := existing[item.ID]; !ok {
			s.messages[snapshot.ID] = append(s.messages[snapshot.ID], item)
			existing[item.ID] = struct{}{}
		}
		s.messagesByID[item.ID] = item
	}
	sort.SliceStable(s.messages[snapshot.ID], func(i, j int) bool {
		return s.messages[snapshot.ID][i].ID < s.messages[snapshot.ID][j].ID
	})
	return nil
}

func (s *service) ListFollowerProjections(limit int) ([]domain.FollowerProjection, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	if s.db != nil {
		var rows []groupFollowerProjectionModel
		if err := s.db.
			Where("status IN ?", []string{followerProjectionStatusActive, followerProjectionStatusDegraded}).
			Order("updated_at ASC, id ASC").
			Limit(limit).
			Find(&rows).Error; err != nil {
			return nil, err
		}
		out := make([]domain.FollowerProjection, 0, len(rows))
		for _, row := range rows {
			out = append(out, followerProjectionModelToDomain(row))
		}
		return out, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]domain.FollowerProjection, 0, min(limit, len(s.followers)))
	for _, projection := range s.followers {
		if projection.Status != followerProjectionStatusActive && projection.Status != followerProjectionStatusDegraded {
			continue
		}
		out = append(out, projection)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *service) MarkFollowerProjectionDegraded(groupID, authorityStationPeerID, reason string) bool {
	groupID = strings.TrimSpace(groupID)
	authorityStationPeerID = strings.TrimSpace(authorityStationPeerID)
	if authorityStationPeerID == "" {
		authorityStationPeerID = foundationLocalAuthorityStation
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "authority sync unavailable"
	}
	now := time.Now()
	if s.db != nil {
		result := s.db.Model(&groupFollowerProjectionModel{}).
			Where("group_ulid = ? AND authority_station_peer_id = ? AND status <> ?", groupID, authorityStationPeerID, followerProjectionStatusReadOnly).
			Updates(map[string]any{
				"status":            followerProjectionStatusDegraded,
				"protection_reason": reason,
				"updated_at":        now,
			})
		return result.Error == nil && result.RowsAffected > 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := groupID + "\x00" + authorityStationPeerID
	projection, ok := s.followers[key]
	if !ok || projection.Status == followerProjectionStatusReadOnly {
		return false
	}
	projection.Status = followerProjectionStatusDegraded
	projection.ProtectionReason = reason
	s.followers[key] = projection
	return true
}

func (s *service) MarkFollowerProjectionActive(groupID, authorityStationPeerID string) bool {
	groupID = strings.TrimSpace(groupID)
	authorityStationPeerID = strings.TrimSpace(authorityStationPeerID)
	if authorityStationPeerID == "" {
		authorityStationPeerID = foundationLocalAuthorityStation
	}
	now := time.Now()
	if s.db != nil {
		result := s.db.Model(&groupFollowerProjectionModel{}).
			Where("group_ulid = ? AND authority_station_peer_id = ? AND status = ?", groupID, authorityStationPeerID, followerProjectionStatusDegraded).
			Updates(map[string]any{
				"status":            followerProjectionStatusActive,
				"protection_reason": "",
				"updated_at":        now,
			})
		return result.Error == nil && result.RowsAffected > 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := groupID + "\x00" + authorityStationPeerID
	projection, ok := s.followers[key]
	if !ok || projection.Status != followerProjectionStatusDegraded {
		return false
	}
	projection.Status = followerProjectionStatusActive
	projection.ProtectionReason = ""
	s.followers[key] = projection
	return true
}

func (s *service) EnqueueProposalOutbox(proposal domain.GroupProposal) (domain.GroupProposalOutboxItem, bool, error) {
	payload, err := proposalOutboxPayload(proposal)
	if err != nil {
		return domain.GroupProposalOutboxItem{}, false, err
	}
	idempotencyKey := strings.TrimSpace(proposal.IdempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = proposal.ProposalULID
	}
	now := proposal.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	authorityEpoch := proposal.AuthorityEpoch
	if authorityEpoch <= 0 {
		authorityEpoch = foundationAuthorityEpoch
	}
	if s.db != nil {
		var existing groupProposalOutboxModel
		err := s.db.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error
		if err == nil {
			if existing.ProposalULID == proposal.ProposalULID &&
				existing.GroupULID == proposal.GroupID &&
				existing.ActorDID == proposal.Actor.ActorDID &&
				existing.ActorHomeStationPeerID == proposal.Actor.HomeStationPeerID &&
				existing.AuthorityStationPeerID == proposal.AuthorityStationPeerID &&
				existing.AuthorityEpoch == authorityEpoch &&
				groupMembershipEpoch(existing.ObservedMembershipEpoch) == groupMembershipEpoch(proposal.ObservedMembershipEpoch) &&
				existing.Command == proposal.Command &&
				existing.Payload == payload {
				return groupProposalOutboxModelToDomain(existing, proposal.Actor), true, nil
			}
			return domain.GroupProposalOutboxItem{}, false, errProposalOutboxIdempotencyConflict
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.GroupProposalOutboxItem{}, false, err
		}
		row := groupProposalOutboxModel{
			ProposalULID:            proposal.ProposalULID,
			GroupULID:               proposal.GroupID,
			ActorDID:                proposal.Actor.ActorDID,
			ActorHomeStationPeerID:  proposal.Actor.HomeStationPeerID,
			AuthorityStationPeerID:  proposal.AuthorityStationPeerID,
			AuthorityEpoch:          authorityEpoch,
			ObservedMembershipEpoch: groupMembershipEpoch(proposal.ObservedMembershipEpoch),
			Command:                 proposal.Command,
			IdempotencyKey:          idempotencyKey,
			Status:                  proposalOutboxStatusPending,
			Payload:                 payload,
			CreatedAt:               now,
			UpdatedAt:               now,
		}
		if err := s.db.Create(&row).Error; err != nil {
			return domain.GroupProposalOutboxItem{}, false, err
		}
		item := groupProposalOutboxModelToDomain(row, proposal.Actor)
		item.Proposal = proposal
		return item, false, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.proposals == nil {
		s.proposals = map[string]domain.GroupProposalOutboxItem{}
	}
	if existing, ok := s.proposals[idempotencyKey]; ok {
		if existing.ProposalULID == proposal.ProposalULID &&
			existing.GroupID == proposal.GroupID &&
			existing.Actor.ActorDID == proposal.Actor.ActorDID &&
			existing.Actor.HomeStationPeerID == proposal.Actor.HomeStationPeerID &&
			existing.AuthorityStationPeerID == proposal.AuthorityStationPeerID &&
			existing.AuthorityEpoch == authorityEpoch &&
			existing.ObservedMembershipEpoch == groupMembershipEpoch(proposal.ObservedMembershipEpoch) &&
			existing.Command == proposal.Command {
			return existing, true, nil
		}
		return domain.GroupProposalOutboxItem{}, false, errProposalOutboxIdempotencyConflict
	}
	item := domain.GroupProposalOutboxItem{
		ProposalULID:            proposal.ProposalULID,
		GroupID:                 proposal.GroupID,
		Proposal:                proposal,
		Actor:                   proposal.Actor,
		Command:                 proposal.Command,
		AuthorityStationPeerID:  proposal.AuthorityStationPeerID,
		AuthorityEpoch:          authorityEpoch,
		ObservedMembershipEpoch: groupMembershipEpoch(proposal.ObservedMembershipEpoch),
		IdempotencyKey:          idempotencyKey,
		Status:                  proposalOutboxStatusPending,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	s.proposals[idempotencyKey] = item
	return item, false, nil
}

func (s *service) EnqueueGroupSkdmOutbox(envelope domain.GroupSkdmEnvelope) (domain.GroupSkdmEnvelope, bool, error) {
	idempotencyKey := strings.TrimSpace(envelope.IdempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = strings.Join([]string{
			envelope.GroupID,
			envelope.SenderDID,
			strconv.FormatUint(uint64(envelope.SenderKeyID), 10),
			envelope.RecipientDID,
			envelope.RecipientDeviceID,
		}, ":")
	}
	now := envelope.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	if s.db != nil {
		var existing groupSkdmOutboxModel
		err := s.db.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error
		if err == nil {
			if existing.GroupULID == envelope.GroupID &&
				groupMembershipEpoch(existing.MembershipEpoch) == groupMembershipEpoch(envelope.MembershipEpoch) &&
				existing.SenderDID == envelope.SenderDID &&
				existing.SenderKeyID == envelope.SenderKeyID &&
				existing.SenderHomeStationPeerID == envelope.SenderHomeStationPeerID &&
				existing.RecipientDID == envelope.RecipientDID &&
				existing.RecipientDeviceID == envelope.RecipientDeviceID &&
				existing.RecipientHomeStationPeerID == envelope.RecipientHomeStationPeerID &&
				string(existing.EncryptedPayload) == string(envelope.EncryptedPayload) {
				return groupSkdmOutboxModelToDomain(existing), true, nil
			}
			return domain.GroupSkdmEnvelope{}, false, errors.New("group skdm outbox idempotency conflict")
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.GroupSkdmEnvelope{}, false, err
		}
		row := groupSkdmOutboxModel{
			OutboxULID:                 fmt.Sprintf("gcskdm-%d", now.UnixNano()),
			GroupULID:                  envelope.GroupID,
			MembershipEpoch:            groupMembershipEpoch(envelope.MembershipEpoch),
			SenderDID:                  envelope.SenderDID,
			SenderKeyID:                envelope.SenderKeyID,
			SenderHomeStationPeerID:    envelope.SenderHomeStationPeerID,
			RecipientDID:               envelope.RecipientDID,
			RecipientDeviceID:          envelope.RecipientDeviceID,
			RecipientHomeStationPeerID: envelope.RecipientHomeStationPeerID,
			IdempotencyKey:             idempotencyKey,
			Status:                     skdmOutboxStatusPending,
			EncryptedPayload:           append([]byte(nil), envelope.EncryptedPayload...),
			CreatedAt:                  now,
			UpdatedAt:                  now,
		}
		if err := s.db.Create(&row).Error; err != nil {
			return domain.GroupSkdmEnvelope{}, false, err
		}
		return groupSkdmOutboxModelToDomain(row), false, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.skdmOutbox == nil {
		s.skdmOutbox = map[string]domain.GroupSkdmEnvelope{}
	}
	if existing, ok := s.skdmOutbox[idempotencyKey]; ok {
		if existing.GroupID == envelope.GroupID &&
			existing.MembershipEpoch == groupMembershipEpoch(envelope.MembershipEpoch) &&
			existing.SenderDID == envelope.SenderDID &&
			existing.SenderKeyID == envelope.SenderKeyID &&
			existing.SenderHomeStationPeerID == envelope.SenderHomeStationPeerID &&
			existing.RecipientDID == envelope.RecipientDID &&
			existing.RecipientDeviceID == envelope.RecipientDeviceID &&
			existing.RecipientHomeStationPeerID == envelope.RecipientHomeStationPeerID &&
			string(existing.EncryptedPayload) == string(envelope.EncryptedPayload) {
			return existing, true, nil
		}
		return domain.GroupSkdmEnvelope{}, false, errors.New("group skdm outbox idempotency conflict")
	}
	envelope.OutboxULID = fmt.Sprintf("gcskdm-%d", now.UnixNano())
	envelope.IdempotencyKey = idempotencyKey
	envelope.Status = skdmOutboxStatusPending
	envelope.MembershipEpoch = groupMembershipEpoch(envelope.MembershipEpoch)
	envelope.CreatedAt = now
	envelope.UpdatedAt = now
	s.skdmOutbox[idempotencyKey] = envelope
	return envelope, false, nil
}

func (s *service) ListPendingGroupSkdmOutbox(limit int, now time.Time) ([]domain.GroupSkdmEnvelope, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if now.IsZero() {
		now = time.Now()
	}
	if s.db != nil {
		var rows []groupSkdmOutboxModel
		err := s.db.
			Where("status = ? OR (status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?))", skdmOutboxStatusPending, skdmOutboxStatusRetryWait, now).
			Order("id ASC").
			Limit(limit).
			Find(&rows).Error
		if err != nil {
			return nil, err
		}
		items := make([]domain.GroupSkdmEnvelope, 0, len(rows))
		for _, row := range rows {
			items = append(items, groupSkdmOutboxModelToDomain(row))
		}
		return items, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]domain.GroupSkdmEnvelope, 0, limit)
	for _, item := range s.skdmOutbox {
		if item.Status != skdmOutboxStatusPending &&
			!(item.Status == skdmOutboxStatusRetryWait && (item.NextAttemptAt.IsZero() || !item.NextAttemptAt.After(now))) {
			continue
		}
		items = append(items, item)
		if len(items) >= limit {
			break
		}
	}
	return items, nil
}

func (s *service) MarkGroupSkdmOutboxDelivered(outboxULID string) bool {
	outboxULID = strings.TrimSpace(outboxULID)
	if outboxULID == "" {
		return false
	}
	now := time.Now()
	if s.db != nil {
		res := s.db.Model(&groupSkdmOutboxModel{}).
			Where("outbox_ulid = ?", outboxULID).
			Updates(map[string]interface{}{
				"status":          skdmOutboxStatusDelivered,
				"next_attempt_at": nil,
				"last_error":      "",
				"updated_at":      now,
			})
		return res.Error == nil && res.RowsAffected > 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, item := range s.skdmOutbox {
		if item.OutboxULID != outboxULID {
			continue
		}
		item.Status = skdmOutboxStatusDelivered
		item.NextAttemptAt = time.Time{}
		item.LastError = ""
		item.UpdatedAt = now
		s.skdmOutbox[key] = item
		return true
	}
	return false
}

func (s *service) MarkGroupSkdmOutboxRetry(outboxULID, lastError string, nextAttemptAt time.Time) bool {
	outboxULID = strings.TrimSpace(outboxULID)
	if outboxULID == "" {
		return false
	}
	now := time.Now()
	if nextAttemptAt.IsZero() {
		nextAttemptAt = now.Add(30 * time.Second)
	}
	if s.db != nil {
		res := s.db.Model(&groupSkdmOutboxModel{}).
			Where("outbox_ulid = ?", outboxULID).
			Updates(map[string]interface{}{
				"status":          skdmOutboxStatusRetryWait,
				"attempt_count":   gorm.Expr("attempt_count + 1"),
				"next_attempt_at": nextAttemptAt,
				"last_error":      lastError,
				"updated_at":      now,
			})
		return res.Error == nil && res.RowsAffected > 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, item := range s.skdmOutbox {
		if item.OutboxULID != outboxULID {
			continue
		}
		item.Status = skdmOutboxStatusRetryWait
		item.AttemptCount++
		item.NextAttemptAt = nextAttemptAt
		item.LastError = lastError
		item.UpdatedAt = now
		s.skdmOutbox[key] = item
		return true
	}
	return false
}

func (s *service) ListPendingProposalOutbox(limit int, now time.Time) ([]domain.GroupProposalOutboxItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if now.IsZero() {
		now = time.Now()
	}
	if s.db != nil {
		var rows []groupProposalOutboxModel
		err := s.db.
			Where("status = ? OR (status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?))", proposalOutboxStatusPending, proposalOutboxStatusRetryWait, now).
			Order("id ASC").
			Limit(limit).
			Find(&rows).Error
		if err != nil {
			return nil, err
		}
		items := make([]domain.GroupProposalOutboxItem, 0, len(rows))
		for _, row := range rows {
			proposal, err := proposalOutboxPayloadToProposal(row.Payload)
			if err != nil {
				return nil, err
			}
			item := groupProposalOutboxModelToDomain(row, proposal.Actor)
			item.Proposal = proposal
			items = append(items, item)
		}
		return items, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]domain.GroupProposalOutboxItem, 0, limit)
	for _, item := range s.proposals {
		if item.Status != proposalOutboxStatusPending &&
			!(item.Status == proposalOutboxStatusRetryWait && (item.NextAttemptAt.IsZero() || !item.NextAttemptAt.After(now))) {
			continue
		}
		items = append(items, item)
		if len(items) >= limit {
			break
		}
	}
	return items, nil
}

func (s *service) ListPendingFederationOutbox(limit int, now time.Time) ([]domain.FederationOutboxItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if now.IsZero() {
		now = time.Now()
	}
	if s.db == nil {
		return nil, nil
	}
	var rows []federationOutboxModel
	err := s.db.
		Where("status = ? OR (status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?))", federationOutboxStatusPending, federationOutboxStatusRetryWait, now).
		Order("id ASC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	items := make([]domain.FederationOutboxItem, 0, len(rows))
	for _, row := range rows {
		event, err := federationOutboxPayloadToEvent(row.Payload)
		if err != nil {
			return nil, err
		}
		item := federationOutboxModelToDomain(row)
		item.Event = event
		items = append(items, item)
	}
	return items, nil
}

func (s *service) MarkProposalOutboxAccepted(proposalULID string) bool {
	proposalULID = strings.TrimSpace(proposalULID)
	if proposalULID == "" {
		return false
	}
	now := time.Now()
	if s.db != nil {
		res := s.db.Model(&groupProposalOutboxModel{}).
			Where("proposal_ulid = ?", proposalULID).
			Updates(map[string]interface{}{
				"status":          proposalOutboxStatusAccepted,
				"next_attempt_at": nil,
				"last_error":      "",
				"updated_at":      now,
			})
		return res.Error == nil && res.RowsAffected > 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, item := range s.proposals {
		if item.ProposalULID != proposalULID {
			continue
		}
		item.Status = proposalOutboxStatusAccepted
		item.NextAttemptAt = time.Time{}
		item.LastError = ""
		item.UpdatedAt = now
		s.proposals[key] = item
		return true
	}
	return false
}

func (s *service) MarkFederationOutboxApplied(eventULID, targetStationPeerID string) bool {
	eventULID = strings.TrimSpace(eventULID)
	targetStationPeerID = strings.TrimSpace(targetStationPeerID)
	if eventULID == "" || targetStationPeerID == "" || s.db == nil {
		return false
	}
	res := s.db.Model(&federationOutboxModel{}).
		Where("event_ulid = ? AND target_station_peer_id = ?", eventULID, targetStationPeerID).
		Updates(map[string]interface{}{
			"status":          federationOutboxStatusApplied,
			"next_attempt_at": nil,
			"last_error":      "",
			"updated_at":      time.Now(),
		})
	return res.Error == nil && res.RowsAffected > 0
}

func (s *service) MarkFederationOutboxRetry(eventULID, targetStationPeerID, lastError string, nextAttemptAt time.Time) bool {
	eventULID = strings.TrimSpace(eventULID)
	targetStationPeerID = strings.TrimSpace(targetStationPeerID)
	if eventULID == "" || targetStationPeerID == "" || s.db == nil {
		return false
	}
	now := time.Now()
	if nextAttemptAt.IsZero() {
		nextAttemptAt = now.Add(30 * time.Second)
	}
	res := s.db.Model(&federationOutboxModel{}).
		Where("event_ulid = ? AND target_station_peer_id = ?", eventULID, targetStationPeerID).
		Updates(map[string]interface{}{
			"status":          federationOutboxStatusRetryWait,
			"attempt_count":   gorm.Expr("attempt_count + 1"),
			"next_attempt_at": nextAttemptAt,
			"last_error":      lastError,
			"updated_at":      now,
		})
	return res.Error == nil && res.RowsAffected > 0
}

func (s *service) MarkProposalOutboxRetry(proposalULID, lastError string, nextAttemptAt time.Time) bool {
	proposalULID = strings.TrimSpace(proposalULID)
	if proposalULID == "" {
		return false
	}
	now := time.Now()
	if nextAttemptAt.IsZero() {
		nextAttemptAt = now.Add(30 * time.Second)
	}
	if s.db != nil {
		res := s.db.Model(&groupProposalOutboxModel{}).
			Where("proposal_ulid = ?", proposalULID).
			Updates(map[string]interface{}{
				"status":          proposalOutboxStatusRetryWait,
				"attempt_count":   gorm.Expr("attempt_count + 1"),
				"next_attempt_at": nextAttemptAt,
				"last_error":      lastError,
				"updated_at":      now,
			})
		return res.Error == nil && res.RowsAffected > 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, item := range s.proposals {
		if item.ProposalULID != proposalULID {
			continue
		}
		item.Status = proposalOutboxStatusRetryWait
		item.AttemptCount++
		item.NextAttemptAt = nextAttemptAt
		item.LastError = lastError
		item.UpdatedAt = now
		s.proposals[key] = item
		return true
	}
	return false
}

func (s *service) ApplyFederationEvent(event domain.GroupEvent) (domain.FollowerProjection, error) {
	now := event.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}
	row := groupEventModel{
		EventULID:              event.EventULID,
		GroupULID:              event.GroupID,
		Seq:                    event.Seq,
		PrevHash:               event.PrevHash,
		EventHash:              event.EventHash,
		EventType:              event.EventType,
		ActorDID:               event.Actor.ActorDID,
		MessageULID:            event.MessageID,
		MembershipEpoch:        groupMembershipEpoch(event.MembershipEpoch),
		AuthorityStationPeerID: event.AuthorityStationPeerID,
		AuthorityEpoch:         event.AuthorityEpoch,
		ProposalULID:           event.ProposalULID,
		IdempotencyKey:         event.IdempotencyKey,
		Payload:                string(event.EventPayload),
		CreatedAt:              now,
	}
	if s.db != nil {
		var projection groupFollowerProjectionModel
		var applyErr error
		err := s.db.Transaction(func(tx *gorm.DB) error {
			projection, applyErr = applyFollowerEventTx(tx, now, row)
			if errors.Is(applyErr, errFollowerProjectionForkProtection) {
				return nil
			}
			return applyErr
		})
		if err != nil {
			return followerProjectionModelToDomain(projection), err
		}
		return followerProjectionModelToDomain(projection), applyErr
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.followers == nil {
		s.followers = map[string]domain.FollowerProjection{}
	}
	authorityPeerID := strings.TrimSpace(event.AuthorityStationPeerID)
	if authorityPeerID == "" {
		authorityPeerID = foundationLocalAuthorityStation
	}
	key := event.GroupID + "\x00" + authorityPeerID
	projection := s.followers[key]
	expectedSeq := int64(1)
	expectedPrevHash := ""
	if projection.GroupID != "" {
		if event.Seq <= projection.LastSeq {
			if event.Seq == projection.LastSeq && event.EventHash != "" && event.EventHash != projection.LastEventHash {
				if projection.Status != followerProjectionStatusReadOnly {
					projection.Status = followerProjectionStatusReadOnly
					projection.ProtectionReason = fmt.Sprintf("replay hash mismatch at seq=%d, expected hash=%s got hash=%s", event.Seq, projection.LastEventHash, event.EventHash)
				}
				s.followers[key] = projection
				return projection, errFollowerProjectionForkProtection
			}
			return projection, nil
		}
		expectedSeq = projection.LastSeq + 1
		expectedPrevHash = projection.LastEventHash
	}
	if event.Seq != expectedSeq || event.PrevHash != expectedPrevHash || projection.Status == followerProjectionStatusReadOnly {
		if projection.GroupID == "" {
			projection.GroupID = event.GroupID
			projection.AuthorityStationPeerID = authorityPeerID
			projection.AuthorityEpoch = event.AuthorityEpoch
		}
		if projection.Status != followerProjectionStatusReadOnly {
			projection.Status = followerProjectionStatusReadOnly
			projection.ProtectionReason = fmt.Sprintf("expected seq=%d prev_hash=%s, got seq=%d prev_hash=%s", expectedSeq, expectedPrevHash, event.Seq, event.PrevHash)
		}
		s.followers[key] = projection
		return projection, errFollowerProjectionForkProtection
	}
	projection = domain.FollowerProjection{
		GroupID:                event.GroupID,
		AuthorityStationPeerID: authorityPeerID,
		AuthorityEpoch:         event.AuthorityEpoch,
		LastSeq:                event.Seq,
		LastEventHash:          event.EventHash,
		Status:                 followerProjectionStatusActive,
	}
	s.followers[key] = projection
	return projection, nil
}

func (s *service) ListMessages(groupID, beforeUlid string, limit int) ([]domain.Message, error) {
	items := s.listMessages(groupID, beforeUlid, limit)
	out := make([]domain.Message, 0, len(items))
	for _, item := range items {
		var enc []byte
		if len(item.EncryptedPayload) > 0 {
			enc = append([]byte(nil), item.EncryptedPayload...)
		}
		out = append(out, domain.Message{
			ID:               item.ID,
			GroupID:          item.GroupID,
			SenderDID:        item.SenderDID,
			Type:             item.Type,
			Content:          item.Content,
			ReplyToID:        item.ReplyToID,
			ThreadRootID:     item.ThreadRootID,
			Attachments:      append([]domain.Attachment(nil), item.Attachments...),
			EncryptedPayload: enc,
			Recalled:         item.Recalled,
			EditedAt:         item.EditedAt,
			SentAt:           item.SentAt,
		})
	}
	if err := s.mergeGroupAttachmentsIntoDomainMessages(out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *service) ListThreadMessages(groupID, rootUlid, afterUlid string, limit int) ([]domain.Message, error) {
	items := s.listThreadMessages(groupID, rootUlid, afterUlid, limit)
	out := make([]domain.Message, 0, len(items))
	for _, item := range items {
		var enc []byte
		if len(item.EncryptedPayload) > 0 {
			enc = append([]byte(nil), item.EncryptedPayload...)
		}
		out = append(out, domain.Message{
			ID:               item.ID,
			GroupID:          item.GroupID,
			SenderDID:        item.SenderDID,
			Type:             item.Type,
			Content:          item.Content,
			ReplyToID:        item.ReplyToID,
			ThreadRootID:     item.ThreadRootID,
			Attachments:      append([]domain.Attachment(nil), item.Attachments...),
			EncryptedPayload: enc,
			Recalled:         item.Recalled,
			EditedAt:         item.EditedAt,
			SentAt:           item.SentAt,
		})
	}
	if err := s.mergeGroupAttachmentsIntoDomainMessages(out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *service) ThreadCounts(groupID, actorDID string, rootULIDs []string) ([]domain.ThreadCount, error) {
	return s.threadCounts(groupID, actorDID, rootULIDs)
}

func (s *service) MarkThreadRead(actorDID, groupID, rootULID, lastReadULID string) error {
	return s.markThreadRead(actorDID, groupID, rootULID, lastReadULID)
}

func (s *service) UnreadCount(actorDID, groupID string) int64 {
	return s.unreadCount(actorDID, groupID)
}

func (s *service) MarkRead(actorDID, groupID string) (int64, int64) {
	return s.markRead(actorDID, groupID)
}

func (s *service) GetGroup(groupID string) (*domain.Group, bool) {
	item, ok := s.getGroup(groupID)
	if !ok {
		return nil, false
	}
	next := groupToDomain(item)
	return &next, true
}

func (s *service) GetMember(groupID, actorDID string) (*domain.Member, bool) {
	item, ok := s.getMember(groupID, actorDID)
	if !ok {
		return nil, false
	}
	return memberToDomain(item), true
}

func (s *service) AddMember(groupID, actorDID, inviterDID string) (*domain.Member, bool) {
	item, ok := s.addMemberWithActorRef(groupID, domain.FederatedActorRef{ActorDID: actorDID}, inviterDID)
	if !ok {
		return nil, false
	}
	return memberToDomain(item), true
}

func (s *service) AddFederatedMember(groupID string, actor domain.FederatedActorRef, inviterDID string) (*domain.Member, bool) {
	item, ok := s.addMemberWithActorRef(groupID, actor, inviterDID)
	if !ok {
		return nil, false
	}
	return memberToDomain(item), true
}

func (s *service) UpdateMember(groupID, actorDID string, role *int32, muted *bool, mutedUntil *time.Time) (*domain.Member, bool) {
	item, ok := s.updateMember(groupID, actorDID, role, muted, mutedUntil)
	if !ok {
		return nil, false
	}
	return memberToDomain(item), true
}

func (s *service) RemoveMember(groupID, actorDID string) bool {
	return s.removeMember(groupID, actorDID)
}

func (s *service) TransferOwnership(groupID, currentOwnerDID, nextOwnerDID string) (*domain.Group, bool) {
	item, ok := s.transferOwnership(groupID, currentOwnerDID, nextOwnerDID)
	if !ok {
		return nil, false
	}
	next := groupToDomain(item)
	return &next, true
}

func (s *service) DissolveGroup(groupID string) bool {
	return s.dissolveGroup(groupID)
}

func (s *service) UpdateGroup(groupID string, name, description *string, muted *bool) (*domain.Group, bool) {
	item, ok := s.updateGroup(groupID, name, description, muted)
	if !ok {
		return nil, false
	}
	next := groupToDomain(item)
	return &next, true
}

func (s *service) ListMembers(groupID string, limit, offset int) ([]domain.Member, int) {
	items, total := s.listMembers(groupID, limit, offset)
	out := make([]domain.Member, 0, len(items))
	for _, item := range items {
		out = append(out, *memberToDomain(&item))
	}
	return out, total
}

func (s *service) CreateInvitation(groupID, inviterDID, inviteeDID string) domain.Invitation {
	item := s.createInvitation(groupID, inviterDID, inviteeDID)
	return domain.Invitation{
		ID:         item.ID,
		GroupID:    item.GroupID,
		InviterDID: item.InviterDID,
		InviteeDID: item.InviteeDID,
		Status:     item.Status,
		ExpireAt:   item.ExpireAt,
		CreatedAt:  item.CreatedAt,
	}
}

func (s *service) AcceptInvitation(invitationID, actorDID string) (string, bool) {
	return s.acceptInvitation(invitationID, actorDID)
}

// RecallMessage flips `recalled = true` on the row identified by
// messageULID, clearing content + encrypted_payload at the same
// time, then returns a `MutationOutcome` describing what changed
// so the application/handler layers can fan out a realtime
// `MessageMutation` event. Sender-ownership and the recall window
// are enforced here; the application layer is only responsible
// for membership.
//
// Errors:
//   - "group message not found"  — no row with that ulid in the group
//   - "not message owner"        — actor isn't the original sender
//   - "mutation window closed"   — sent_at older than recallWindow
//   - "message already recalled" — idempotency guard, treated as success at handler
func (s *service) RecallMessage(actorDID, groupID, messageULID string, recallWindow time.Duration) (domain.MutationOutcome, error) {
	return s.recallMessage(actorDID, groupID, messageULID, recallWindow)
}

// EditMessage replaces content + encrypted_payload with the
// caller-supplied values and stamps `edited_at = now()`. Same
// gating as RecallMessage; an edit on a recalled tombstone is
// rejected ("message already recalled").
func (s *service) EditMessage(actorDID, groupID, messageULID, newContent string, newCiphertext []byte, editWindow time.Duration) (domain.MutationOutcome, error) {
	return s.editMessage(actorDID, groupID, messageULID, newContent, newCiphertext, editWindow)
}

// DeleteMessage hard-deletes the row + its attachment metadata.
// Sender-ownership is enforced here; admin/owner moderation
// override happens in the application layer (which re-issues the
// call under the original sender's DID after looking it up via
// GetMessageSender). The window does NOT apply to delete — once
// you can recall, you can also rewrite the row to a tombstone;
// once you can delete the row entirely is a softer constraint.
func (s *service) DeleteMessage(actorDID, groupID, messageULID string) (domain.MutationOutcome, error) {
	return s.deleteMessage(actorDID, groupID, messageULID)
}

// GetMessageSender resolves the original sender DID for a row,
// used by the application layer's admin/owner delete-override
// path (so the repo's uniform "actor must equal sender" check
// stays simple — moderation is a policy concern, not a storage
// concern). Returns ("", false) when the row is missing.
func (s *service) GetMessageSender(groupID, messageULID string) (string, bool) {
	if s.db != nil {
		var row messageModel
		if err := s.db.Select("sender_did").
			Where("group_ulid = ? AND ulid = ?", groupID, messageULID).
			First(&row).Error; err != nil {
			return "", false
		}
		return row.SenderDID, true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if msg, ok := s.messagesByID[messageULID]; ok && msg.GroupID == groupID {
		return msg.SenderDID, true
	}
	return "", false
}

func (s *service) SearchMessages(groupID, query string, limit int) ([]domain.Message, error) {
	items := s.searchMessages(groupID, query, limit)
	out := make([]domain.Message, 0, len(items))
	for _, item := range items {
		var enc []byte
		if len(item.EncryptedPayload) > 0 {
			enc = append([]byte(nil), item.EncryptedPayload...)
		}
		out = append(out, domain.Message{
			ID:               item.ID,
			GroupID:          item.GroupID,
			SenderDID:        item.SenderDID,
			Type:             item.Type,
			Content:          item.Content,
			ReplyToID:        item.ReplyToID,
			ThreadRootID:     item.ThreadRootID,
			Attachments:      append([]domain.Attachment(nil), item.Attachments...),
			EncryptedPayload: enc,
			Recalled:         item.Recalled,
			EditedAt:         item.EditedAt,
			SentAt:           item.SentAt,
		})
	}
	if err := s.mergeGroupAttachmentsIntoDomainMessages(out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *service) UpdateNickname(groupID, actorDID, nickname string) (*domain.Member, bool) {
	item, ok := s.updateNickname(groupID, actorDID, nickname)
	if !ok {
		return nil, false
	}
	return memberToDomain(item), true
}

func (s *service) GetSettings(groupID, actorDID string) domain.GroupSetting {
	item := s.getSettings(groupID, actorDID)
	return domain.GroupSetting{
		IsMuted:            item.IsMuted,
		IsPinned:           item.IsPinned,
		ShowMemberNickname: item.ShowMemberNickname,
		AlertEnabled:       item.AlertEnabled,
		Background:         normalizedSettingBackground(item.Background),
		ClearedAtUnixMs:    item.ClearedAtUnixMs,
	}
}

func (s *service) UpdateSettings(groupID, actorDID string, muted, pinned, showNickname, alertEnabled *bool, background *string, clearedAtUnixMs *int64) {
	s.updateSettings(groupID, actorDID, groupSettingsPatch{
		muted:           muted,
		pinned:          pinned,
		showNickname:    showNickname,
		alertEnabled:    alertEnabled,
		background:      background,
		clearedAtUnixMs: clearedAtUnixMs,
	})
}

func (s *service) GetOfflineMessages(actorDID string, limit int) []domain.OfflineMessage {
	items := s.getOfflineMessages(actorDID, limit)
	out := make([]domain.OfflineMessage, 0, len(items))
	for _, item := range items {
		out = append(out, domain.OfflineMessage{
			ID:         item.ID,
			GroupID:    item.GroupID,
			MessageID:  item.MessageID,
			ReceiverID: item.ReceiverID,
			CreatedAt:  item.CreatedAt,
		})
	}
	return out
}

func (s *service) AckOffline(ulids []string) {
	s.ackOffline(ulids)
}

func (s *service) Stats() (int32, int32, int64, int32) {
	return s.stats()
}

func (s *service) bootstrapFromDB() error {
	if s.db == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var groups []groupModel
	if err := s.db.Find(&groups).Error; err != nil {
		return err
	}
	s.groups = make(map[string]*group, len(groups))
	for _, item := range groups {
		next := groupFromModel(item)
		g := &next
		s.groups[g.ID] = g
	}
	var members []memberModel
	if err := s.db.Find(&members).Error; err != nil {
		return err
	}
	s.members = make(map[string]map[string]*member)
	for _, item := range members {
		if s.members[item.GroupULID] == nil {
			s.members[item.GroupULID] = make(map[string]*member)
		}
		s.members[item.GroupULID][item.ActorDID] = memberFromModel(item)
	}
	var messages []messageModel
	if err := s.db.Order("sent_at ASC").Find(&messages).Error; err != nil {
		return err
	}
	s.messages = make(map[string][]message)
	s.messagesByID = make(map[string]message, len(messages))
	for _, item := range messages {
		var enc []byte
		if len(item.EncryptedPayload) > 0 {
			enc = append([]byte(nil), item.EncryptedPayload...)
		}
		m := message{
			ID:               item.ULID,
			GroupID:          item.GroupULID,
			SenderDID:        item.SenderDID,
			Type:             item.Type,
			Content:          item.Content,
			EncryptedPayload: enc,
			ReplyToID:        item.ReplyToID,
			ThreadRootID:     item.ThreadRootID,
			Recalled:         item.Recalled,
			EditedAt:         derefTime(item.EditedAt),
			SentAt:           item.SentAt,
		}
		s.messages[m.GroupID] = append(s.messages[m.GroupID], m)
		s.messagesByID[m.ID] = m
	}
	var invites []invitationModel
	if err := s.db.Find(&invites).Error; err != nil {
		return err
	}
	s.invitations = make(map[string]*invitation, len(invites))
	for _, item := range invites {
		s.invitations[item.ULID] = &invitation{
			ID:         item.ULID,
			GroupID:    item.GroupULID,
			InviterDID: item.InviterDID,
			InviteeDID: item.InviteeDID,
			Status:     item.Status,
			ExpireAt:   item.ExpireAt,
			CreatedAt:  item.CreatedAt,
		}
	}
	var settings []settingModel
	if err := s.db.Find(&settings).Error; err != nil {
		return err
	}
	s.settings = make(map[string]map[string]groupSetting)
	for _, item := range settings {
		if s.settings[item.GroupULID] == nil {
			s.settings[item.GroupULID] = make(map[string]groupSetting)
		}
		s.settings[item.GroupULID][item.ActorDID] = groupSetting{
			IsMuted:            item.IsMuted,
			IsPinned:           item.IsPinned,
			ShowMemberNickname: item.ShowMemberNickname,
		}
	}
	var offlineRows []offlineModel
	if err := s.db.Find(&offlineRows).Error; err != nil {
		return err
	}
	s.offline = make(map[string][]offlineMessage)
	for _, item := range offlineRows {
		s.offline[item.ReceiverID] = append(s.offline[item.ReceiverID], offlineMessage{
			ID:         item.ULID,
			GroupID:    item.GroupULID,
			MessageID:  item.MessageULID,
			ReceiverID: item.ReceiverID,
			CreatedAt:  item.CreatedAt,
		})
	}
	var threadReadRows []groupThreadReadModel
	if err := s.db.Find(&threadReadRows).Error; err != nil {
		return err
	}
	s.threadReads = make(map[string]threadRead, len(threadReadRows))
	for _, item := range threadReadRows {
		s.threadReads[groupThreadReadKey(item.GroupULID, item.RootULID, item.ActorDID)] = threadRead{
			GroupID:    item.GroupULID,
			RootID:     item.RootULID,
			ActorDID:   item.ActorDID,
			LastReadID: item.LastReadULID,
			LastReadAt: item.LastReadAt,
		}
	}
	s.unread = make(map[string]map[string]int64)
	for groupID, memberBucket := range s.members {
		if s.unread[groupID] == nil {
			s.unread[groupID] = make(map[string]int64)
		}
		for did := range memberBucket {
			s.unread[groupID][did] = 0
		}
	}
	for receiverID, items := range s.offline {
		for _, item := range items {
			if s.unread[item.GroupID] == nil {
				s.unread[item.GroupID] = make(map[string]int64)
			}
			s.unread[item.GroupID][receiverID]++
		}
	}
	return nil
}

func (s *service) dispatchOutbox() {
	if s.db == nil {
		return
	}
	var items []outboxModel
	if err := s.db.Where("status = ?", "pending").Order("id ASC").Limit(100).Find(&items).Error; err != nil {
		return
	}
	if len(items) == 0 {
		return
	}
	ids := make([]uint, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	_ = s.db.Model(&outboxModel{}).Where("id IN ?", ids).Updates(map[string]interface{}{
		"status":     "acked",
		"updated_at": time.Now(),
	}).Error
}

func (s *service) createGroup(ownerDID, name, description string) *group {
	if s.db != nil {
		now := time.Now()
		item := &group{
			ID:              fmt.Sprintf("gcg-%d", now.UnixNano()),
			Name:            name,
			Description:     description,
			OwnerDID:        ownerDID,
			MemberCount:     1,
			Status:          domain.GroupStatusActive,
			MembershipEpoch: 1,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&groupModel{
				ULID:            item.ID,
				Name:            item.Name,
				Description:     item.Description,
				OwnerDID:        item.OwnerDID,
				MemberCount:     item.MemberCount,
				Status:          item.Status,
				MembershipEpoch: item.MembershipEpoch,
				CreatedAt:       item.CreatedAt,
				UpdatedAt:       item.UpdatedAt,
			}).Error; err != nil {
				return err
			}
			if err := tx.Create(&memberModel{
				GroupULID: item.ID,
				ActorDID:  ownerDID,
				Role:      domain.GroupRoleOwner,
				JoinedAt:  now,
				CreatedAt: now,
				UpdatedAt: now,
			}).Error; err != nil {
				return err
			}
			if err := s.appendAuthorityEventTx(tx, now, item.ID, "group.created", ownerDID, "", item.MembershipEpoch, fmt.Sprintf(`{"owner_did":"%s"}`, ownerDID)); err != nil {
				return err
			}
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
				EventType: "group.created",
				TargetID:  item.ID,
				Payload:   fmt.Sprintf(`{"owner_did":"%s"}`, ownerDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		}); err != nil {
			return nil
		}
		return item
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	item := &group{
		ID:              fmt.Sprintf("gcg-%d", now.UnixNano()),
		Name:            name,
		Description:     description,
		OwnerDID:        ownerDID,
		MemberCount:     1,
		Status:          domain.GroupStatusActive,
		MembershipEpoch: 1,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	s.groups[item.ID] = item
	s.messages[item.ID] = []message{}
	if s.members == nil {
		s.members = make(map[string]map[string]*member)
	}
	if s.members[item.ID] == nil {
		s.members[item.ID] = make(map[string]*member)
	}
	s.members[item.ID][ownerDID] = &member{
		GroupID:  item.ID,
		ActorDID: ownerDID,
		Role:     domain.GroupRoleOwner,
		JoinedAt: now,
	}
	if s.unread == nil {
		s.unread = make(map[string]map[string]int64)
	}
	s.unread[item.ID] = make(map[string]int64)
	return item
}

func (s *service) listGroups(actorDID string) []group {
	if s.db != nil {
		var rows []groupModel
		if err := s.db.
			Joins("JOIN group_chat_members ON group_chat_members.group_ulid = group_chat_groups.ulid").
			Where("group_chat_members.actor_did = ?", actorDID).
			Order("group_chat_groups.updated_at DESC").
			Find(&rows).Error; err == nil {
			out := make([]group, 0, len(rows))
			for _, row := range rows {
				out = append(out, groupFromModel(row))
			}
			return out
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]group, 0)
	for _, item := range s.groups {
		members, ok := s.members[item.ID]
		if !ok {
			continue
		}
		if _, isMember := members[actorDID]; !isMember {
			continue
		}
		out = append(out, *item)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

func resolveGroupThreadRootID(db *gorm.DB, groupID, replyToID, explicitRootID string) (string, error) {
	if explicitRootID != "" {
		return explicitRootID, nil
	}
	if replyToID == "" {
		return "", nil
	}
	var parent messageModel
	if err := db.Where("group_ulid = ? AND ulid = ?", groupID, replyToID).First(&parent).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return replyToID, nil
		}
		return "", err
	}
	if parent.ThreadRootID != "" {
		return parent.ThreadRootID, nil
	}
	return parent.ULID, nil
}

func resolveGroupThreadRootIDInMemory(messagesByID map[string]message, groupID, replyToID, explicitRootID string) string {
	if explicitRootID != "" {
		return explicitRootID
	}
	if replyToID == "" {
		return ""
	}
	parent, ok := messagesByID[replyToID]
	if !ok || parent.GroupID != groupID {
		return replyToID
	}
	if parent.ThreadRootID != "" {
		return parent.ThreadRootID
	}
	return parent.ID
}

func groupThreadRepliesQuery(db *gorm.DB, groupID, rootULID string) *gorm.DB {
	return db.Where(
		"group_ulid = ? AND (thread_root_ulid = ? OR (COALESCE(thread_root_ulid, '') = '' AND reply_to_id = ?))",
		groupID,
		rootULID,
		rootULID,
	)
}

func isGroupThreadReply(msg message, rootULID string) bool {
	return msg.ThreadRootID == rootULID || (msg.ThreadRootID == "" && msg.ReplyToID == rootULID)
}

func (s *service) backfillThreadRootIDs() error {
	if s.db == nil {
		return nil
	}
	var rows []messageModel
	if err := s.db.
		Where("reply_to_id <> ''").
		Order("sent_at ASC, ulid ASC").
		Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}

	byULID := make(map[string]messageModel, len(rows))
	for _, row := range rows {
		byULID[row.ULID] = row
	}
	resolving := make(map[string]bool, len(rows))
	resolved := make(map[string]string, len(rows))
	var resolve func(messageModel) string
	resolve = func(row messageModel) string {
		if row.ThreadRootID != "" {
			return row.ThreadRootID
		}
		if cached, ok := resolved[row.ULID]; ok {
			return cached
		}
		if row.ReplyToID == "" || resolving[row.ULID] {
			return ""
		}
		resolving[row.ULID] = true
		root := row.ReplyToID
		if parent, ok := byULID[row.ReplyToID]; ok {
			if parentRoot := resolve(parent); parentRoot != "" {
				root = parentRoot
			}
		}
		resolving[row.ULID] = false
		resolved[row.ULID] = root
		return root
	}

	for _, row := range rows {
		root := resolve(row)
		if root == "" || root == row.ThreadRootID {
			continue
		}
		if err := s.db.Model(&messageModel{}).
			Where("id = ?", row.ID).
			Update("thread_root_ulid", root).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *service) appendMessage(groupID, senderDID string, messageType int32, content, replyToID, threadRootID string, attachments []domain.Attachment, encryptedPayload []byte) message {
	if s.db != nil {
		now := time.Now()
		var enc []byte
		if len(encryptedPayload) > 0 {
			enc = append([]byte(nil), encryptedPayload...)
		}
		resolvedThreadRootID, err := resolveGroupThreadRootID(s.db, groupID, replyToID, threadRootID)
		if err != nil {
			return message{}
		}
		item := message{
			ID:               nextGroupChatID("gcm", now),
			GroupID:          groupID,
			SenderDID:        senderDID,
			Type:             messageType,
			Content:          content,
			EncryptedPayload: enc,
			ReplyToID:        replyToID,
			ThreadRootID:     resolvedThreadRootID,
			SentAt:           now,
		}
		if len(attachments) > 0 {
			item.Attachments = append([]domain.Attachment(nil), attachments...)
		}
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			var groupRow groupModel
			if err := tx.Where("ulid = ?", groupID).First(&groupRow).Error; err != nil {
				return err
			}
			if err := tx.Create(&messageModel{
				ULID:             item.ID,
				GroupULID:        groupID,
				SenderDID:        senderDID,
				Type:             messageType,
				Content:          content,
				EncryptedPayload: enc,
				ReplyToID:        replyToID,
				ThreadRootID:     resolvedThreadRootID,
				Recalled:         false,
				SentAt:           now,
				CreatedAt:        now,
				UpdatedAt:        now,
			}).Error; err != nil {
				return err
			}
			for _, a := range attachments {
				row := MessageAttachmentModel{
					MessageULID:  item.ID,
					CID:          a.CID,
					Filename:     a.Filename,
					MimeType:     a.MimeType,
					Size:         a.Size,
					ThumbnailCID: a.ThumbnailCID,
					Visibility:   a.Visibility,
				}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			}
			var members []memberModel
			if err := tx.Where("group_ulid = ?", groupID).Find(&members).Error; err != nil {
				return err
			}
			for _, m := range members {
				if m.ActorDID == senderDID {
					continue
				}
				if err := tx.Create(&offlineModel{
					ULID:        nextGroupChatID("gco", time.Now()),
					GroupULID:   groupID,
					MessageULID: item.ID,
					ReceiverID:  m.ActorDID,
					CreatedAt:   now,
					UpdatedAt:   now,
				}).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&groupModel{}).Where("ulid = ?", groupID).Update("updated_at", now).Error; err != nil {
				return err
			}
			event, _, err := s.appendAuthorityEventRowTx(tx, now, groupID, "group.message.appended", senderDID, item.ID, groupRow.MembershipEpoch, fmt.Sprintf(`{"message_ulid":"%s","sender_did":"%s"}`, item.ID, senderDID))
			if err != nil {
				return err
			}
			if err := enqueueAuthorityEventFanoutTx(tx, now, *event, domain.FederatedActorRef{ActorDID: senderDID}); err != nil {
				return err
			}
			return tx.Create(&outboxModel{
				EventID:   nextGroupChatID("gce", time.Now()),
				EventType: "group.message.appended",
				TargetID:  groupID,
				Payload:   fmt.Sprintf(`{"message_ulid":"%s","sender_did":"%s"}`, item.ID, senderDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		}); err != nil {
			return message{}
		}
		return item
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	var enc []byte
	if len(encryptedPayload) > 0 {
		enc = append([]byte(nil), encryptedPayload...)
	}
	resolvedThreadRootID := resolveGroupThreadRootIDInMemory(s.messagesByID, groupID, replyToID, threadRootID)
	item := message{
		ID:               nextGroupChatID("gcm", now),
		GroupID:          groupID,
		SenderDID:        senderDID,
		Type:             messageType,
		Content:          content,
		EncryptedPayload: enc,
		ReplyToID:        replyToID,
		ThreadRootID:     resolvedThreadRootID,
		SentAt:           now,
	}
	if len(attachments) > 0 {
		item.Attachments = append([]domain.Attachment(nil), attachments...)
	}
	s.messages[groupID] = append(s.messages[groupID], item)
	if s.messagesByID == nil {
		s.messagesByID = make(map[string]message)
	}
	s.messagesByID[item.ID] = item
	if g, ok := s.groups[groupID]; ok {
		g.UpdatedAt = now
	}
	if s.members[groupID] != nil {
		for did := range s.members[groupID] {
			if did == senderDID {
				continue
			}
			s.unread[groupID][did]++
			if s.offline[did] == nil {
				s.offline[did] = make([]offlineMessage, 0)
			}
			s.offline[did] = append(s.offline[did], offlineMessage{
				ID:         nextGroupChatID("gco", time.Now()),
				GroupID:    groupID,
				MessageID:  item.ID,
				ReceiverID: did,
				CreatedAt:  now,
			})
		}
	}
	return item
}

func (s *service) listMessages(groupID, beforeUlid string, limit int) []message {
	if s.db != nil {
		var rows []messageModel
		query := s.db.Where("group_ulid = ?", groupID)
		if strings.HasPrefix(beforeUlid, "since:") {
			cursor := strings.TrimSpace(strings.TrimPrefix(beforeUlid, "since:"))
			if cursor != "" {
				query = query.Where("ulid > ?", cursor).Order("ulid ASC")
			} else {
				query = query.Order("ulid ASC")
			}
			if err := query.Limit(limit).Find(&rows).Error; err == nil {
				out := make([]message, 0, len(rows))
				for _, row := range rows {
					var enc []byte
					if len(row.EncryptedPayload) > 0 {
						enc = append([]byte(nil), row.EncryptedPayload...)
					}
					out = append(out, message{
						ID:               row.ULID,
						GroupID:          row.GroupULID,
						SenderDID:        row.SenderDID,
						Type:             row.Type,
						Content:          row.Content,
						EncryptedPayload: enc,
						ReplyToID:        row.ReplyToID,
						ThreadRootID:     row.ThreadRootID,
						Recalled:         row.Recalled,
						EditedAt:         derefTime(row.EditedAt),
						SentAt:           row.SentAt,
					})
				}
				return out
			}
		}
		if beforeUlid != "" {
			query = query.Where("ulid < ?", beforeUlid)
		}
		if err := query.Order("ulid DESC").Limit(limit).Find(&rows).Error; err == nil {
			out := make([]message, 0, len(rows))
			for i := len(rows) - 1; i >= 0; i-- {
				var enc []byte
				if len(rows[i].EncryptedPayload) > 0 {
					enc = append([]byte(nil), rows[i].EncryptedPayload...)
				}
				out = append(out, message{
					ID:               rows[i].ULID,
					GroupID:          rows[i].GroupULID,
					SenderDID:        rows[i].SenderDID,
					Type:             rows[i].Type,
					Content:          rows[i].Content,
					EncryptedPayload: enc,
					ReplyToID:        rows[i].ReplyToID,
					ThreadRootID:     rows[i].ThreadRootID,
					Recalled:         rows[i].Recalled,
					EditedAt:         derefTime(rows[i].EditedAt),
					SentAt:           rows[i].SentAt,
				})
			}
			return out
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.messages[groupID]
	if strings.HasPrefix(beforeUlid, "since:") {
		cursor := strings.TrimSpace(strings.TrimPrefix(beforeUlid, "since:"))
		out := make([]message, 0, len(items))
		for _, item := range items {
			if cursor == "" || item.ID > cursor {
				out = append(out, item)
			}
		}
		if len(out) > limit {
			out = out[:limit]
		}
		return out
	}
	if beforeUlid != "" {
		filtered := make([]message, 0, len(items))
		for _, item := range items {
			if item.ID < beforeUlid {
				filtered = append(filtered, item)
			}
		}
		if len(filtered) <= limit {
			out := make([]message, len(filtered))
			copy(out, filtered)
			return out
		}
		start := len(filtered) - limit
		out := make([]message, len(filtered[start:]))
		copy(out, filtered[start:])
		return out
	}
	if len(items) <= limit {
		out := make([]message, len(items))
		copy(out, items)
		return out
	}
	start := len(items) - limit
	out := make([]message, len(items[start:]))
	copy(out, items[start:])
	return out
}

func (s *service) listThreadMessages(groupID, rootUlid, afterUlid string, limit int) []message {
	if limit <= 0 {
		limit = 100
	}
	if s.db != nil {
		var root messageModel
		if err := s.db.Where("group_ulid = ? AND ulid = ?", groupID, rootUlid).First(&root).Error; err != nil {
			return nil
		}
		var replies []messageModel
		query := groupThreadRepliesQuery(s.db, groupID, rootUlid)
		if afterUlid != "" && afterUlid != rootUlid {
			var cursor messageModel
			err := groupThreadRepliesQuery(s.db, groupID, rootUlid).
				Where("ulid = ?", afterUlid).
				First(&cursor).Error
			if err == nil {
				query = query.Where("(sent_at > ? OR (sent_at = ? AND ulid > ?))", cursor.SentAt, cursor.SentAt, cursor.ULID)
			} else if errors.Is(err, gorm.ErrRecordNotFound) {
				query = query.Where("1 = 0")
			} else {
				return nil
			}
		}
		if err := query.
			Order("sent_at ASC, ulid ASC").
			Limit(limit).
			Find(&replies).Error; err != nil {
			return nil
		}
		rows := make([]messageModel, 0, 1+len(replies))
		rows = append(rows, root)
		rows = append(rows, replies...)
		out := make([]message, 0, len(rows))
		for _, row := range rows {
			var enc []byte
			if len(row.EncryptedPayload) > 0 {
				enc = append([]byte(nil), row.EncryptedPayload...)
			}
			out = append(out, message{
				ID:               row.ULID,
				GroupID:          row.GroupULID,
				SenderDID:        row.SenderDID,
				Type:             row.Type,
				Content:          row.Content,
				EncryptedPayload: enc,
				ReplyToID:        row.ReplyToID,
				ThreadRootID:     row.ThreadRootID,
				Recalled:         row.Recalled,
				EditedAt:         derefTime(row.EditedAt),
				SentAt:           row.SentAt,
			})
		}
		return out
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.messages[groupID]
	var root *message
	replies := make([]message, 0)
	for i := range items {
		item := items[i]
		if item.ID == rootUlid {
			copy := item
			root = &copy
			continue
		}
		if isGroupThreadReply(item, rootUlid) {
			replies = append(replies, item)
		}
	}
	if root == nil {
		return nil
	}
	sort.Slice(replies, func(i, j int) bool {
		if replies[i].SentAt.Equal(replies[j].SentAt) {
			return replies[i].ID < replies[j].ID
		}
		return replies[i].SentAt.Before(replies[j].SentAt)
	})
	if afterUlid != "" && afterUlid != rootUlid {
		afterIndex := -1
		for i := range replies {
			if replies[i].ID == afterUlid {
				afterIndex = i
				break
			}
		}
		if afterIndex < 0 {
			replies = replies[:0]
		} else {
			replies = replies[afterIndex+1:]
		}
	}
	if len(replies) > limit {
		replies = replies[:limit]
	}
	out := make([]message, 0, 1+len(replies))
	out = append(out, *root)
	out = append(out, replies...)
	return out
}

func (s *service) threadCounts(groupID, actorDID string, rootULIDs []string) ([]domain.ThreadCount, error) {
	out := make([]domain.ThreadCount, 0, len(rootULIDs))
	if len(rootULIDs) == 0 {
		return out, nil
	}

	if s.db != nil {
		readRows := make([]groupThreadReadModel, 0, len(rootULIDs))
		if err := s.db.
			Where("group_ulid = ? AND actor_did = ? AND root_ulid IN ?", groupID, actorDID, rootULIDs).
			Find(&readRows).Error; err != nil {
			return nil, err
		}
		readByRoot := make(map[string]groupThreadReadModel, len(readRows))
		for _, row := range readRows {
			readByRoot[row.RootULID] = row
		}

		for _, rootULID := range rootULIDs {
			item := domain.ThreadCount{RootULID: rootULID}
			if err := groupThreadRepliesQuery(s.db.Model(&messageModel{}), groupID, rootULID).
				Count(&item.ReplyCount).Error; err != nil {
				return nil, err
			}

			var latest messageModel
			if err := groupThreadRepliesQuery(s.db, groupID, rootULID).
				Order("sent_at DESC, ulid DESC").
				First(&latest).Error; err == nil {
				item.LatestReplyULID = latest.ULID
				item.LatestReplyAt = latest.SentAt
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}

			readAt := time.Time{}
			if read, ok := readByRoot[rootULID]; ok {
				readAt = read.LastReadAt
			}
			if err := groupThreadRepliesQuery(s.db.Model(&messageModel{}), groupID, rootULID).
				Where("sent_at > ? AND sender_did <> ?", readAt, actorDID).
				Count(&item.UnreadCount).Error; err != nil {
				return nil, err
			}

			out = append(out, item)
		}

		return out, nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.messages[groupID]
	for _, rootULID := range rootULIDs {
		item := domain.ThreadCount{RootULID: rootULID}
		readAt := time.Time{}
		if read, ok := s.threadReads[groupThreadReadKey(groupID, rootULID, actorDID)]; ok {
			readAt = read.LastReadAt
		}
		for _, msg := range items {
			if !isGroupThreadReply(msg, rootULID) {
				continue
			}
			item.ReplyCount++
			if item.LatestReplyAt.IsZero() ||
				msg.SentAt.After(item.LatestReplyAt) ||
				(msg.SentAt.Equal(item.LatestReplyAt) && msg.ID > item.LatestReplyULID) {
				item.LatestReplyULID = msg.ID
				item.LatestReplyAt = msg.SentAt
			}
			if msg.SenderDID != actorDID && msg.SentAt.After(readAt) {
				item.UnreadCount++
			}
		}
		out = append(out, item)
	}

	return out, nil
}

func (s *service) markThreadRead(actorDID, groupID, rootULID, lastReadULID string) error {
	if s.db != nil {
		return s.db.Transaction(func(tx *gorm.DB) error {
			var root messageModel
			if err := tx.Where("group_ulid = ? AND ulid = ?", groupID, rootULID).First(&root).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errGroupMessageNotFound
				}
				return err
			}

			cursorULID := root.ULID
			cursorAt := root.SentAt
			if lastReadULID != "" {
				var provided messageModel
				err := tx.
					Where("group_ulid = ? AND ulid = ? AND (ulid = ? OR thread_root_ulid = ? OR (COALESCE(thread_root_ulid, '') = '' AND reply_to_id = ?))", groupID, lastReadULID, rootULID, rootULID, rootULID).
					First(&provided).Error
				if err == nil {
					cursorULID = provided.ULID
					cursorAt = provided.SentAt
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				} else if latestULID, latestAt, ok, latestErr := latestGroupThreadCursor(tx, groupID, rootULID); latestErr != nil {
					return latestErr
				} else if ok {
					cursorULID = latestULID
					cursorAt = latestAt
				}
			} else if latestULID, latestAt, ok, err := latestGroupThreadCursor(tx, groupID, rootULID); err != nil {
				return err
			} else if ok {
				cursorULID = latestULID
				cursorAt = latestAt
			}

			now := time.Now()
			var read groupThreadReadModel
			return tx.
				Where("group_ulid = ? AND root_ulid = ? AND actor_did = ?", groupID, rootULID, actorDID).
				Assign(groupThreadReadModel{
					LastReadULID: cursorULID,
					LastReadAt:   cursorAt,
					UpdatedAt:    now,
				}).
				FirstOrCreate(&read, groupThreadReadModel{
					GroupULID: groupID,
					RootULID:  rootULID,
					ActorDID:  actorDID,
					CreatedAt: now,
				}).Error
		})
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	root, ok := s.messagesByID[rootULID]
	if !ok || root.GroupID != groupID {
		return errGroupMessageNotFound
	}

	cursorULID := root.ID
	cursorAt := root.SentAt
	if lastReadULID != "" {
		if provided, ok := s.messagesByID[lastReadULID]; ok &&
			provided.GroupID == groupID &&
			(provided.ID == rootULID || isGroupThreadReply(provided, rootULID)) {
			cursorULID = provided.ID
			cursorAt = provided.SentAt
		} else if latestULID, latestAt, ok := latestGroupThreadCursorInMemory(s.messages[groupID], rootULID); ok {
			cursorULID = latestULID
			cursorAt = latestAt
		}
	} else if latestULID, latestAt, ok := latestGroupThreadCursorInMemory(s.messages[groupID], rootULID); ok {
		cursorULID = latestULID
		cursorAt = latestAt
	}

	if s.threadReads == nil {
		s.threadReads = make(map[string]threadRead)
	}
	s.threadReads[groupThreadReadKey(groupID, rootULID, actorDID)] = threadRead{
		GroupID:    groupID,
		RootID:     rootULID,
		ActorDID:   actorDID,
		LastReadID: cursorULID,
		LastReadAt: cursorAt,
	}

	return nil
}

func latestGroupThreadCursor(tx *gorm.DB, groupID, rootULID string) (string, time.Time, bool, error) {
	var latest messageModel
	if err := groupThreadRepliesQuery(tx, groupID, rootULID).
		Order("sent_at DESC, ulid DESC").
		First(&latest).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", time.Time{}, false, nil
		}
		return "", time.Time{}, false, err
	}

	return latest.ULID, latest.SentAt, true, nil
}

func latestGroupThreadCursorInMemory(messages []message, rootULID string) (string, time.Time, bool) {
	latestULID := ""
	latestAt := time.Time{}
	for _, msg := range messages {
		if !isGroupThreadReply(msg, rootULID) {
			continue
		}
		if latestAt.IsZero() ||
			msg.SentAt.After(latestAt) ||
			(msg.SentAt.Equal(latestAt) && msg.ID > latestULID) {
			latestULID = msg.ID
			latestAt = msg.SentAt
		}
	}

	return latestULID, latestAt, latestULID != ""
}

func groupThreadReadKey(groupID, rootULID, actorDID string) string {
	return groupID + "|" + rootULID + "|" + actorDID
}

func (s *service) unreadCount(actorDID, groupID string) int64 {
	if s.db != nil {
		var count int64
		query := s.db.Model(&offlineModel{}).Where("receiver_id = ?", actorDID)
		if groupID != "" {
			query = query.Where("group_ulid = ?", groupID)
		}
		if err := query.Count(&count).Error; err == nil {
			return count
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if groupID == "" {
		total := int64(0)
		for _, bucket := range s.unread {
			total += bucket[actorDID]
		}
		return total
	}
	return s.unread[groupID][actorDID]
}

func (s *service) markRead(actorDID, groupID string) (int64, int64) {
	if s.db != nil {
		now := time.Now()
		res := s.db.Where("receiver_id = ? AND group_ulid = ?", actorDID, groupID).Delete(&offlineModel{})
		current := res.RowsAffected
		_ = s.db.Create(&outboxModel{
			EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
			EventType: "group.message.read",
			TargetID:  groupID,
			Payload:   fmt.Sprintf(`{"actor_did":"%s","marked_count":%d}`, actorDID, current),
			Status:    "pending",
			CreatedAt: now,
			UpdatedAt: now,
		}).Error
		return current, 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.unread[groupID][actorDID]
	s.unread[groupID][actorDID] = 0
	if s.offline[actorDID] != nil {
		out := make([]offlineMessage, 0, len(s.offline[actorDID]))
		for _, item := range s.offline[actorDID] {
			if item.GroupID == groupID {
				continue
			}
			out = append(out, item)
		}
		s.offline[actorDID] = out
	}
	if s.db != nil {
		_ = s.db.Where("receiver_id = ? AND group_ulid = ?", actorDID, groupID).Delete(&offlineModel{}).Error
		_ = s.db.Create(&outboxModel{
			EventID:   fmt.Sprintf("gce-%d", time.Now().UnixNano()),
			EventType: "group.message.read",
			TargetID:  groupID,
			Payload:   fmt.Sprintf(`{"actor_did":"%s","marked_count":%d}`, actorDID, current),
			Status:    "pending",
		}).Error
	}
	return current, 0
}

func (s *service) getGroup(groupID string) (*group, bool) {
	if s.db != nil {
		var row groupModel
		if err := s.db.Where("ulid = ?", groupID).First(&row).Error; err == nil {
			item := groupFromModel(row)
			return &item, true
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.groups[groupID]
	if !ok {
		return nil, false
	}
	copy := *item
	return &copy, true
}

func (s *service) updateGroup(groupID string, name, description *string, muted *bool) (*group, bool) {
	if s.db != nil {
		now := time.Now()
		updates := map[string]interface{}{"updated_at": now}
		if name != nil {
			updates["name"] = *name
		}
		if description != nil {
			updates["description"] = *description
		}
		if err := s.db.Model(&groupModel{}).Where("ulid = ?", groupID).Updates(updates).Error; err != nil {
			return nil, false
		}
		return s.getGroup(groupID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.groups[groupID]
	if !ok {
		return nil, false
	}
	if name != nil {
		item.Name = *name
	}
	if description != nil {
		item.Description = *description
	}
	if muted != nil {
	}
	item.UpdatedAt = time.Now()
	copy := *item
	return &copy, true
}

func (s *service) getMember(groupID, actorDID string) (*member, bool) {
	if s.db != nil {
		var row memberModel
		if err := s.db.Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).First(&row).Error; err == nil {
			return memberFromModel(row), true
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	bucket := s.members[groupID]
	if bucket == nil {
		return nil, false
	}
	item, ok := bucket[actorDID]
	if !ok {
		return nil, false
	}
	copy := *item
	return &copy, true
}

func (s *service) addMember(groupID, actorDID, inviterDID string) (*member, bool) {
	return s.addMemberWithActorRef(groupID, domain.FederatedActorRef{ActorDID: actorDID}, inviterDID)
}

func (s *service) addMemberWithActorRef(groupID string, actor domain.FederatedActorRef, inviterDID string) (*member, bool) {
	actorDID := strings.TrimSpace(actor.ActorDID)
	if actorDID == "" {
		return nil, false
	}
	if s.db != nil {
		now := time.Now()
		item := &member{
			GroupID:   groupID,
			ActorDID:  actorDID,
			Role:      domain.GroupRoleMember,
			JoinedAt:  now,
			InvitedBy: inviterDID,
			Actor:     actor,
		}
		added := false
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var groupRow groupModel
			if err := tx.Where("ulid = ?", groupID).First(&groupRow).Error; err != nil {
				return err
			}
			var existed int64
			if err := tx.Model(&memberModel{}).Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).Count(&existed).Error; err != nil {
				return err
			}
			if existed == 0 {
				if err := tx.Create(&memberModel{
					GroupULID:              groupID,
					ActorDID:               actorDID,
					Role:                   item.Role,
					Nickname:               item.Nickname,
					Muted:                  item.Muted,
					JoinedAt:               item.JoinedAt,
					InvitedBy:              item.InvitedBy,
					ActorHomeStationPeerID: actor.HomeStationPeerID,
					ActorHomeStationDomain: actor.HomeStationDomain,
					ActorFederatedHandle:   actor.FederatedHandle,
					ActorProfileVersion:    actor.ProfileVersion,
					ActorFederationID:      actor.FederationID,
					CreatedAt:              now,
					UpdatedAt:              now,
				}).Error; err != nil {
					return err
				}
				added = true
			} else if strings.TrimSpace(actor.HomeStationPeerID) != "" {
				if err := syncMemberActorRefTx(tx, now, groupID, actor); err != nil {
					return err
				}
			}
			var count int64
			if err := tx.Model(&memberModel{}).Where("group_ulid = ?", groupID).Count(&count).Error; err != nil {
				return err
			}
			updates := map[string]interface{}{
				"member_count": int32(count),
				"updated_at":   now,
			}
			if added {
				updates["membership_epoch"] = gorm.Expr("CASE WHEN membership_epoch <= 0 THEN 2 ELSE membership_epoch + 1 END")
			}
			if err := tx.Model(&groupModel{}).Where("ulid = ?", groupID).Updates(updates).Error; err != nil {
				return err
			}
			if added {
				nextEpoch := groupMembershipEpoch(groupRow.MembershipEpoch) + 1
				event, _, err := s.appendAuthorityEventRowTx(tx, now, groupID, "group.member.joined", actorDID, "", nextEpoch, fmt.Sprintf(`{"actor_did":"%s","inviter_did":"%s"}`, actorDID, inviterDID))
				if err != nil {
					return err
				}
				if err := enqueueAuthorityEventHistoryForTargetTx(tx, now, groupID, actor.HomeStationPeerID, actor); err != nil {
					return err
				}
				if err := enqueueAuthorityEventFanoutTx(tx, now, *event, actor); err != nil {
					return err
				}
			}
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
				EventType: "group.member.joined",
				TargetID:  groupID,
				Payload:   fmt.Sprintf(`{"actor_did":"%s"}`, actorDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		})
		if err != nil {
			return nil, false
		}
		return item, true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.groups[groupID] == nil {
		return nil, false
	}
	if s.members[groupID] == nil {
		s.members[groupID] = make(map[string]*member)
	}
	now := time.Now()
	item := &member{
		GroupID:   groupID,
		ActorDID:  actorDID,
		Role:      domain.GroupRoleMember,
		JoinedAt:  now,
		InvitedBy: inviterDID,
		Actor:     actor,
	}
	_, existed := s.members[groupID][actorDID]
	s.members[groupID][actorDID] = item
	s.groups[groupID].MemberCount = int32(len(s.members[groupID]))
	if !existed {
		s.groups[groupID].MembershipEpoch = groupMembershipEpoch(s.groups[groupID].MembershipEpoch) + 1
	}
	s.groups[groupID].UpdatedAt = now
	if s.unread[groupID] == nil {
		s.unread[groupID] = make(map[string]int64)
	}
	copy := *item
	return &copy, true
}

func (s *service) updateMember(groupID, actorDID string, role *int32, muted *bool, mutedUntil *time.Time) (*member, bool) {
	now := time.Now()
	if s.db != nil {
		updates := map[string]interface{}{"updated_at": now}
		if role != nil {
			updates["role"] = *role
		}
		if muted != nil {
			updates["muted"] = *muted
		}
		if mutedUntil != nil {
			if mutedUntil.IsZero() {
				updates["muted_until"] = nil
			} else {
				updates["muted_until"] = *mutedUntil
			}
		}
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var existing memberModel
			if err := tx.Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).First(&existing).Error; err != nil {
				return err
			}
			if err := tx.Model(&memberModel{}).
				Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).
				Updates(updates).Error; err != nil {
				return err
			}
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
				EventType: "group.member.updated",
				TargetID:  groupID,
				Payload:   fmt.Sprintf(`{"actor_did":"%s"}`, actorDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		})
		if err != nil {
			return nil, false
		}
		return s.getMember(groupID, actorDID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	bucket := s.members[groupID]
	item := bucket[actorDID]
	if item == nil {
		return nil, false
	}
	if role != nil {
		item.Role = *role
	}
	if muted != nil {
		item.Muted = *muted
	}
	if mutedUntil != nil {
		item.MutedUntil = *mutedUntil
	}
	if group := s.groups[groupID]; group != nil {
		group.UpdatedAt = now
	}
	copy := *item
	return &copy, true
}

func (s *service) removeMember(groupID, actorDID string) bool {
	if s.db != nil {
		now := time.Now()
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var groupRow groupModel
			if err := tx.Where("ulid = ?", groupID).First(&groupRow).Error; err != nil {
				return err
			}
			result := tx.Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).Delete(&memberModel{})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return gorm.ErrRecordNotFound
			}
			var count int64
			if err := tx.Model(&memberModel{}).Where("group_ulid = ?", groupID).Count(&count).Error; err != nil {
				return err
			}
			if err := tx.Model(&groupModel{}).Where("ulid = ?", groupID).Updates(map[string]interface{}{
				"member_count":     int32(count),
				"membership_epoch": gorm.Expr("CASE WHEN membership_epoch <= 0 THEN 2 ELSE membership_epoch + 1 END"),
				"updated_at":       now,
			}).Error; err != nil {
				return err
			}
			nextEpoch := groupMembershipEpoch(groupRow.MembershipEpoch) + 1
			if err := s.appendAuthorityEventTx(tx, now, groupID, "group.member.removed", actorDID, "", nextEpoch, fmt.Sprintf(`{"actor_did":"%s"}`, actorDID)); err != nil {
				return err
			}
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
				EventType: "group.member.removed",
				TargetID:  groupID,
				Payload:   fmt.Sprintf(`{"actor_did":"%s"}`, actorDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		})
		if err != nil {
			return false
		}
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.members[groupID] == nil {
		return false
	}
	if _, ok := s.members[groupID][actorDID]; !ok {
		return false
	}
	delete(s.members[groupID], actorDID)
	if s.groups[groupID] != nil {
		s.groups[groupID].MemberCount = int32(len(s.members[groupID]))
		s.groups[groupID].MembershipEpoch = groupMembershipEpoch(s.groups[groupID].MembershipEpoch) + 1
		s.groups[groupID].UpdatedAt = time.Now()
	}
	return true
}

func (s *service) transferOwnership(groupID, currentOwnerDID, nextOwnerDID string) (*group, bool) {
	if s.db != nil {
		now := time.Now()
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var groupRow groupModel
			if err := tx.Where("ulid = ? AND owner_did = ?", groupID, currentOwnerDID).First(&groupRow).Error; err != nil {
				return err
			}
			var target memberModel
			if err := tx.Where("group_ulid = ? AND actor_did = ?", groupID, nextOwnerDID).First(&target).Error; err != nil {
				return err
			}
			if target.Role == domain.GroupRoleOwner {
				return gorm.ErrInvalidData
			}
			if err := tx.Model(&groupModel{}).Where("ulid = ?", groupID).Updates(map[string]interface{}{
				"owner_did":  nextOwnerDID,
				"updated_at": now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&memberModel{}).Where("group_ulid = ? AND actor_did = ?", groupID, currentOwnerDID).Updates(map[string]interface{}{
				"role":       domain.GroupRoleAdmin,
				"updated_at": now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&memberModel{}).Where("group_ulid = ? AND actor_did = ?", groupID, nextOwnerDID).Updates(map[string]interface{}{
				"role":        domain.GroupRoleOwner,
				"muted":       false,
				"muted_until": nil,
				"updated_at":  now,
			}).Error; err != nil {
				return err
			}
			if err := s.appendAuthorityEventTx(tx, now, groupID, "group.owner.transferred", currentOwnerDID, "", groupRow.MembershipEpoch, fmt.Sprintf(`{"from_did":"%s","to_did":"%s"}`, currentOwnerDID, nextOwnerDID)); err != nil {
				return err
			}
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
				EventType: "group.owner.transferred",
				TargetID:  groupID,
				Payload:   fmt.Sprintf(`{"from_did":"%s","to_did":"%s"}`, currentOwnerDID, nextOwnerDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		})
		if err != nil {
			return nil, false
		}
		return s.getGroup(groupID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.groups[groupID]
	if item == nil || item.OwnerDID != currentOwnerDID {
		return nil, false
	}
	bucket := s.members[groupID]
	if bucket == nil {
		return nil, false
	}
	currentOwner := bucket[currentOwnerDID]
	nextOwner := bucket[nextOwnerDID]
	if currentOwner == nil || nextOwner == nil || nextOwner.Role == domain.GroupRoleOwner {
		return nil, false
	}
	now := time.Now()
	item.OwnerDID = nextOwnerDID
	item.UpdatedAt = now
	currentOwner.Role = domain.GroupRoleAdmin
	nextOwner.Role = domain.GroupRoleOwner
	nextOwner.Muted = false
	nextOwner.MutedUntil = time.Time{}
	copy := *item
	return &copy, true
}

func (s *service) dissolveGroup(groupID string) bool {
	if s.db != nil {
		now := time.Now()
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var row groupModel
			if err := tx.Where("ulid = ?", groupID).First(&row).Error; err != nil {
				return err
			}
			if !isGroupDissolved(row.Status) {
				if err := tx.Model(&groupModel{}).
					Where("id = ?", row.ID).
					Updates(map[string]interface{}{
						"status":       domain.GroupStatusDissolved,
						"dissolved_at": now,
						"updated_at":   now,
					}).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&invitationModel{}).
				Where("group_ulid = ? AND status = ?", groupID, groupInvitationStatusPending).
				Updates(map[string]interface{}{
					"status":     groupInvitationStatusExpired,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
			if err := s.appendAuthorityEventTx(tx, now, groupID, "group.dissolved", row.OwnerDID, "", row.MembershipEpoch, `{}`); err != nil {
				return err
			}
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
				EventType: "group.dissolved",
				TargetID:  groupID,
				Payload:   `{}`,
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		})
		return err == nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.groups[groupID]
	if item == nil {
		return false
	}
	now := time.Now()
	if !isGroupDissolved(item.Status) {
		item.Status = domain.GroupStatusDissolved
		item.DissolvedAt = now
		item.UpdatedAt = now
	}
	for key, inv := range s.invitations {
		if inv.GroupID == groupID && inv.Status == groupInvitationStatusPending {
			inv.Status = groupInvitationStatusExpired
			s.invitations[key] = inv
		}
	}
	return true
}

func (s *service) listMembers(groupID string, limit, offset int) ([]member, int) {
	if s.db != nil {
		var total int64
		query := s.db.Model(&memberModel{}).Where("group_ulid = ?", groupID)
		if err := query.Count(&total).Error; err == nil {
			var rows []memberModel
			if err := query.Order("joined_at ASC").Limit(limit).Offset(offset).Find(&rows).Error; err == nil {
				out := make([]member, 0, len(rows))
				for _, row := range rows {
					out = append(out, *memberFromModel(row))
				}
				return out, int(total)
			}
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	bucket := s.members[groupID]
	out := make([]member, 0, len(bucket))
	for _, item := range bucket {
		out = append(out, *item)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].JoinedAt.Before(out[j].JoinedAt)
	})
	total := len(out)
	if offset >= total {
		return []member{}, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return out[offset:end], total
}

func (s *service) createInvitation(groupID, inviterDID, inviteeDID string) invitation {
	if s.db != nil {
		now := time.Now()
		expireAt := now.Add(defaultInvitationTTL)
		item := invitation{
			ID:         fmt.Sprintf("gci-%d", now.UnixNano()),
			GroupID:    groupID,
			InviterDID: inviterDID,
			InviteeDID: inviteeDID,
			Status:     groupInvitationStatusPending,
			ExpireAt:   expireAt,
			CreatedAt:  now,
		}
		_ = s.db.Create(&invitationModel{
			ULID:       item.ID,
			GroupULID:  item.GroupID,
			InviterDID: item.InviterDID,
			InviteeDID: item.InviteeDID,
			Status:     item.Status,
			ExpireAt:   item.ExpireAt,
			CreatedAt:  item.CreatedAt,
			UpdatedAt:  item.CreatedAt,
		}).Error
		return item
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.invitations == nil {
		s.invitations = make(map[string]*invitation)
	}
	now := time.Now()
	expireAt := now.Add(defaultInvitationTTL)
	item := invitation{
		ID:         fmt.Sprintf("gci-%d", now.UnixNano()),
		GroupID:    groupID,
		InviterDID: inviterDID,
		InviteeDID: inviteeDID,
		Status:     groupInvitationStatusPending,
		ExpireAt:   expireAt,
		CreatedAt:  now,
	}
	s.invitations[item.ID] = &item
	return item
}

func (s *service) acceptInvitation(invitationID, actorDID string) (string, bool) {
	if s.db != nil {
		now := time.Now()
		var row invitationModel
		if err := s.db.Where("ulid = ? AND invitee_did = ? AND status = ?", invitationID, actorDID, groupInvitationStatusPending).First(&row).Error; err != nil {
			return "", false
		}
		if !row.ExpireAt.IsZero() && !row.ExpireAt.After(now) {
			_ = s.db.Model(&invitationModel{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
				"status":     groupInvitationStatusExpired,
				"updated_at": now,
			}).Error
			return "", false
		}
		_ = s.db.Model(&invitationModel{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
			"status":     groupInvitationStatusAccepted,
			"updated_at": now,
		}).Error
		return row.GroupULID, true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.invitations[invitationID]
	if item == nil || item.InviteeDID != actorDID || item.Status != groupInvitationStatusPending {
		return "", false
	}
	now := time.Now()
	if !item.ExpireAt.IsZero() && !item.ExpireAt.After(now) {
		item.Status = groupInvitationStatusExpired
		return "", false
	}
	item.Status = groupInvitationStatusAccepted
	return item.GroupID, true
}

// realtimeKindRecall / Edit / Delete mirror MessageMutation_Kind
// in the proto. We avoid importing the proto here so the storage
// layer stays free of wire-package dependencies; the handler does
// the int → enum translation at the publish site. Numbers must
// stay in sync with the proto enum.
const (
	realtimeKindRecall = 1
	realtimeKindEdit   = 2
	realtimeKindDelete = 3
)

// errMsgs are repo-level error sentinels surfaced to the
// application layer through `mapMutationError` (see
// application/service.go). String form is part of the contract.
var (
	errGroupMessageNotFound = errors.New("group message not found")
	errNotMessageOwner      = errors.New("not message owner")
	errMutationWindowClosed = errors.New("mutation window closed")
	errMessageAlreadyRecall = errors.New("message already recalled")
)

// loadMessageForMutation centralises the row-fetch + ownership +
// window check used by recall / edit / delete. Returns the
// in-memory `message` snapshot (DB-backed when `s.db != nil`,
// otherwise the in-memory shadow) so callers can stamp the
// outcome with the original metadata before mutating.
func (s *service) loadMessageForMutation(actorDID, groupID, messageULID string, window time.Duration, allowRecalled bool) (message, error) {
	var msg message
	if s.db != nil {
		var row messageModel
		if err := s.db.Where("group_ulid = ? AND ulid = ?", groupID, messageULID).First(&row).Error; err != nil {
			return message{}, errGroupMessageNotFound
		}
		var enc []byte
		if len(row.EncryptedPayload) > 0 {
			enc = append([]byte(nil), row.EncryptedPayload...)
		}
		msg = message{
			ID:               row.ULID,
			GroupID:          row.GroupULID,
			SenderDID:        row.SenderDID,
			Type:             row.Type,
			Content:          row.Content,
			EncryptedPayload: enc,
			ReplyToID:        row.ReplyToID,
			ThreadRootID:     row.ThreadRootID,
			Recalled:         row.Recalled,
			EditedAt:         derefTime(row.EditedAt),
			SentAt:           row.SentAt,
		}
	} else {
		s.mu.RLock()
		m, ok := s.messagesByID[messageULID]
		s.mu.RUnlock()
		if !ok || m.GroupID != groupID {
			return message{}, errGroupMessageNotFound
		}
		msg = m
	}
	if msg.SenderDID != actorDID {
		return message{}, errNotMessageOwner
	}
	if !allowRecalled && msg.Recalled {
		return message{}, errMessageAlreadyRecall
	}
	if window > 0 && !msg.SentAt.IsZero() && time.Since(msg.SentAt) > window {
		return message{}, errMutationWindowClosed
	}
	return msg, nil
}

// groupRecipients returns every member DID for the group except
// the originator. Used for realtime fan-out — the originator's
// other devices receive a self-echo through a separate publish at
// the handler layer (see publishMutationToParticipants).
func (s *service) groupRecipients(groupID, exceptDID string) []string {
	if s.db != nil {
		var rows []memberModel
		if err := s.db.Select("actor_did").Where("group_ulid = ?", groupID).Find(&rows).Error; err != nil {
			return nil
		}
		out := make([]string, 0, len(rows))
		for _, r := range rows {
			if r.ActorDID == exceptDID {
				continue
			}
			out = append(out, r.ActorDID)
		}
		return out
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.members[groupID] == nil {
		return nil
	}
	out := make([]string, 0, len(s.members[groupID]))
	for did := range s.members[groupID] {
		if did == exceptDID {
			continue
		}
		out = append(out, did)
	}
	return out
}

func (s *service) recallMessage(actorDID, groupID, messageULID string, window time.Duration) (domain.MutationOutcome, error) {
	if _, err := s.loadMessageForMutation(actorDID, groupID, messageULID, window, false); err != nil {
		return domain.MutationOutcome{}, err
	}
	now := time.Now()
	if s.db != nil {
		if err := s.db.Model(&messageModel{}).
			Where("group_ulid = ? AND ulid = ? AND sender_did = ?", groupID, messageULID, actorDID).
			Updates(map[string]interface{}{
				"deleted":           true, // on-disk column is still `deleted`
				"content":           "",
				"encrypted_payload": nil,
				"updated_at":        now,
			}).Error; err != nil {
			return domain.MutationOutcome{}, err
		}
	} else {
		s.mu.Lock()
		if shadow, ok := s.messagesByID[messageULID]; ok {
			shadow.Recalled = true
			shadow.Content = ""
			shadow.EncryptedPayload = nil
			s.messagesByID[messageULID] = shadow
		}
		items := s.messages[groupID]
		for i := range items {
			if items[i].ID == messageULID {
				items[i].Recalled = true
				items[i].Content = ""
				items[i].EncryptedPayload = nil
			}
		}
		s.messages[groupID] = items
		s.mu.Unlock()
	}
	return domain.MutationOutcome{
		Ulid:          messageULID,
		GroupID:       groupID,
		SenderDID:     actorDID,
		RecipientDIDs: s.groupRecipients(groupID, actorDID),
		Kind:          realtimeKindRecall,
		MutatedAt:     now,
	}, nil
}

func (s *service) editMessage(actorDID, groupID, messageULID, newContent string, newCiphertext []byte, window time.Duration) (domain.MutationOutcome, error) {
	if _, err := s.loadMessageForMutation(actorDID, groupID, messageULID, window, false); err != nil {
		return domain.MutationOutcome{}, err
	}
	now := time.Now()
	updates := map[string]interface{}{
		"content":    newContent,
		"updated_at": now,
		"edited_at":  now,
	}
	// Only stamp encrypted_payload when the caller actually
	// provided one — leaving the column untouched preserves the
	// row's original ciphertext for chats that haven't migrated.
	if len(newCiphertext) > 0 {
		updates["encrypted_payload"] = append([]byte(nil), newCiphertext...)
	}
	if s.db != nil {
		if err := s.db.Model(&messageModel{}).
			Where("group_ulid = ? AND ulid = ? AND sender_did = ?", groupID, messageULID, actorDID).
			Updates(updates).Error; err != nil {
			return domain.MutationOutcome{}, err
		}
	} else {
		s.mu.Lock()
		if shadow, ok := s.messagesByID[messageULID]; ok {
			shadow.Content = newContent
			if len(newCiphertext) > 0 {
				shadow.EncryptedPayload = append([]byte(nil), newCiphertext...)
			}
			shadow.EditedAt = now
			s.messagesByID[messageULID] = shadow
		}
		items := s.messages[groupID]
		for i := range items {
			if items[i].ID == messageULID {
				items[i].Content = newContent
				if len(newCiphertext) > 0 {
					items[i].EncryptedPayload = append([]byte(nil), newCiphertext...)
				}
				items[i].EditedAt = now
			}
		}
		s.messages[groupID] = items
		s.mu.Unlock()
	}
	return domain.MutationOutcome{
		Ulid:          messageULID,
		GroupID:       groupID,
		SenderDID:     actorDID,
		RecipientDIDs: s.groupRecipients(groupID, actorDID),
		Kind:          realtimeKindEdit,
		NewContent:    newContent,
		NewCiphertext: append([]byte(nil), newCiphertext...),
		MutatedAt:     now,
	}, nil
}

func (s *service) deleteMessage(actorDID, groupID, messageULID string) (domain.MutationOutcome, error) {
	// Delete bypasses the recall window — see the public
	// DeleteMessage doc-comment for the rationale. We do still
	// require sender-ownership; admin / owner override is
	// applied in the application layer.
	msg, err := s.loadMessageForMutation(actorDID, groupID, messageULID, 0, true)
	if err != nil {
		return domain.MutationOutcome{}, err
	}
	now := time.Now()
	if s.db != nil {
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("message_ulid = ?", messageULID).Delete(&MessageAttachmentModel{}).Error; err != nil {
				return err
			}
			return tx.Where("group_ulid = ? AND ulid = ? AND sender_did = ?", groupID, messageULID, actorDID).
				Delete(&messageModel{}).Error
		}); err != nil {
			return domain.MutationOutcome{}, err
		}
	} else {
		s.mu.Lock()
		items := s.messages[msg.GroupID]
		out := make([]message, 0, len(items))
		for _, item := range items {
			if item.ID == messageULID {
				continue
			}
			out = append(out, item)
		}
		s.messages[msg.GroupID] = out
		delete(s.messagesByID, messageULID)
		s.mu.Unlock()
	}
	return domain.MutationOutcome{
		Ulid:          messageULID,
		GroupID:       groupID,
		SenderDID:     actorDID,
		RecipientDIDs: s.groupRecipients(groupID, actorDID),
		Kind:          realtimeKindDelete,
		MutatedAt:     now,
	}, nil
}

func (s *service) searchMessages(groupID, query string, limit int) []message {
	if s.db != nil {
		var rows []messageModel
		if err := s.db.Where("group_ulid = ? AND content ILIKE ?", groupID, "%"+query+"%").
			Order("sent_at DESC").Limit(limit).Find(&rows).Error; err == nil {
			out := make([]message, 0, len(rows))
			for _, row := range rows {
				var enc []byte
				if len(row.EncryptedPayload) > 0 {
					enc = append([]byte(nil), row.EncryptedPayload...)
				}
				out = append(out, message{
					ID:               row.ULID,
					GroupID:          row.GroupULID,
					SenderDID:        row.SenderDID,
					Type:             row.Type,
					Content:          row.Content,
					EncryptedPayload: enc,
					ReplyToID:        row.ReplyToID,
					ThreadRootID:     row.ThreadRootID,
					Recalled:         row.Recalled,
					EditedAt:         derefTime(row.EditedAt),
					SentAt:           row.SentAt,
				})
			}
			return out
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.messages[groupID]
	out := make([]message, 0, len(items))
	for i := len(items) - 1; i >= 0; i-- {
		if strings.Contains(strings.ToLower(items[i].Content), strings.ToLower(query)) {
			out = append(out, items[i])
		}
		if len(out) >= limit {
			break
		}
	}
	return out
}

func (s *service) getSettings(groupID, actorDID string) groupSetting {
	if s.db != nil {
		var row settingModel
		if err := s.db.Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).First(&row).Error; err == nil {
			return groupSetting{
				IsMuted:            row.IsMuted,
				IsPinned:           row.IsPinned,
				ShowMemberNickname: row.ShowMemberNickname,
				AlertEnabled:       boolValueOrDefault(row.AlertEnabled, true),
				Background:         normalizedSettingBackground(row.Background),
				ClearedAtUnixMs:    row.ClearedAtUnixMs,
			}
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.settings[groupID] == nil {
		return groupSetting{AlertEnabled: true, Background: "default"}
	}
	item := s.settings[groupID][actorDID]
	if item.Background == "" {
		item.Background = "default"
	}
	if !item.AlertEnabled && item == (groupSetting{Background: "default"}) {
		item.AlertEnabled = true
	}
	return item
}

type groupSettingsPatch struct {
	muted           *bool
	pinned          *bool
	showNickname    *bool
	alertEnabled    *bool
	background      *string
	clearedAtUnixMs *int64
}

func defaultGroupSetting() groupSetting {
	return groupSetting{AlertEnabled: true, Background: "default"}
}

func applyGroupSettingsPatch(item groupSetting, patch groupSettingsPatch) groupSetting {
	if item.Background == "" {
		item.Background = "default"
	}
	if patch.muted != nil {
		item.IsMuted = *patch.muted
	}
	if patch.pinned != nil {
		item.IsPinned = *patch.pinned
	}
	if patch.showNickname != nil {
		item.ShowMemberNickname = *patch.showNickname
	}
	if patch.alertEnabled != nil {
		item.AlertEnabled = *patch.alertEnabled
	}
	if patch.background != nil {
		item.Background = normalizedSettingBackground(*patch.background)
	}
	if patch.clearedAtUnixMs != nil {
		item.ClearedAtUnixMs = *patch.clearedAtUnixMs
	}
	return item
}

func groupSettingsUpdateMap(patch groupSettingsPatch, now time.Time) map[string]interface{} {
	updates := map[string]interface{}{"updated_at": now}
	if patch.muted != nil {
		updates["is_muted"] = *patch.muted
	}
	if patch.pinned != nil {
		updates["is_pinned"] = *patch.pinned
	}
	if patch.showNickname != nil {
		updates["show_member_nickname"] = *patch.showNickname
	}
	if patch.alertEnabled != nil {
		updates["alert_enabled"] = *patch.alertEnabled
	}
	if patch.background != nil {
		updates["background"] = normalizedSettingBackground(*patch.background)
	}
	if patch.clearedAtUnixMs != nil {
		updates["cleared_at_unix_ms"] = *patch.clearedAtUnixMs
	}
	return updates
}

func (s *service) updateSettings(groupID, actorDID string, patch groupSettingsPatch) {
	if s.db != nil {
		var row settingModel
		err := s.db.Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).First(&row).Error
		now := time.Now()
		if err != nil {
			if err != gorm.ErrRecordNotFound {
				return
			}
			item := applyGroupSettingsPatch(defaultGroupSetting(), patch)
			_ = s.db.Create(&settingModel{
				GroupULID:          groupID,
				ActorDID:           actorDID,
				IsMuted:            item.IsMuted,
				IsPinned:           item.IsPinned,
				ShowMemberNickname: item.ShowMemberNickname,
				AlertEnabled:       boolPtr(item.AlertEnabled),
				Background:         item.Background,
				ClearedAtUnixMs:    item.ClearedAtUnixMs,
				CreatedAt:          now,
				UpdatedAt:          now,
			}).Error
			return
		}
		updates := groupSettingsUpdateMap(patch, now)
		if len(updates) == 1 {
			return
		}
		_ = s.db.Model(&settingModel{}).Where("id = ?", row.ID).Updates(updates).Error
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settings == nil {
		s.settings = make(map[string]map[string]groupSetting)
	}
	if s.settings[groupID] == nil {
		s.settings[groupID] = make(map[string]groupSetting)
	}
	item, ok := s.settings[groupID][actorDID]
	if !ok {
		item = defaultGroupSetting()
	}
	s.settings[groupID][actorDID] = applyGroupSettingsPatch(item, patch)
}

func normalizedSettingBackground(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "default"
	}
	switch trimmed {
	case "default", "paper", "mint", "dusk", "calm", "graphite":
		return trimmed
	default:
		return "default"
	}
}

func boolPtr(value bool) *bool {
	return &value
}

func boolValueOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func (s *service) updateNickname(groupID, actorDID, nickname string) (*member, bool) {
	if s.db != nil {
		now := time.Now()
		res := s.db.Model(&memberModel{}).Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).Updates(map[string]interface{}{
			"nickname":   nickname,
			"updated_at": now,
		})
		if res.Error != nil || res.RowsAffected == 0 {
			return nil, false
		}
		return s.getMember(groupID, actorDID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.members[groupID] == nil || s.members[groupID][actorDID] == nil {
		return nil, false
	}
	s.members[groupID][actorDID].Nickname = nickname
	copy := *s.members[groupID][actorDID]
	return &copy, true
}

func (s *service) getOfflineMessages(actorDID string, limit int) []offlineMessage {
	if s.db != nil {
		var rows []offlineModel
		if err := s.db.Where("receiver_id = ?", actorDID).Order("created_at DESC").Limit(limit).Find(&rows).Error; err == nil {
			out := make([]offlineMessage, 0, len(rows))
			for _, row := range rows {
				out = append(out, offlineMessage{
					ID:         row.ULID,
					GroupID:    row.GroupULID,
					MessageID:  row.MessageULID,
					ReceiverID: row.ReceiverID,
					CreatedAt:  row.CreatedAt,
				})
			}
			return out
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.offline[actorDID]
	if len(items) <= limit {
		out := make([]offlineMessage, len(items))
		copy(out, items)
		return out
	}
	out := make([]offlineMessage, len(items[:limit]))
	copy(out, items[:limit])
	return out
}

func (s *service) ackOffline(ulids []string) {
	if s.db != nil {
		_ = s.db.Where("ulid IN ?", ulids).Delete(&offlineModel{}).Error
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	target := make(map[string]struct{}, len(ulids))
	for _, id := range ulids {
		target[id] = struct{}{}
	}
	for did, items := range s.offline {
		out := make([]offlineMessage, 0, len(items))
		for _, item := range items {
			if _, ok := target[item.ID]; ok {
				continue
			}
			out = append(out, item)
		}
		s.offline[did] = out
	}
}

func (s *service) stats() (int32, int32, int64, int32) {
	if s.db != nil {
		var totalGroups int64
		var totalMembers int64
		var totalMessages int64
		var activeGroups int64
		threshold := time.Now().Add(-24 * time.Hour)
		if err := s.db.Model(&groupModel{}).Count(&totalGroups).Error; err == nil {
			_ = s.db.Model(&memberModel{}).Count(&totalMembers).Error
			_ = s.db.Model(&messageModel{}).Count(&totalMessages).Error
			_ = s.db.Model(&groupModel{}).Where("updated_at > ?", threshold).Count(&activeGroups).Error
			return int32(totalGroups), int32(totalMembers), totalMessages, int32(activeGroups)
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	totalGroups := int32(len(s.groups))
	totalMembers := int32(0)
	totalMessages := int64(0)
	activeGroups := int32(0)
	threshold := time.Now().Add(-24 * time.Hour)
	for gid, g := range s.groups {
		totalMembers += g.MemberCount
		totalMessages += int64(len(s.messages[gid]))
		if g.UpdatedAt.After(threshold) {
			activeGroups++
		}
	}
	return totalGroups, totalMembers, totalMessages, activeGroups
}

// derefTime returns the zero-value time.Time when the input is nil.
// We model nullable timestamp columns (notably edited_at) as
// `*time.Time` in the GORM model so a fresh insert leaves the column
// NULL rather than stamping epoch-zero, but in-memory + domain
// types use plain `time.Time` with the convention that the zero
// value means "unset". This helper bridges the two.
func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

func timePtrOrNil(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	v := t
	return &v
}
