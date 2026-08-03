package follower

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	fedinf "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxBufferedEnvelopes = 128

type Head struct {
	ConversationID         string    `gorm:"column:conversation_id;size:128;primaryKey"`
	FederationID           string    `gorm:"column:federation_id;size:128;index"`
	AuthorityStationPeerID string    `gorm:"column:authority_station_peer_id;size:255"`
	AuthorityEpoch         int64     `gorm:"column:authority_epoch"`
	GroupSeq               int64     `gorm:"column:group_seq"`
	EventHash              []byte    `gorm:"column:event_hash;type:bytea"`
	MembershipEpoch        int64     `gorm:"column:membership_epoch"`
	MlsEpoch               int64     `gorm:"column:mls_epoch"`
	TransitionID           string    `gorm:"column:transition_id;size:128"`
	CommitSHA256           []byte    `gorm:"column:commit_sha256;type:bytea"`
	Status                 string    `gorm:"column:status;size:32"`
	ProtectionReason       string    `gorm:"column:protection_reason;type:text"`
	UpdatedAt              time.Time `gorm:"column:updated_at"`
}

func (*Head) TableName() string { return "conversation_follower_heads" }

type Member struct {
	ID                     uint   `gorm:"column:id;primaryKey"`
	ConversationID         string `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_follower_member"`
	Ptid                   string `gorm:"column:ptid;size:255;uniqueIndex:uidx_follower_member"`
	Role                   int32  `gorm:"column:role"`
	Status                 int32  `gorm:"column:status"`
	ActorHomeStationPeerID string `gorm:"column:actor_home_station_peer_id;size:255"`
}

func (*Member) TableName() string { return "conversation_follower_members" }

type MemberDevice struct {
	ID                     uint   `gorm:"column:id;primaryKey"`
	ConversationID         string `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_follower_member_device"`
	Ptid                   string `gorm:"column:ptid;size:255;uniqueIndex:uidx_follower_member_device"`
	DeviceID               string `gorm:"column:device_id;size:255;uniqueIndex:uidx_follower_member_device"`
	ActorHomeStationPeerID string `gorm:"column:actor_home_station_peer_id;size:255"`
	Active                 bool   `gorm:"column:active"`
}

func (*MemberDevice) TableName() string { return "conversation_follower_member_devices" }

type bufferedEnvelope struct {
	ID             uint      `gorm:"column:id;primaryKey"`
	IdempotencyKey string    `gorm:"column:idempotency_key;size:255;uniqueIndex"`
	ConversationID string    `gorm:"column:conversation_id;size:128;index:idx_follower_buffer"`
	GroupSeq       int64     `gorm:"column:group_seq;index:idx_follower_buffer"`
	PayloadType    int32     `gorm:"column:payload_type"`
	EnvelopeBytes  []byte    `gorm:"column:envelope_bytes;type:bytea"`
	CreatedAt      time.Time `gorm:"column:created_at"`
}

func (*bufferedEnvelope) TableName() string { return "conversation_follower_buffer" }

type appliedEvent struct {
	ID             uint   `gorm:"column:id;primaryKey"`
	ConversationID string `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_follower_applied_seq"`
	GroupSeq       int64  `gorm:"column:group_seq;uniqueIndex:uidx_follower_applied_seq"`
	EventHash      []byte `gorm:"column:event_hash;type:bytea"`
	TransitionID   string `gorm:"column:transition_id;size:128;index"`
}

func (*appliedEvent) TableName() string { return "conversation_follower_applied_events" }

type Service struct {
	db         *gorm.DB
	membership StationMembershipResolver
}

type StationMembershipResolver interface {
	IsActiveStation(ctx context.Context, federationID string, stationPeerID string) (bool, error)
}

type gormMembershipResolver struct {
	db *gorm.DB
}

func (r gormMembershipResolver) IsActiveStation(
	ctx context.Context,
	federationID string,
	stationPeerID string,
) (bool, error) {
	repos := fedinf.NewRepos(r.db)
	record, err := repos.Membership.GetByStation(ctx, federationID, stationPeerID)
	if err != nil {
		return false, err
	}
	return record != nil && record.Status == "active", nil
}

