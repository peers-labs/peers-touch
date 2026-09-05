package conversation

import (
	"context"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// --- GORM Models ---

type conversationModel struct {
	ID                     uint      `gorm:"column:id;primaryKey"`
	ConversationID         string    `gorm:"column:conversation_id;size:128;uniqueIndex"`
	Kind                   int32     `gorm:"column:kind"`
	AuthorityStationPeerID string    `gorm:"column:authority_station_peer_id;size:255"`
	FederationID           string    `gorm:"column:federation_id;size:128;index"`
	AuthorityEpoch         int64     `gorm:"column:authority_epoch"`
	MembershipEpoch        int64     `gorm:"column:membership_epoch"`
	MlsEpoch               int64     `gorm:"column:mls_epoch"`
	Status                 int32     `gorm:"column:status"`
	CurrentSeq             int64     `gorm:"column:current_seq"`
	Name                   string    `gorm:"column:name;size:255"`
	Description            string    `gorm:"column:description;type:text"`
	AvatarCID              string    `gorm:"column:avatar_cid;size:255"`
	OwnerPtid              string    `gorm:"column:owner_ptid;size:255"`
	MaxMembers             int32     `gorm:"column:max_members"`
	Visibility             int32     `gorm:"column:visibility"`
	DisappearTimerSeconds  uint32    `gorm:"column:disappear_timer_seconds"`
	CreatedAt              time.Time `gorm:"column:created_at"`
	UpdatedAt              time.Time `gorm:"column:updated_at"`
}

func (*conversationModel) TableName() string { return "conversations" }

type conversationMemberModel struct {
	ID                     uint       `gorm:"column:id;primaryKey"`
	ConversationID         string     `gorm:"column:conversation_id;size:128;index:idx_member_conv;uniqueIndex:idx_member_conv_actor"`
	Ptid                   string     `gorm:"column:ptid;size:255;index:idx_member_actor;uniqueIndex:idx_member_conv_actor"`
	Role                   int32      `gorm:"column:role"`
	MemberStatus           int32      `gorm:"column:member_status"`
	ActorHomeStationPeerID string     `gorm:"column:actor_home_station_peer_id;size:255"`
	ActorHomeStationDomain string     `gorm:"column:actor_home_station_domain;size:255"`
	Nickname               string     `gorm:"column:nickname;size:255"`
	Muted                  bool       `gorm:"column:muted"`
	MutedUntil             *time.Time `gorm:"column:muted_until"`
	JoinedAt               time.Time  `gorm:"column:joined_at"`
	InvitedByPtid          string     `gorm:"column:invited_by_ptid;size:255"`
}

func (*conversationMemberModel) TableName() string { return "conversation_members" }

func repairMemberIndex(db *gorm.DB) {
	var columns []struct {
		ColumnName string `gorm:"column:column_name"`
	}
	db.Raw(`
		SELECT a.attname AS column_name
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indexrelid
		JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		WHERE c.relname = 'idx_member_conv_actor'
		ORDER BY array_position(i.indkey, a.attnum)
	`).Scan(&columns)

	if len(columns) == 0 {
		return
	}
	needsRepair := len(columns) != 2 ||
		columns[0].ColumnName != "conversation_id" ||
		columns[1].ColumnName != "ptid"
	if !needsRepair {
		return
	}

	db.Exec("DROP INDEX IF EXISTS idx_member_conv_actor")
	db.Exec("CREATE UNIQUE INDEX idx_member_conv_actor ON conversation_members (conversation_id, ptid)")
	db.Exec("DROP INDEX IF EXISTS idx_member_actor")
	db.Exec("CREATE INDEX idx_member_actor ON conversation_members (ptid)")
}

type conversationMemberDeviceModel struct {
	ID                uint      `gorm:"column:id;primaryKey"`
	ConversationID    string    `gorm:"column:conversation_id;size:128;index:idx_member_device_conv;uniqueIndex:uidx_member_device"`
	Ptid              string    `gorm:"column:ptid;size:255;index:idx_member_device_ptid;uniqueIndex:uidx_member_device"`
	DeviceID          string    `gorm:"column:device_id;size:255;uniqueIndex:uidx_member_device"`
	HomeStationPeerID string    `gorm:"column:home_station_peer_id;size:255"`
	Active            bool      `gorm:"column:active"`
	UpdatedAt         time.Time `gorm:"column:updated_at"`
}

func (*conversationMemberDeviceModel) TableName() string {
	return "conversation_member_devices"
}

type conversationEventModel struct {
	ID              uint      `gorm:"column:id;primaryKey"`
	EventID         string    `gorm:"column:event_id;size:64;uniqueIndex"`
	ConversationID  string    `gorm:"column:conversation_id;size:128;index:idx_event_conv_seq,priority:1;uniqueIndex:uidx_event_conv_seq,priority:1;uniqueIndex:uidx_event_conv_transition,priority:1"`
	GroupSeq        int64     `gorm:"column:group_seq;index:idx_event_conv_seq,priority:2;uniqueIndex:uidx_event_conv_seq,priority:2"`
	TransitionID    *string   `gorm:"column:transition_id;size:64;uniqueIndex:uidx_event_conv_transition,priority:2"`
	MembershipEpoch int64     `gorm:"column:membership_epoch"`
	MlsEpoch        int64     `gorm:"column:mls_epoch"`
	EventHash       []byte    `gorm:"column:event_hash;type:bytea"`
	CommitSHA256    []byte    `gorm:"column:commit_sha256;type:bytea"`
	EventBytes      []byte    `gorm:"column:event_bytes;type:bytea"`
	CommittedAt     time.Time `gorm:"column:committed_at"`
}

func (*conversationEventModel) TableName() string { return "conversation_events" }

type conversationCommandReceiptModel struct {
	ID             uint      `gorm:"column:id;primaryKey"`
	ConversationID string    `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_command_receipt"`
	CommandID      string    `gorm:"column:command_id;size:128;uniqueIndex:uidx_command_receipt"`
	CommandSHA256  []byte    `gorm:"column:command_sha256;type:bytea"`
	EventBytes     []byte    `gorm:"column:event_bytes;type:bytea"`
	CreatedAt      time.Time `gorm:"column:created_at"`
}

func (*conversationCommandReceiptModel) TableName() string {
	return "conversation_command_receipts"
}

// --- PostgresConversationRepo ---

type postgresConversationRepo struct {
	db *gorm.DB
}

func newPostgresConversationRepo(db *gorm.DB) *postgresConversationRepo {
	return &postgresConversationRepo{db: db}
}

// NewPostgresRepository returns a Repository backed by the provided GORM DB.
func NewPostgresRepository(db *gorm.DB) Repository {
	return newPostgresConversationRepo(db)
}

func (r *postgresConversationRepo) UpsertConversation(ctx context.Context, conv *chat.Conversation) error {
	model := &conversationModel{
		ConversationID:         conv.ConversationId,
		Kind:                   int32(conv.Kind),
		AuthorityStationPeerID: conv.AuthorityStationPeerId,
		FederationID:           conv.FederationId,
		AuthorityEpoch:         conv.AuthorityEpoch,
		MembershipEpoch:        conv.MembershipEpoch,
		MlsEpoch:               conv.MlsEpoch,
		Status:                 int32(conv.Status),
		Name:                   conv.Name,
		Description:            conv.Description,
		AvatarCID:              conv.AvatarCid,
		OwnerPtid:              conv.OwnerPtid,
		MaxMembers:             conv.MaxMembers,
		Visibility:             int32(conv.Visibility),
		DisappearTimerSeconds:  conv.DisappearTimerSeconds,
		CreatedAt:              conv.CreatedAt.AsTime(),
		UpdatedAt:              conv.UpdatedAt.AsTime(),
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "conversation_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"authority_station_peer_id", "federation_id", "authority_epoch", "status", "membership_epoch", "mls_epoch", "name", "description", "avatar_cid", "visibility", "disappear_timer_seconds", "updated_at"}),
		}).
		Create(model).Error
}

