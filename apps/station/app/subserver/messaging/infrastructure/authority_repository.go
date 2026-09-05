package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AuthorityConversationModel struct {
	ConversationID  string `gorm:"column:conversation_id;size:128;primaryKey"`
	Kind            int32  `gorm:"column:kind;not null"`
	Name            string `gorm:"column:name;size:255"`
	OwnerPTID       string `gorm:"column:owner_ptid;size:255"`
	CurrentSequence int64  `gorm:"column:current_sequence;not null"`
	MembershipEpoch int64  `gorm:"column:membership_epoch;not null"`
	MlsEpoch        int64  `gorm:"column:mls_epoch;not null"`
	Active          bool   `gorm:"column:active;not null"`
}

func (*AuthorityConversationModel) TableName() string {
	return "messaging_conversations"
}

type AuthorityMemberModel struct {
	ConversationID string `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID           string `gorm:"column:ptid;size:255;primaryKey"`
	HomeStationID  string `gorm:"column:home_station_id;size:255;not null;default:''"`
	Role           string `gorm:"column:role;size:32;not null"`
	Active         bool   `gorm:"column:active;not null;index"`
	JoinedSequence int64  `gorm:"column:joined_sequence;not null"`
	LeftSequence   int64  `gorm:"column:left_sequence;not null"`
}

func (*AuthorityMemberModel) TableName() string {
	return "messaging_conversation_members"
}

type AuthorityMemberDeviceModel struct {
	ConversationID string `gorm:"column:conversation_id;size:128;primaryKey"`
	PTID           string `gorm:"column:ptid;size:255;primaryKey"`
	DeviceID       string `gorm:"column:device_id;size:255;primaryKey"`
	Active         bool   `gorm:"column:active;not null;index"`
	JoinedSequence int64  `gorm:"column:joined_sequence;not null"`
	LeftSequence   int64  `gorm:"column:left_sequence;not null"`
}

func (*AuthorityMemberDeviceModel) TableName() string {
	return "messaging_conversation_member_devices"
}

type AuthorityEventModel struct {
	EventID           string    `gorm:"column:event_id;size:64;primaryKey"`
	ConversationID    string    `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_messaging_event_sequence;index:idx_messaging_event_message,priority:1"`
	Sequence          int64     `gorm:"column:sequence;uniqueIndex:uidx_messaging_event_sequence"`
	CommandID         string    `gorm:"column:command_id;size:128;uniqueIndex:uidx_messaging_event_command"`
	MessageID         string    `gorm:"column:message_id;size:128;index:idx_messaging_event_message,priority:2"`
	MessageAuthorPTID string    `gorm:"column:message_author_ptid;size:255"`
	EventHash         []byte    `gorm:"column:event_hash;type:bytea;not null"`
	EventBytes        []byte    `gorm:"column:event_bytes;type:bytea;not null"`
	CommittedAt       time.Time `gorm:"column:committed_at;not null"`
}

func (*AuthorityEventModel) TableName() string {
	return "messaging_events"
}

type AuthorityCommandReceiptModel struct {
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey"`
	CommandID      string    `gorm:"column:command_id;size:128;primaryKey"`
	CommandSHA256  []byte    `gorm:"column:command_sha256;type:bytea;not null"`
	EventBytes     []byte    `gorm:"column:event_bytes;type:bytea;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;not null"`
}

func (*AuthorityCommandReceiptModel) TableName() string {
	return "messaging_command_receipts"
}

// ActorDeviceReadModel maps the identity-owned actor_devices table without
// taking migration or mutation ownership.
type ActorDeviceReadModel struct {
	PTID               string `gorm:"column:ptid"`
	DeviceID           string `gorm:"column:device_id"`
	HomeStationPeerID  string `gorm:"column:home_station_peer_id"`
	SigningKeyID       string `gorm:"column:signing_key_id"`
	PublicKey          []byte `gorm:"column:public_key"`
	VerificationSource int32  `gorm:"column:verification_source"`
	Revoked            bool   `gorm:"column:revoked"`
}

type ActorIdentityReadModel struct {
	PTID           string `gorm:"column:ptid"`
	PublicKey      []byte `gorm:"column:public_key"`
	ProfileVersion int64  `gorm:"column:profile_version"`
}