func NewService(db *gorm.DB, resolvers ...StationMembershipResolver) *Service {
	service := &Service{db: db, membership: gormMembershipResolver{db: db}}
	if len(resolvers) > 0 {
		service.membership = resolvers[0]
	}
	return service
}

func (s *Service) AutoMigrate() error {
	return s.db.AutoMigrate(
		&Head{},
		&Member{},
		&MemberDevice{},
		&bufferedEnvelope{},
		&appliedEvent{},
		&projection{},
	)
}

func (s *Service) ListConversationsForActor(
	ctx context.Context,
	ptid string,
) ([]*chat.Conversation, error) {
	var members []Member
	if err := s.db.WithContext(ctx).
		Where("ptid = ? AND status = ?", ptid, int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE)).
		Find(&members).Error; err != nil {
		return nil, err
	}
	conversations := make([]*chat.Conversation, 0, len(members))
	for _, member := range members {
		var stored projection
		if err := s.db.WithContext(ctx).First(
			&stored,
			"conversation_id = ?",
			member.ConversationID,
		).Error; err != nil {
			return nil, err
		}
		conversation := &chat.Conversation{}
		if err := proto.Unmarshal(stored.ConversationBytes, conversation); err != nil {
			return nil, err
		}
		var head Head
		if err := s.db.WithContext(ctx).First(
			&head,
			"conversation_id = ?",
			member.ConversationID,
		).Error; err != nil {
			return nil, err
		}
		conversation.FederationId = head.FederationID
		conversation.AuthorityStationPeerId = head.AuthorityStationPeerID
		conversation.AuthorityEpoch = head.AuthorityEpoch
		conversation.MembershipEpoch = head.MembershipEpoch
		conversation.MlsEpoch = head.MlsEpoch
		conversations = append(conversations, conversation)
	}
	return conversations, nil
}

func (s *Service) ListMembers(
	ctx context.Context,
	conversationID string,
) ([]*chat.ConversationMember, error) {
	var rows []Member
	if err := s.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	members := make([]*chat.ConversationMember, 0, len(rows))
	for _, row := range rows {
		members = append(members, &chat.ConversationMember{
			ConversationId:         row.ConversationID,
			Ptid:                   row.Ptid,
			Role:                   chat.MemberRole(row.Role),
			MemberStatus:           chat.MemberStatus(row.Status),
			ActorHomeStationPeerId: row.ActorHomeStationPeerID,
		})
	}
	return members, nil
}

func (s *Service) IsActiveMember(
	ctx context.Context,
	conversationID string,
	ptid string,
) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&Member{}).
		Where(
			"conversation_id = ? AND ptid = ? AND status = ?",
			conversationID,
			ptid,
			int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE),
		).
		Count(&count).Error
	return count == 1, err
}

func (s *Service) ListResyncRequired(ctx context.Context, limit int) ([]Head, error) {
	if limit <= 0 {
		limit = 32
	}
	var heads []Head
	err := s.db.WithContext(ctx).
		Where("status IN ?", []string{"resync_required", "degraded"}).
		Order("updated_at ASC").
		Limit(limit).
		Find(&heads).Error
	return heads, err
}

func (s *Service) MarkResyncFailure(ctx context.Context, conversationID string, cause error) error {
	reason := "authority resync unavailable"
	if cause != nil {
		reason = cause.Error()
	}
	return s.db.WithContext(ctx).Model(&Head{}).
		Where("conversation_id = ? AND status != ?", conversationID, "read_only").
		Updates(map[string]any{
			"status":            "degraded",
			"protection_reason": reason,
			"updated_at":        time.Now(),
		}).Error
}