func (r *postgresConversationRepo) GetConversation(ctx context.Context, conversationID string) (*chat.Conversation, error) {
	var model conversationModel
	if err := r.db.WithContext(ctx).Where("conversation_id = ?", conversationID).First(&model).Error; err != nil {
		return nil, err
	}
	return model.toProto(), nil
}

func (r *postgresConversationRepo) GetConversationForUpdate(ctx context.Context, conversationID string) (*chat.Conversation, error) {
	var model conversationModel
	if err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("conversation_id = ?", conversationID).
		First(&model).Error; err != nil {
		return nil, err
	}
	return model.toProto(), nil
}

func (r *postgresConversationRepo) ListByActor(ctx context.Context, ptid string) ([]*chat.Conversation, error) {
	var members []conversationMemberModel
	if err := r.db.WithContext(ctx).
		Where("ptid = ? AND member_status = ?", ptid, int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE)).
		Find(&members).Error; err != nil {
		return nil, err
	}

	if len(members) == 0 {
		return nil, nil
	}

	convIDs := make([]string, 0, len(members))
	for _, m := range members {
		convIDs = append(convIDs, m.ConversationID)
	}

	var models []conversationModel
	if err := r.db.WithContext(ctx).Where("conversation_id IN ?", convIDs).Find(&models).Error; err != nil {
		return nil, err
	}

	result := make([]*chat.Conversation, 0, len(models))
	for _, m := range models {
		result = append(result, m.toProto())
	}
	return result, nil
}