// ActorFederationReadModel maps the actor-owned federation route without
// taking migration or mutation ownership.
type ActorFederationReadModel struct {
	PTID              string `gorm:"column:ptid"`
	HomeStationPeerID string `gorm:"column:home_station_peer_id"`
	Origin            string `gorm:"column:origin"`
}

func (*ActorIdentityReadModel) TableName() string {
	return "actor_identity_keys"
}

func (*ActorDeviceReadModel) TableName() string {
	return "actor_devices"
}

func (*ActorFederationReadModel) TableName() string {
	return "touch_actor"
}

type AuthorityRepository struct {
	db *gorm.DB
}

func NewAuthorityRepository(db *gorm.DB) *AuthorityRepository {
	return &AuthorityRepository{db: db}
}

func (r *AuthorityRepository) CreateConversation(
	ctx context.Context,
	conversation *messaging.AuthorityConversation,
) (bool, error) {
	if conversation == nil {
		return false, fmt.Errorf("messaging: conversation is required")
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&AuthorityConversationModel{
			ConversationID:  conversation.ConversationID,
			Kind:            int32(conversation.Kind),
			Name:            conversation.Name,
			OwnerPTID:       conversation.OwnerPTID,
			CurrentSequence: conversation.CurrentSequence,
			MembershipEpoch: conversation.MembershipEpoch,
			MlsEpoch:        conversation.MlsEpoch,
			Active:          conversation.Active,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *AuthorityRepository) GetConversation(
	ctx context.Context,
	conversationID string,
) (*messaging.AuthorityConversation, error) {
	var model AuthorityConversationModel
	if err := r.db.WithContext(ctx).
		First(&model, "conversation_id = ?", conversationID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, messaging.ErrNotFound
		}
		return nil, err
	}
	return authorityConversationFromModel(model), nil
}

func (r *AuthorityRepository) AddMember(
	ctx context.Context,
	conversationID string,
	ptid string,
	homeStationID string,
	role string,
	joinedSequence int64,
) error {
	if conversationID == "" ||
		ptid == "" ||
		homeStationID == "" ||
		role == "" ||
		joinedSequence <= 0 {
		return fmt.Errorf("messaging: actor membership is required")
	}
	model := &AuthorityMemberModel{
		ConversationID: conversationID,
		PTID:           ptid,
		HomeStationID:  homeStationID,
		Role:           role,
		Active:         true,
		JoinedSequence: joinedSequence,
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var existing AuthorityMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND ptid = ?", conversationID, ptid).
		First(&existing).Error; err != nil {
		return err
	}
	if existing.HomeStationID != homeStationID {
		return messaging.ErrEndpointManifestConflict
	}
	update := r.db.WithContext(ctx).
		Model(&AuthorityMemberModel{}).
		Where(
			"conversation_id = ? AND ptid = ? AND home_station_id = ?",
			conversationID,
			ptid,
			homeStationID,
		).
		Updates(map[string]any{
			"role":            role,
			"active":          true,
			"left_sequence":   0,
			"joined_sequence": joinedSequence,
		})
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return messaging.ErrEndpointManifestConflict
	}
	return nil
}

func (r *AuthorityRepository) AddMemberDevice(
	ctx context.Context,
	conversationID string,
	endpoint *chat.CryptoEndpoint,
	joinedSequence int64,
) error {
	if endpoint == nil || joinedSequence <= 0 {
		return fmt.Errorf("messaging: member endpoint is required")
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "conversation_id"},
				{Name: "ptid"},
				{Name: "device_id"},
			},
			DoUpdates: clause.Assignments(map[string]any{
				"active":          true,
				"left_sequence":   0,
				"joined_sequence": joinedSequence,
			}),
		}).
		Create(&AuthorityMemberDeviceModel{
			ConversationID: conversationID,
			PTID:           endpoint.Ptid,
			DeviceID:       endpoint.DeviceId,
			Active:         true,
			JoinedSequence: joinedSequence,
		}).Error
}

func (r *AuthorityRepository) GetMember(
	ctx context.Context,
	conversationID string,
	ptid string,
) (*messaging.AuthorityMember, error) {
	var model AuthorityMemberModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND ptid = ?",
			conversationID,
			ptid,
		).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, messaging.ErrNotFound
		}
		return nil, err
	}
	return &messaging.AuthorityMember{
		PTID:          model.PTID,
		HomeStationID: model.HomeStationID,
		Role:          model.Role,
		Active:        model.Active,
	}, nil
}