func (s *Service) ApplyFederatedDelivery(
	ctx context.Context,
	env *chat.StationEnvelope,
	issuerStationPeerID string,
) (bool, []*chat.DeviceInboxItem, error) {
	if env == nil ||
		(env.PayloadType != chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT &&
			env.PayloadType != chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY) {
		return false, nil, nil
	}
	if env.FederationId == "" ||
		env.AuthorityStationPeerId == "" ||
		env.AuthorityStationPeerId != issuerStationPeerID ||
		env.AuthorityEpoch <= 0 {
		return true, nil, fmt.Errorf("conversation follower: invalid authority envelope")
	}
	active, err := s.membership.IsActiveStation(ctx, env.FederationId, issuerStationPeerID)
	if err != nil {
		return true, nil, err
	}
	if !active {
		return true, nil, fmt.Errorf("conversation follower: authority Station is not active")
	}

	var notifications []*chat.DeviceInboxItem
	var terminalErr error
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		head, err := loadHead(tx, env.ConversationId)
		if err != nil {
			return err
		}
		if head != nil &&
			(head.AuthorityStationPeerID != env.AuthorityStationPeerId ||
				head.FederationID != env.FederationId ||
				head.AuthorityEpoch != env.AuthorityEpoch) {
			if err := protectHead(tx, head, "authority identity or epoch conflict"); err != nil {
				return err
			}
			terminalErr = fmt.Errorf("conversation follower: authority conflict")
			return nil
		}
		if head != nil && head.Status == "read_only" {
			return fmt.Errorf("conversation follower: group is fork-protected read-only")
		}
		if env.PayloadType == chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT {
			return s.applyCommittedEvent(tx, env, head, &notifications, &terminalErr)
		}
		return s.applyMlsDelivery(tx, env, head, &notifications, &terminalErr)
	})
	if err != nil {
		return true, nil, err
	}
	if terminalErr != nil {
		return true, notifications, terminalErr
	}
	return true, notifications, nil
}

func (s *Service) applyCommittedEvent(
	tx *gorm.DB,
	env *chat.StationEnvelope,
	head *Head,
	notifications *[]*chat.DeviceInboxItem,
	terminalErr *error,
) error {
	event := &chat.CommittedConversationEvent{}
	if err := proto.Unmarshal(env.PayloadBytes, event); err != nil {
		return err
	}
	if event.ConversationId != env.ConversationId ||
		event.GroupSeq != env.GroupSeq ||
		event.CommittedByStationPeerId != env.AuthorityStationPeerId ||
		!bytes.Equal(event.EventHash, env.PayloadSha256) {
		return fmt.Errorf("conversation follower: event envelope binding mismatch")
	}
	hash, err := committedEventHash(event)
	if err != nil || !bytes.Equal(hash, event.EventHash) {
		return fmt.Errorf("conversation follower: invalid committed event hash")
	}
	if head != nil && event.GroupSeq <= head.GroupSeq {
		var applied appliedEvent
		err := tx.Where(
			"conversation_id = ? AND group_seq = ?",
			event.ConversationId,
			event.GroupSeq,
		).First(&applied).Error
		if err != nil {
			return err
		}
		if !bytes.Equal(event.EventHash, applied.EventHash) {
			if err := protectHead(tx, head, "same sequence with different event hash"); err != nil {
				return err
			}
			*terminalErr = fmt.Errorf("conversation follower: event fork detected")
			return nil
		}
		return enqueueInbox(tx, env, notifications)
	}
	expectedSeq := int64(1)
	if head != nil {
		expectedSeq = head.GroupSeq + 1
	}
	if event.GroupSeq > expectedSeq {
		return s.bufferEnvelope(tx, env, head)
	}
	if head != nil && !bytes.Equal(event.PrevEventHash, head.EventHash) {
		if err := protectHead(tx, head, "previous event hash mismatch"); err != nil {
			return err
		}
		*terminalErr = fmt.Errorf("conversation follower: previous hash mismatch")
		return nil
	}
	if err := applyProjection(tx, event); err != nil {
		return err
	}
	next := nextHead(env, event, head)
	if err := tx.Save(next).Error; err != nil {
		return err
	}
	transitionID := ""
	if transition := event.GetMembershipTransitionCommitted(); transition != nil {
		transitionID = transition.TransitionId
	}
	if err := tx.Create(&appliedEvent{
		ConversationID: event.ConversationId,
		GroupSeq:       event.GroupSeq,
		EventHash:      event.EventHash,
		TransitionID:   transitionID,
	}).Error; err != nil {
		return err
	}
	if err := enqueueInbox(tx, env, notifications); err != nil {
		return err
	}
	return s.drainReady(tx, next, notifications)
}