func (r *postgresConversationRepo) UpsertMember(ctx context.Context, member *chat.ConversationMember) error {
	model := &conversationMemberModel{
		ConversationID:         member.ConversationId,
		Ptid:                   member.Ptid,
		Role:                   int32(member.Role),
		MemberStatus:           int32(member.MemberStatus),
		ActorHomeStationPeerID: member.ActorHomeStationPeerId,
		ActorHomeStationDomain: member.ActorHomeStationDomain,
		Nickname:               member.Nickname,
		Muted:                  member.Muted,
		JoinedAt:               member.JoinedAt.AsTime(),
		InvitedByPtid:          member.InvitedByPtid,
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "conversation_id"}, {Name: "ptid"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"role",
				"member_status",
				"actor_home_station_peer_id",
				"nickname",
				"muted",
				"joined_at",
				"invited_by_ptid",
			}),
		}).
		Create(model).Error
}

func (r *postgresConversationRepo) UpsertMemberDevice(
	ctx context.Context,
	conversationID string,
	ptid string,
	deviceID string,
	homeStationPeerID string,
	active bool,
) error {
	model := &conversationMemberDeviceModel{
		ConversationID:    conversationID,
		Ptid:              ptid,
		DeviceID:          deviceID,
		HomeStationPeerID: homeStationPeerID,
		Active:            active,
		UpdatedAt:         time.Now(),
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "conversation_id"},
				{Name: "ptid"},
				{Name: "device_id"},
			},
			DoUpdates: clause.AssignmentColumns([]string{
				"home_station_peer_id",
				"active",
				"updated_at",
			}),
		}).
		Create(model).Error
}

func (r *postgresConversationRepo) ListMemberDevices(
	ctx context.Context,
	conversationID string,
	activeOnly bool,
) ([]MemberDevice, error) {
	var models []conversationMemberDeviceModel
	query := r.db.WithContext(ctx).Where("conversation_id = ?", conversationID)
	if activeOnly {
		query = query.Where("active = ?", true)
	}
	if err := query.Find(&models).Error; err != nil {
		return nil, err
	}
	devices := make([]MemberDevice, 0, len(models))
	for _, model := range models {
		devices = append(devices, MemberDevice{
			Ptid:              model.Ptid,
			DeviceID:          model.DeviceID,
			HomeStationPeerID: model.HomeStationPeerID,
			Active:            model.Active,
		})
	}
	return devices, nil
}

func (r *postgresConversationRepo) GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error) {
	var models []conversationMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Find(&models).Error; err != nil {
		return nil, err
	}
	result := make([]*chat.ConversationMember, 0, len(models))
	for _, m := range models {
		result = append(result, m.toProto())
	}
	return result, nil
}