func (r *AuthorityRepository) ListActiveMembers(
	ctx context.Context,
	conversationID string,
) ([]messaging.AuthorityMember, error) {
	var models []AuthorityMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND active = ?", conversationID, true).
		Order("ptid ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	members := make([]messaging.AuthorityMember, 0, len(models))
	for _, model := range models {
		members = append(members, messaging.AuthorityMember{
			PTID:          model.PTID,
			HomeStationID: model.HomeStationID,
			Role:          model.Role,
			Active:        model.Active,
		})
	}
	return members, nil
}

func (r *AuthorityRepository) RemoveMember(
	ctx context.Context,
	conversationID string,
	ptid string,
	leftSequence int64,
) error {
	if conversationID == "" || ptid == "" || leftSequence <= 0 {
		return fmt.Errorf("messaging: removed actor membership is required")
	}
	result := r.db.WithContext(ctx).
		Model(&AuthorityMemberModel{}).
		Where(
			"conversation_id = ? AND ptid = ? AND active = ?",
			conversationID,
			ptid,
			true,
		).
		Updates(map[string]any{"active": false, "left_sequence": leftSequence})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrConversationState
	}
	return r.db.WithContext(ctx).
		Model(&AuthorityMemberDeviceModel{}).
		Where(
			"conversation_id = ? AND ptid = ? AND active = ?",
			conversationID,
			ptid,
			true,
		).
		Updates(map[string]any{"active": false, "left_sequence": leftSequence}).Error
}

func (r *AuthorityRepository) RemoveMemberDevice(
	ctx context.Context,
	conversationID string,
	endpoint *chat.CryptoEndpoint,
	leftSequence int64,
) error {
	if endpoint == nil || leftSequence <= 0 {
		return fmt.Errorf("messaging: removed member endpoint is required")
	}
	result := r.db.WithContext(ctx).
		Model(&AuthorityMemberDeviceModel{}).
		Where(
			"conversation_id = ? AND ptid = ? AND device_id = ? AND active = ?",
			conversationID,
			endpoint.Ptid,
			endpoint.DeviceId,
			true,
		).
		Updates(map[string]any{"active": false, "left_sequence": leftSequence})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return messaging.ErrConversationState
	}
	return nil
}

func (r *AuthorityRepository) ListConversationsForActor(
	ctx context.Context,
	ptid string,
) ([]messaging.AuthorityConversationView, error) {
	var conversations []AuthorityConversationModel
	if err := r.db.WithContext(ctx).
		Where(
			"active = ? AND EXISTS ("+
				"SELECT 1 FROM messaging_conversation_members members "+
				"WHERE members.conversation_id = messaging_conversations.conversation_id "+
				"AND members.ptid = ? AND members.active = ?)",
			true,
			ptid,
			true,
		).
		Order("conversation_id ASC").
		Find(&conversations).Error; err != nil {
		return nil, err
	}
	views := make([]messaging.AuthorityConversationView, 0, len(conversations))
	for _, model := range conversations {
		var memberPTIDs []string
		if err := r.db.WithContext(ctx).
			Model(&AuthorityMemberModel{}).
			Where("conversation_id = ? AND active = ?", model.ConversationID, true).
			Order("ptid ASC").
			Pluck("ptid", &memberPTIDs).Error; err != nil {
			return nil, err
		}
		views = append(views, messaging.AuthorityConversationView{
			Conversation: authorityConversationFromModel(model),
			MemberPTIDs:  memberPTIDs,
		})
	}
	return views, nil
}