func (s *Service) applyMlsDelivery(
	tx *gorm.DB,
	env *chat.StationEnvelope,
	head *Head,
	notifications *[]*chat.DeviceInboxItem,
	terminalErr *error,
) error {
	payload := &chat.MlsTransitionDeliveryPayload{}
	if err := proto.Unmarshal(env.PayloadBytes, payload); err != nil {
		return err
	}
	hash := sha256.Sum256(payload.OpaqueMlsBytes)
	if payload.ConversationId != env.ConversationId ||
		payload.GroupSeq != env.GroupSeq ||
		payload.TransitionId != env.TransitionId ||
		!bytes.Equal(hash[:], payload.PayloadSha256) ||
		!bytes.Equal(payload.PayloadSha256, env.PayloadSha256) {
		return fmt.Errorf("conversation follower: MLS delivery binding mismatch")
	}
	if head == nil || env.GroupSeq > head.GroupSeq {
		return s.bufferEnvelope(tx, env, head)
	}
	if env.GroupSeq == head.GroupSeq &&
		(env.TransitionId != head.TransitionID ||
			env.ToMembershipEpoch != head.MembershipEpoch ||
			env.ToMlsEpoch != head.MlsEpoch) {
		if err := protectHead(tx, head, "MLS delivery conflicts with follower head"); err != nil {
			return err
		}
		*terminalErr = fmt.Errorf("conversation follower: MLS delivery fork detected")
		return nil
	}
	return enqueueInbox(tx, env, notifications)
}

func (s *Service) bufferEnvelope(tx *gorm.DB, env *chat.StationEnvelope, head *Head) error {
	var count int64
	if err := tx.Model(&bufferedEnvelope{}).
		Where("conversation_id = ?", env.ConversationId).
		Count(&count).Error; err != nil {
		return err
	}
	if count >= maxBufferedEnvelopes {
		if head == nil {
			head = &Head{
				ConversationID:         env.ConversationId,
				FederationID:           env.FederationId,
				AuthorityStationPeerID: env.AuthorityStationPeerId,
				AuthorityEpoch:         env.AuthorityEpoch,
			}
		}
		return protectHead(tx, head, "follower reorder buffer overflow")
	}
	envelopeBytes, err := proto.Marshal(env)
	if err != nil {
		return err
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&bufferedEnvelope{
		IdempotencyKey: env.IdempotencyKey,
		ConversationID: env.ConversationId,
		GroupSeq:       env.GroupSeq,
		PayloadType:    int32(env.PayloadType),
		EnvelopeBytes:  envelopeBytes,
		CreatedAt:      time.Now(),
	}).Error; err != nil {
		return err
	}
	if head == nil {
		head = &Head{
			ConversationID:         env.ConversationId,
			FederationID:           env.FederationId,
			AuthorityStationPeerID: env.AuthorityStationPeerId,
			AuthorityEpoch:         env.AuthorityEpoch,
		}
	}
	head.Status = "resync_required"
	head.ProtectionReason = "authority sequence gap"
	head.UpdatedAt = time.Now()
	return tx.Save(head).Error
}