func (r *postgresConversationRepo) GetMember(ctx context.Context, conversationID, ptid string) (*chat.ConversationMember, error) {
	var model conversationMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND ptid = ?", conversationID, ptid).
		First(&model).Error; err != nil {
		return nil, err
	}
	return model.toProto(), nil
}

func (r *postgresConversationRepo) AppendEvent(ctx context.Context, event *chat.CommittedConversationEvent) error {
	eventBytes, err := proto.Marshal(event)
	if err != nil {
		return err
	}
	model := &conversationEventModel{
		EventID:         event.EventId,
		ConversationID:  event.ConversationId,
		GroupSeq:        event.GroupSeq,
		MembershipEpoch: event.MembershipEpoch,
		EventHash:       event.EventHash,
		EventBytes:      eventBytes,
		CommittedAt:     event.CommittedAt.AsTime(),
	}
	if transition := event.GetMembershipTransitionCommitted(); transition != nil {
		transitionID := transition.TransitionId
		model.TransitionID = &transitionID
		model.MlsEpoch = transition.ToMlsEpoch
		model.CommitSHA256 = transition.CommitSha256
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(model).Error; err != nil {
			return err
		}
		return tx.Model(&conversationModel{}).
			Where("conversation_id = ? AND current_seq < ?", event.ConversationId, event.GroupSeq).
			Update("current_seq", event.GroupSeq).Error
	})
}

func (r *postgresConversationRepo) GetEventByTransitionID(
	ctx context.Context,
	conversationID string,
	transitionID string,
) (*chat.CommittedConversationEvent, error) {
	var model conversationEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND transition_id = ?", conversationID, transitionID).
		First(&model).Error; err != nil {
		return nil, err
	}
	event := &chat.CommittedConversationEvent{}
	if err := proto.Unmarshal(model.EventBytes, event); err != nil {
		return nil, err
	}
	return event, nil
}

func (r *postgresConversationRepo) GetLastEvent(
	ctx context.Context,
	conversationID string,
) (*chat.CommittedConversationEvent, error) {
	var model conversationEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Order("group_seq DESC").
		First(&model).Error; err != nil {
		return nil, err
	}
	event := &chat.CommittedConversationEvent{}
	if err := proto.Unmarshal(model.EventBytes, event); err != nil {
		return nil, err
	}
	return event, nil
}

func (r *postgresConversationRepo) GetCommandReceipt(
	ctx context.Context,
	conversationID string,
	commandID string,
) (*CommandReceipt, error) {
	var model conversationCommandReceiptModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND command_id = ?", conversationID, commandID).
		First(&model).Error; err != nil {
		return nil, err
	}
	return &CommandReceipt{
		ConversationID: model.ConversationID,
		CommandID:      model.CommandID,
		CommandSHA256:  append([]byte(nil), model.CommandSHA256...),
		EventBytes:     append([]byte(nil), model.EventBytes...),
		CreatedAt:      model.CreatedAt,
	}, nil
}

func (r *postgresConversationRepo) CreateCommandReceipt(
	ctx context.Context,
	receipt *CommandReceipt,
) error {
	return r.db.WithContext(ctx).Create(&conversationCommandReceiptModel{
		ConversationID: receipt.ConversationID,
		CommandID:      receipt.CommandID,
		CommandSHA256:  receipt.CommandSHA256,
		EventBytes:     receipt.EventBytes,
		CreatedAt:      receipt.CreatedAt,
	}).Error
}

func (r *postgresConversationRepo) ListEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	var models []conversationEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND group_seq > ?", conversationID, afterSeq).
		Order("group_seq ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, err
	}
	result := make([]*chat.CommittedConversationEvent, 0, len(models))
	for _, m := range models {
		event := &chat.CommittedConversationEvent{}
		if err := proto.Unmarshal(m.EventBytes, event); err != nil {
			continue
		}
		result = append(result, event)
	}
	return result, nil
}

func (r *postgresConversationRepo) NextSeq(ctx context.Context, conversationID string) (int64, error) {
	model := &conversationModel{}
	result := r.db.WithContext(ctx).
		Model(model).
		Clauses(clause.Returning{Columns: []clause.Column{{Name: "current_seq"}}}).
		Where("conversation_id = ?", conversationID).
		UpdateColumn("current_seq", gorm.Expr("current_seq + 1"))
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, gorm.ErrRecordNotFound
	}
	return model.CurrentSeq, nil
}