func (r *AuthorityRepository) AutoMigrate() error {
	if err := r.db.AutoMigrate(
		&AuthorityConversationModel{},
		&AuthorityMemberModel{},
		&AuthorityMemberDeviceModel{},
		&AuthorityEventModel{},
		&AuthorityCommandReceiptModel{},
	); err != nil {
		return err
	}
	if r.db.Migrator().HasTable("messaging_member_devices") {
		if err := r.db.Transaction(func(tx *gorm.DB) error {
			var legacyRows []AuthorityMemberDeviceModel
			if err := tx.Table("messaging_member_devices").Find(&legacyRows).Error; err != nil {
				return err
			}
			conversations := make(map[string]AuthorityConversationModel)
			for _, legacy := range legacyRows {
				conversation, ok := conversations[legacy.ConversationID]
				if !ok {
					if err := tx.First(
						&conversation,
						"conversation_id = ?",
						legacy.ConversationID,
					).Error; err != nil {
						return err
					}
					conversations[legacy.ConversationID] = conversation
				}
				homeStationID, err := authorityActorHomeStationID(
					tx,
					legacy.PTID,
				)
				if err != nil {
					return err
				}
				role := "member"
				if conversation.OwnerPTID == legacy.PTID {
					role = "owner"
				}
				if legacy.Active {
					if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
						Create(&AuthorityMemberModel{
							ConversationID: legacy.ConversationID,
							PTID:           legacy.PTID,
							HomeStationID:  homeStationID,
							Role:           role,
							Active:         true,
							JoinedSequence: 1,
						}).Error; err != nil {
						return err
					}
				}
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
					Create(&AuthorityMemberDeviceModel{
						ConversationID: legacy.ConversationID,
						PTID:           legacy.PTID,
						DeviceID:       legacy.DeviceID,
						Active:         legacy.Active,
						JoinedSequence: 1,
					}).Error; err != nil {
					return err
				}
			}
			return tx.Migrator().DropTable("messaging_member_devices")
		}); err != nil {
			return err
		}
	}
	if err := r.backfillAuthorityMemberHomeStations(); err != nil {
		return err
	}
	return r.backfillMessageIdentity()
}

func (r *AuthorityRepository) backfillAuthorityMemberHomeStations() error {
	var members []AuthorityMemberModel
	if err := r.db.
		Where("home_station_id = '' OR home_station_id IS NULL").
		Order("conversation_id ASC, ptid ASC").
		Find(&members).Error; err != nil {
		return err
	}
	for _, member := range members {
		homeStationID, err := authorityActorHomeStationID(r.db, member.PTID)
		if err != nil {
			return fmt.Errorf(
				"messaging: backfill authority member %s in conversation %s: %w",
				member.PTID,
				member.ConversationID,
				err,
			)
		}
		if err := r.db.Model(&AuthorityMemberModel{}).
			Where(
				"conversation_id = ? AND ptid = ? AND (home_station_id = '' OR home_station_id IS NULL)",
				member.ConversationID,
				member.PTID,
			).
			Update("home_station_id", homeStationID).Error; err != nil {
			return err
		}
	}
	return nil
}

func authorityActorHomeStationID(db *gorm.DB, ptid string) (string, error) {
	var actor ActorFederationReadModel
	if err := db.
		Select("ptid", "home_station_peer_id").
		Where("ptid = ?", ptid).
		First(&actor).Error; err != nil {
		return "", err
	}
	if actor.HomeStationPeerID == "" {
		return "", messaging.ErrEndpointManifestInvalid
	}
	return actor.HomeStationPeerID, nil
}