func (s *Service) drainReady(
	tx *gorm.DB,
	head *Head,
	notifications *[]*chat.DeviceInboxItem,
) error {
	for {
		var row bufferedEnvelope
		err := tx.Where(
			"conversation_id = ? AND group_seq = ? AND payload_type = ?",
			head.ConversationID,
			head.GroupSeq+1,
			int32(chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT),
		).Order("id ASC").First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			break
		}
		if err != nil {
			return err
		}
		env := &chat.StationEnvelope{}
		if err := proto.Unmarshal(row.EnvelopeBytes, env); err != nil {
			return err
		}
		if err := tx.Delete(&row).Error; err != nil {
			return err
		}
		var terminalErr error
		if err := s.applyCommittedEvent(tx, env, head, notifications, &terminalErr); err != nil {
			return err
		}
		if terminalErr != nil {
			return terminalErr
		}
		updated, err := loadHead(tx, head.ConversationID)
		if err != nil {
			return err
		}
		head = updated
	}

	var duplicateEvents []bufferedEnvelope
	if err := tx.Where(
		"conversation_id = ? AND group_seq <= ? AND payload_type = ?",
		head.ConversationID,
		head.GroupSeq,
		int32(chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_COMMITTED_EVENT),
	).Order("group_seq ASC, id ASC").Find(&duplicateEvents).Error; err != nil {
		return err
	}
	for _, row := range duplicateEvents {
		env := &chat.StationEnvelope{}
		if err := proto.Unmarshal(row.EnvelopeBytes, env); err != nil {
			return err
		}
		var terminalErr error
		if err := s.applyCommittedEvent(tx, env, head, notifications, &terminalErr); err != nil {
			return err
		}
		if terminalErr != nil {
			return terminalErr
		}
		if err := tx.Delete(&row).Error; err != nil {
			return err
		}
	}

	var rows []bufferedEnvelope
	if err := tx.Where(
		"conversation_id = ? AND group_seq <= ? AND payload_type = ?",
		head.ConversationID,
		head.GroupSeq,
		int32(chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_TRANSITION_DELIVERY),
	).Order("group_seq ASC, id ASC").Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		env := &chat.StationEnvelope{}
		if err := proto.Unmarshal(row.EnvelopeBytes, env); err != nil {
			return err
		}
		var terminalErr error
		if err := s.applyMlsDelivery(tx, env, head, notifications, &terminalErr); err != nil {
			return err
		}
		if terminalErr != nil {
			return terminalErr
		}
		if err := tx.Delete(&row).Error; err != nil {
			return err
		}
	}
	var remaining int64
	if err := tx.Model(&bufferedEnvelope{}).
		Where("conversation_id = ?", head.ConversationID).
		Count(&remaining).Error; err != nil {
		return err
	}
	if remaining == 0 {
		head.Status = "active"
		head.ProtectionReason = ""
	} else {
		head.Status = "resync_required"
		head.ProtectionReason = "authority sequence gap"
	}
	head.UpdatedAt = time.Now()
	return tx.Save(head).Error
}

func loadHead(tx *gorm.DB, conversationID string) (*Head, error) {
	var head Head
	err := tx.Where("conversation_id = ?", conversationID).First(&head).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &head, err
}

func protectHead(tx *gorm.DB, head *Head, reason string) error {
	head.Status = "read_only"
	head.ProtectionReason = reason
	head.UpdatedAt = time.Now()
	return tx.Save(head).Error
}

func nextHead(env *chat.StationEnvelope, event *chat.CommittedConversationEvent, previous *Head) *Head {
	head := &Head{
		ConversationID:         env.ConversationId,
		FederationID:           env.FederationId,
		AuthorityStationPeerID: env.AuthorityStationPeerId,
		AuthorityEpoch:         env.AuthorityEpoch,
		GroupSeq:               event.GroupSeq,
		EventHash:              event.EventHash,
		MembershipEpoch:        event.MembershipEpoch,
		Status:                 "active",
		UpdatedAt:              time.Now(),
	}
	if previous != nil {
		head.MlsEpoch = previous.MlsEpoch
	}
	if transition := event.GetMembershipTransitionCommitted(); transition != nil {
		head.MlsEpoch = transition.ToMlsEpoch
		head.TransitionID = transition.TransitionId
		head.CommitSHA256 = transition.CommitSha256
	}
	return head
}