func (r *postgresConversationRepo) BumpMembershipEpoch(ctx context.Context, conversationID string, newEpoch int64) error {
	return r.db.WithContext(ctx).
		Model(&conversationModel{}).
		Where("conversation_id = ?", conversationID).
		Update("membership_epoch", newEpoch).Error
}

func (r *postgresConversationRepo) SetMembershipAndMlsEpoch(
	ctx context.Context,
	conversationID string,
	membershipEpoch int64,
	mlsEpoch int64,
) error {
	return r.db.WithContext(ctx).
		Model(&conversationModel{}).
		Where("conversation_id = ?", conversationID).
		Updates(map[string]any{
			"membership_epoch": membershipEpoch,
			"mls_epoch":        mlsEpoch,
		}).Error
}

// HaveSharedConversation checks whether actorA and actorB are both active members
// of at least one common conversation using a self-join on the members table.
func (r *postgresConversationRepo) HaveSharedConversation(ctx context.Context, actorA, actorB string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(1) FROM conversation_members m1
		JOIN conversation_members m2 ON m1.conversation_id = m2.conversation_id
		WHERE m1.ptid = ? AND m2.ptid = ?
		  AND m1.member_status = 1 AND m2.member_status = 1
		LIMIT 1`, actorA, actorB).Count(&count).Error
	return count > 0, err
}

// --- Proto converters ---

func (m *conversationModel) toProto() *chat.Conversation {
	return &chat.Conversation{
		ConversationId:         m.ConversationID,
		Kind:                   chat.ConversationKind(m.Kind),
		AuthorityStationPeerId: m.AuthorityStationPeerID,
		FederationId:           m.FederationID,
		AuthorityEpoch:         m.AuthorityEpoch,
		MembershipEpoch:        m.MembershipEpoch,
		MlsEpoch:               m.MlsEpoch,
		Status:                 chat.ConversationStatus(m.Status),
		Name:                   m.Name,
		Description:            m.Description,
		AvatarCid:              m.AvatarCID,
		OwnerPtid:              m.OwnerPtid,
		MaxMembers:             m.MaxMembers,
		Visibility:             chat.GroupVisibilityV1(m.Visibility),
		DisappearTimerSeconds:  m.DisappearTimerSeconds,
		CreatedAt:              timestamppb.New(m.CreatedAt),
		UpdatedAt:              timestamppb.New(m.UpdatedAt),
	}
}

func (m *conversationMemberModel) toProto() *chat.ConversationMember {
	return &chat.ConversationMember{
		ConversationId:         m.ConversationID,
		Ptid:                   m.Ptid,
		Role:                   chat.MemberRole(m.Role),
		MemberStatus:           chat.MemberStatus(m.MemberStatus),
		ActorHomeStationPeerId: m.ActorHomeStationPeerID,
		ActorHomeStationDomain: m.ActorHomeStationDomain,
		Nickname:               m.Nickname,
		Muted:                  m.Muted,
		JoinedAt:               timestamppb.New(m.JoinedAt),
		InvitedByPtid:          m.InvitedByPtid,
	}
}

// --- New Repository Methods ---

func (r *postgresConversationRepo) ListThreadEvents(ctx context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	var models []conversationEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND group_seq > ?", conversationID, afterSeq).
		Order("group_seq ASC").
		Limit(limit * 5). // over-fetch since we filter in Go (until thread_root_message_id column exists)
		Find(&models).Error; err != nil {
		return nil, err
	}
	result := make([]*chat.CommittedConversationEvent, 0)
	for _, m := range models {
		event := &chat.CommittedConversationEvent{}
		if err := proto.Unmarshal(m.EventBytes, event); err != nil {
			continue
		}
		mc := event.GetMessageCommitted()
		if mc == nil || mc.ThreadRootMessageId != threadRootID {
			continue
		}
		result = append(result, event)
		if len(result) >= limit {
			break
		}
	}
	return result, nil
}