func (r *AuthorityRepository) backfillMessageIdentity() error {
	var models []AuthorityEventModel
	if err := r.db.
		Where("message_id = '' OR message_id IS NULL").
		Order("conversation_id ASC, sequence ASC").
		Find(&models).Error; err != nil {
		return err
	}
	for _, model := range models {
		event := &chat.ConversationEvent{}
		if err := proto.Unmarshal(model.EventBytes, event); err != nil {
			return fmt.Errorf("messaging: decode authority event for message identity: %w", err)
		}
		message := event.GetMessageCommitted()
		if message == nil || message.MessageId == "" || message.Sender == nil {
			continue
		}
		if err := r.db.Model(&AuthorityEventModel{}).
			Where("event_id = ?", model.EventID).
			Updates(map[string]any{
				"message_id":          message.MessageId,
				"message_author_ptid": message.Sender.Ptid,
			}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *AuthorityRepository) LockConversation(
	ctx context.Context,
	conversationID string,
) (*messaging.AuthorityConversation, error) {
	var model AuthorityConversationModel
	if err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("conversation_id = ?", conversationID).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return authorityConversationFromModel(model), nil
}

func authorityConversationFromModel(model AuthorityConversationModel) *messaging.AuthorityConversation {
	return &messaging.AuthorityConversation{
		ConversationID:  model.ConversationID,
		Kind:            messaging.AuthorityConversationKind(model.Kind),
		Name:            model.Name,
		OwnerPTID:       model.OwnerPTID,
		CurrentSequence: model.CurrentSequence,
		MembershipEpoch: model.MembershipEpoch,
		MlsEpoch:        model.MlsEpoch,
		Active:          model.Active,
	}
}

func (r *AuthorityRepository) ListActiveMemberDevices(
	ctx context.Context,
	conversationID string,
) ([]messaging.AuthorityMemberDevice, error) {
	var models []AuthorityMemberDeviceModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND active = ?", conversationID, true).
		Order("ptid ASC, device_id ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	devices := make([]messaging.AuthorityMemberDevice, 0, len(models))
	for _, model := range models {
		devices = append(devices, messaging.AuthorityMemberDevice{
			Endpoint: &chat.CryptoEndpoint{Ptid: model.PTID, DeviceId: model.DeviceID},
			Active:   model.Active,
		})
	}
	return devices, nil
}

func (r *AuthorityRepository) GetLastEvent(
	ctx context.Context,
	conversationID string,
) (*chat.ConversationEvent, error) {
	var model AuthorityEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Order("sequence DESC").
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	event := &chat.ConversationEvent{}
	if err := proto.Unmarshal(model.EventBytes, event); err != nil {
		return nil, fmt.Errorf("messaging: decode authority event: %w", err)
	}
	return event, nil
}

func (r *AuthorityRepository) GetMessageIdentity(
	ctx context.Context,
	conversationID string,
	messageID string,
) (*messaging.AuthorityMessageIdentity, error) {
	if conversationID == "" || messageID == "" {
		return nil, messaging.ErrNotFound
	}
	var model AuthorityEventModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND message_id = ?", conversationID, messageID).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &messaging.AuthorityMessageIdentity{
		ConversationID: model.ConversationID,
		MessageID:      model.MessageID,
		AuthorPTID:     model.MessageAuthorPTID,
		EventID:        model.EventID,
		Sequence:       model.Sequence,
	}, nil
}

func (r *AuthorityRepository) GetCommandReceipt(
	ctx context.Context,
	conversationID string,
	commandID string,
) (*messaging.AuthorityCommandReceipt, error) {
	var model AuthorityCommandReceiptModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND command_id = ?", conversationID, commandID).
		First(&model).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &messaging.AuthorityCommandReceipt{
		ConversationID: model.ConversationID,
		CommandID:      model.CommandID,
		CommandSHA256:  append([]byte(nil), model.CommandSHA256...),
		EventBytes:     append([]byte(nil), model.EventBytes...),
		CreatedAt:      model.CreatedAt,
	}, nil
}

func (r *AuthorityRepository) AppendEvent(
	ctx context.Context,
	event *chat.ConversationEvent,
) error {
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return err
	}
	var messageID string
	var messageAuthorPTID string
	if message := event.GetMessageCommitted(); message != nil {
		messageID = message.MessageId
		if message.Sender != nil {
			messageAuthorPTID = message.Sender.Ptid
		}
	}
	if err := r.db.WithContext(ctx).Create(&AuthorityEventModel{
		EventID:           event.EventId,
		ConversationID:    event.ConversationId,
		Sequence:          event.Sequence,
		CommandID:         event.CommandId,
		MessageID:         messageID,
		MessageAuthorPTID: messageAuthorPTID,
		EventHash:         event.EventHash,
		EventBytes:        eventBytes,
		CommittedAt:       event.CommittedAt.AsTime(),
	}).Error; err != nil {
		return err
	}
	result := r.db.WithContext(ctx).
		Model(&AuthorityConversationModel{}).
		Where(
			"conversation_id = ? AND current_sequence = ?",
			event.ConversationId,
			event.Sequence-1,
		).
		Update("current_sequence", event.Sequence)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("messaging: authority sequence compare-and-set failed")
	}
	return nil
}