func applyProjection(tx *gorm.DB, event *chat.CommittedConversationEvent) error {
	if created := event.GetConversationCreated(); created != nil && created.Conversation != nil {
		conversationBytes, err := proto.Marshal(created.Conversation)
		if err != nil {
			return err
		}
		if err := tx.Exec(
			`INSERT INTO conversation_follower_projection
			 (conversation_id, conversation_bytes, updated_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(conversation_id) DO UPDATE SET
			 conversation_bytes = excluded.conversation_bytes,
			 updated_at = excluded.updated_at`,
			event.ConversationId,
			conversationBytes,
			time.Now(),
		).Error; err != nil {
			return err
		}
	}
	transition := event.GetMembershipTransitionCommitted()
	if transition == nil {
		return nil
	}
	for _, change := range transition.Changes {
		switch change.Action {
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD:
			member := &Member{
				ConversationID:         event.ConversationId,
				Ptid:                   change.Ptid,
				Role:                   int32(change.Role),
				Status:                 int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE),
				ActorHomeStationPeerID: change.ActorHomeStationPeerId,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "conversation_id"}, {Name: "ptid"}},
				DoUpdates: clause.AssignmentColumns([]string{
					"role", "status", "actor_home_station_peer_id",
				}),
			}).Create(member).Error; err != nil {
				return err
			}
			if change.DeviceId != "" {
				if err := upsertMemberDevice(tx, event.ConversationId, change, true); err != nil {
					return err
				}
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ADD_DEVICE:
			if err := upsertMemberDevice(tx, event.ConversationId, change, true); err != nil {
				return err
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE_DEVICE:
			if err := upsertMemberDevice(tx, event.ConversationId, change, false); err != nil {
				return err
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_REMOVE,
			chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE:
			status := chat.MemberStatus_MEMBER_STATUS_REMOVED
			if change.Action == chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_LEAVE {
				status = chat.MemberStatus_MEMBER_STATUS_LEFT
			}
			if err := tx.Model(&Member{}).
				Where("conversation_id = ? AND ptid = ?", event.ConversationId, change.Ptid).
				Update("status", int32(status)).Error; err != nil {
				return err
			}
			if err := tx.Model(&MemberDevice{}).
				Where("conversation_id = ? AND ptid = ?", event.ConversationId, change.Ptid).
				Update("active", false).Error; err != nil {
				return err
			}
		case chat.MembershipTransitionAction_MEMBERSHIP_TRANSITION_ACTION_ROLE_CHANGE:
			if err := tx.Model(&Member{}).
				Where("conversation_id = ? AND ptid = ?", event.ConversationId, change.Ptid).
				Update("role", int32(change.Role)).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func upsertMemberDevice(
	tx *gorm.DB,
	conversationID string,
	change *chat.MembershipTransitionChange,
	active bool,
) error {
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "conversation_id"},
			{Name: "ptid"},
			{Name: "device_id"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"actor_home_station_peer_id", "active",
		}),
	}).Create(&MemberDevice{
		ConversationID:         conversationID,
		Ptid:                   change.Ptid,
		DeviceID:               change.DeviceId,
		ActorHomeStationPeerID: change.ActorHomeStationPeerId,
		Active:                 active,
	}).Error
}

type projection struct {
	ConversationID    string    `gorm:"column:conversation_id;primaryKey"`
	ConversationBytes []byte    `gorm:"column:conversation_bytes;type:bytea"`
	UpdatedAt         time.Time `gorm:"column:updated_at"`
}

func (*projection) TableName() string { return "conversation_follower_projection" }

func enqueueInbox(
	tx *gorm.DB,
	env *chat.StationEnvelope,
	notifications *[]*chat.DeviceInboxItem,
) error {
	if env.RecipientPtid == "" {
		return nil
	}
	item := &chat.DeviceInboxItem{
		InboxItemId:       deterministicID("follower-inbox:" + env.IdempotencyKey),
		RecipientPtid:     env.RecipientPtid,
		RecipientDeviceId: env.RecipientDeviceId,
		Envelope:          env,
	}
	if _, err := envinf.NewPostgresRepository(tx).EnqueueInbox(tx.Statement.Context, item); err != nil {
		return err
	}
	*notifications = append(*notifications, item)
	return nil
}

func committedEventHash(event *chat.CommittedConversationEvent) ([]byte, error) {
	clone := proto.Clone(event).(*chat.CommittedConversationEvent)
	clone.EventHash = nil
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(clone)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	return hash[:], nil
}

func deterministicID(value string) string {
	hash := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", hash[:16])
}