func (r *AuthorityRepository) AdvanceEpochs(
	ctx context.Context,
	conversationID string,
	fromMembershipEpoch int64,
	fromMlsEpoch int64,
	toMembershipEpoch int64,
	toMlsEpoch int64,
) error {
	result := r.db.WithContext(ctx).
		Model(&AuthorityConversationModel{}).
		Where(
			"conversation_id = ? AND membership_epoch = ? AND mls_epoch = ?",
			conversationID,
			fromMembershipEpoch,
			fromMlsEpoch,
		).
		Updates(map[string]any{
			"membership_epoch": toMembershipEpoch,
			"mls_epoch":        toMlsEpoch,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("messaging: authority epoch compare-and-set failed")
	}
	return nil
}

func (r *AuthorityRepository) CreateCommandReceipt(
	ctx context.Context,
	receipt *messaging.AuthorityCommandReceipt,
) error {
	return r.db.WithContext(ctx).Create(&AuthorityCommandReceiptModel{
		ConversationID: receipt.ConversationID,
		CommandID:      receipt.CommandID,
		CommandSHA256:  receipt.CommandSHA256,
		EventBytes:     receipt.EventBytes,
		CreatedAt:      receipt.CreatedAt,
	}).Error
}

type DeviceDirectory struct {
	db *gorm.DB
}

func NewDeviceDirectory(db *gorm.DB) *DeviceDirectory {
	return &DeviceDirectory{db: db}
}

func (d *DeviceDirectory) IsActive(
	ctx context.Context,
	endpoint *chat.CryptoEndpoint,
) (bool, error) {
	if endpoint == nil {
		return false, nil
	}
	var count int64
	err := d.db.WithContext(ctx).
		Model(&ActorDeviceReadModel{}).
		Where(
			"ptid = ? AND device_id = ? AND revoked = ? AND verification_source <> ? AND length(public_key) = ?",
			endpoint.Ptid,
			endpoint.DeviceId,
			false,
			0,
			32,
		).
		Count(&count).Error
	return count == 1, err
}

func (d *DeviceDirectory) IsActiveDevice(
	ctx context.Context,
	ptid string,
	deviceID string,
) (bool, error) {
	return d.IsActive(ctx, &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID})
}

func (d *DeviceDirectory) ActorIdentityPublicKey(
	ctx context.Context,
	ptid string,
) ([]byte, error) {
	var identity ActorIdentityReadModel
	err := d.db.WithContext(ctx).
		Where("ptid = ?", ptid).
		First(&identity).Error
	if err != nil {
		return nil, mapNotFound(err)
	}
	if len(identity.PublicKey) != 32 {
		return nil, fmt.Errorf("messaging: invalid actor identity public key")
	}
	return append([]byte(nil), identity.PublicKey...), nil
}

func (d *DeviceDirectory) ActorHomeStationID(
	ctx context.Context,
	ptid string,
) (string, error) {
	if ptid == "" {
		return "", messaging.ErrNotFound
	}
	var actor ActorFederationReadModel
	if err := d.db.WithContext(ctx).
		Select("ptid", "home_station_peer_id", "origin").
		Where("ptid = ?", ptid).
		First(&actor).Error; err != nil {
		return "", mapNotFound(err)
	}
	if actor.HomeStationPeerID == "" {
		return "", messaging.ErrNotFound
	}
	if actor.Origin != touchactor.OriginLocal &&
		actor.Origin != touchactor.OriginRemoteCached {
		return "", messaging.ErrEndpointManifestConflict
	}
	return actor.HomeStationPeerID, nil
}

func (d *DeviceDirectory) HomeStationID(
	ctx context.Context,
	endpoint *chat.CryptoEndpoint,
) (string, error) {
	if endpoint == nil || endpoint.Ptid == "" || endpoint.DeviceId == "" {
		return "", messaging.ErrNotFound
	}
	var record ActorDeviceReadModel
	if err := d.db.WithContext(ctx).
		Where(
			"ptid = ? AND device_id = ? AND revoked = ? AND verification_source <> ?",
			endpoint.Ptid,
			endpoint.DeviceId,
			false,
			0,
		).
		First(&record).Error; err != nil {
		return "", mapNotFound(err)
	}
	if record.HomeStationPeerID == "" {
		return "", fmt.Errorf("messaging: endpoint has no Home Station")
	}
	return record.HomeStationPeerID, nil
}

func (d *DeviceDirectory) ListActiveEndpoints(
	ctx context.Context,
	ptid string,
) ([]*chat.CryptoEndpoint, error) {
	var records []ActorDeviceReadModel
	if err := d.db.WithContext(ctx).
		Where(
			"ptid = ? AND revoked = ? AND verification_source <> ? AND length(public_key) = ?",
			ptid,
			false,
			0,
			32,
		).
		Order("device_id ASC").
		Find(&records).Error; err != nil {
		return nil, err
	}
	endpoints := make([]*chat.CryptoEndpoint, 0, len(records))
	for _, record := range records {
		endpoints = append(endpoints, &chat.CryptoEndpoint{
			Ptid:     record.PTID,
			DeviceId: record.DeviceID,
		})
	}
	return endpoints, nil
}

func mapNotFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return messaging.ErrNotFound
	}
	return err
}
