package persistence

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type authorityRepository struct {
	db     *gorm.DB
	sealer domainevent.Sealer
}

func newAuthorityRepository(
	db *gorm.DB,
	sealer domainevent.Sealer,
) *authorityRepository {
	return &authorityRepository{db: db, sealer: sealer}
}

func (r *authorityRepository) Create(
	ctx context.Context,
	snapshot aggregate.Snapshot,
) error {
	model := conversationModelFromSnapshot(snapshot)
	if err := r.db.WithContext(ctx).Create(&model).Error; err != nil {
		return aggregateCreationPersistenceError(err)
	}
	return r.replaceChildren(ctx, snapshot)
}

func aggregateCreationPersistenceError(err error) error {
	if isAggregateCreationContention(err) {
		return &conversationdomain.Error{
			Code:      conversationdomain.ErrorCodeCommandConflict,
			Operation: "persistence.create_aggregate",
			Field:     "aggregate",
			Message:   "creation contended with a concurrent transaction",
			Cause:     err,
		}
	}
	return fmt.Errorf("conversation persistence: create aggregate: %w", err)
}

func isAggregateCreationContention(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var sqlState interface {
		SQLState() string
	}
	if errors.As(err, &sqlState) {
		switch sqlState.SQLState() {
		case "23505", "40001", "40P01":
			return true
		}
	}

	message := err.Error()
	return strings.Contains(message, "SQLSTATE 23505") ||
		strings.Contains(message, "SQLSTATE 40001") ||
		strings.Contains(message, "SQLSTATE 40P01") ||
		strings.Contains(message, "UNIQUE constraint failed")
}

func (r *authorityRepository) LoadForUpdate(
	ctx context.Context,
	conversationID valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	var model ConversationModel
	if err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "conversation_id = ?", string(conversationID)).
		Error; err != nil {
		return aggregate.Snapshot{}, persistenceError("load aggregate for update", err)
	}
	return r.loadSnapshot(ctx, model)
}

func (r *authorityRepository) Get(
	ctx context.Context,
	conversationID valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	var model ConversationModel
	if err := r.db.WithContext(ctx).
		First(&model, "conversation_id = ?", string(conversationID)).
		Error; err != nil {
		return aggregate.Snapshot{}, persistenceError("get aggregate", err)
	}
	return r.loadSnapshot(ctx, model)
}

func (r *authorityRepository) ListByActor(
	ctx context.Context,
	actor valueobject.PTID,
) ([]aggregate.Snapshot, error) {
	var models []ConversationModel
	if err := r.db.WithContext(ctx).
		Table("conversations").
		Joins(
			"JOIN conversation_members ON "+
				"conversation_members.conversation_id = conversations.conversation_id",
		).
		Where(
			"conversation_members.ptid = ? AND conversation_members.member_status = ?",
			string(actor),
			string(valueobject.MemberStatusActive),
		).
		Order("conversations.updated_at DESC, conversations.conversation_id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("conversation persistence: list aggregates: %w", err)
	}
	snapshots := make([]aggregate.Snapshot, 0, len(models))
	for _, model := range models {
		snapshot, err := r.loadSnapshot(ctx, model)
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func (r *authorityRepository) Save(
	ctx context.Context,
	snapshot aggregate.Snapshot,
) error {
	model := conversationModelFromSnapshot(snapshot)
	result := r.db.WithContext(ctx).
		Model(&ConversationModel{}).
		Where("conversation_id = ?", model.ConversationID).
		Updates(map[string]any{
			"kind":                      model.Kind,
			"status":                    model.Status,
			"federation_id":             model.FederationID,
			"authority_station_peer_id": model.AuthorityStationPeerID,
			"authority_epoch":           model.AuthorityEpoch,
			"owner_ptid":                model.OwnerPTID,
			"current_sequence":          model.CurrentSequence,
			"current_event_hash":        model.CurrentEventHash,
			"membership_epoch":          model.MembershipEpoch,
			"mls_epoch":                 model.MLSEpoch,
			"name":                      model.Name,
			"description":               model.Description,
			"avatar_object_id":          model.AvatarObjectID,
			"visibility":                model.Visibility,
			"updated_at":                model.UpdatedAt,
		})
	if result.Error != nil {
		return fmt.Errorf("conversation persistence: save aggregate: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return notFound("save aggregate")
	}
	return r.replaceChildren(ctx, snapshot)
}

func (r *authorityRepository) replaceChildren(
	ctx context.Context,
	snapshot aggregate.Snapshot,
) error {
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", string(snapshot.ID)).
		Delete(&ConversationMemberModel{}).Error; err != nil {
		return fmt.Errorf("conversation persistence: replace members: %w", err)
	}
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", string(snapshot.ID)).
		Delete(&ConversationMemberDeviceModel{}).Error; err != nil {
		return fmt.Errorf("conversation persistence: replace devices: %w", err)
	}
	members := make([]ConversationMemberModel, 0, len(snapshot.Members))
	for _, member := range snapshot.Members {
		members = append(members, ConversationMemberModel{
			ConversationID: string(snapshot.ID),
			PTID:           string(member.Actor),
			Role:           string(member.Role),
			Status:         string(member.Status),
			HomeStation:    string(member.HomeStation),
			JoinedSequence: uint64(member.JoinedAt),
			LeftSequence:   uint64(member.LeftAt),
			Muted:          member.Muted,
			MutedUntil:     cloneTimePointer(member.MutedUntil),
		})
	}
	if len(members) > 0 {
		if err := r.db.WithContext(ctx).Create(&members).Error; err != nil {
			return fmt.Errorf("conversation persistence: insert members: %w", err)
		}
	}
	devices := make([]ConversationMemberDeviceModel, 0, len(snapshot.Devices))
	for _, device := range snapshot.Devices {
		devices = append(devices, ConversationMemberDeviceModel{
			ConversationID: string(snapshot.ID),
			PTID:           string(device.Endpoint.Actor),
			DeviceID:       string(device.Endpoint.Device),
			HomeStation:    string(device.HomeStation),
			Active:         device.Active,
			JoinedSequence: uint64(device.JoinedAt),
			LeftSequence:   uint64(device.LeftAt),
		})
	}
	if len(devices) > 0 {
		if err := r.db.WithContext(ctx).Create(&devices).Error; err != nil {
			return fmt.Errorf("conversation persistence: insert devices: %w", err)
		}
	}
	return nil
}

func (r *authorityRepository) loadSnapshot(
	ctx context.Context,
	model ConversationModel,
) (aggregate.Snapshot, error) {
	var memberModels []ConversationMemberModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", model.ConversationID).
		Order("ptid ASC").
		Find(&memberModels).Error; err != nil {
		return aggregate.Snapshot{}, fmt.Errorf("conversation persistence: load members: %w", err)
	}
	var deviceModels []ConversationMemberDeviceModel
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", model.ConversationID).
		Order("ptid ASC, device_id ASC").
		Find(&deviceModels).Error; err != nil {
		return aggregate.Snapshot{}, fmt.Errorf("conversation persistence: load devices: %w", err)
	}
	headHash, err := persistedHash(model.CurrentEventHash, model.CurrentSequence == 0)
	if err != nil {
		return aggregate.Snapshot{}, err
	}
	members := make([]entity.Member, 0, len(memberModels))
	for _, member := range memberModels {
		members = append(members, entity.Member{
			Actor:       valueobject.PTID(member.PTID),
			Role:        valueobject.MemberRole(member.Role),
			Status:      valueobject.MemberStatus(member.Status),
			HomeStation: valueobject.StationID(member.HomeStation),
			JoinedAt:    valueobject.Sequence(member.JoinedSequence),
			LeftAt:      valueobject.Sequence(member.LeftSequence),
			Muted:       member.Muted,
			MutedUntil:  cloneTimePointer(member.MutedUntil),
		})
	}
	devices := make([]entity.MemberDevice, 0, len(deviceModels))
	for _, device := range deviceModels {
		devices = append(devices, entity.MemberDevice{
			Endpoint: valueobject.Endpoint{
				Actor:  valueobject.PTID(device.PTID),
				Device: valueobject.DeviceID(device.DeviceID),
			},
			HomeStation: valueobject.StationID(device.HomeStation),
			Active:      device.Active,
			JoinedAt:    valueobject.Sequence(device.JoinedSequence),
			LeftAt:      valueobject.Sequence(device.LeftSequence),
		})
	}
	if len(devices) == 0 &&
		model.Kind == string(valueobject.ConversationKindDirect) {
		devices, err = r.recoverDirectGenesisDevices(ctx, model, members)
		if err != nil {
			return aggregate.Snapshot{}, err
		}
	}
	snapshot := aggregate.Snapshot{
		ID:               valueobject.ConversationID(model.ConversationID),
		Kind:             valueobject.ConversationKind(model.Kind),
		Status:           valueobject.ConversationStatus(model.Status),
		FederationID:     valueobject.FederationID(model.FederationID),
		AuthorityStation: valueobject.StationID(model.AuthorityStationPeerID),
		AuthorityEpoch:   valueobject.AuthorityEpoch(model.AuthorityEpoch),
		Owner:            valueobject.PTID(model.OwnerPTID),
		Head: valueobject.AuthorityHead{
			Sequence:        valueobject.Sequence(model.CurrentSequence),
			EventHash:       headHash,
			MembershipEpoch: valueobject.Epoch(model.MembershipEpoch),
			MLSEpoch:        valueobject.Epoch(model.MLSEpoch),
		},
		Settings: valueobject.ConversationSettings{
			Name:           model.Name,
			Description:    model.Description,
			AvatarObjectID: model.AvatarObjectID,
			Visibility:     valueobject.ConversationVisibility(model.Visibility),
		},
		Members:   members,
		Devices:   devices,
		CreatedAt: model.CreatedAt,
		UpdatedAt: model.UpdatedAt,
	}
	if _, err := aggregate.Rehydrate(snapshot); err != nil {
		return aggregate.Snapshot{}, err
	}
	return snapshot, nil
}

func (r *authorityRepository) recoverDirectGenesisDevices(
	ctx context.Context,
	model ConversationModel,
	members []entity.Member,
) ([]entity.MemberDevice, error) {
	genesis, err := newEventRepository(r.db, r.sealer).GetBySequence(
		ctx,
		valueobject.ConversationID(model.ConversationID),
		1,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"conversation persistence: recover Direct device projection: %w",
			err,
		)
	}
	state := genesis.Fact.PostState
	if genesis.Fact.Kind != domainevent.KindConversationCreated ||
		state == nil ||
		state.Kind != valueobject.ConversationKindDirect ||
		genesis.ConversationID != valueobject.ConversationID(model.ConversationID) ||
		genesis.AuthorityStation != valueobject.StationID(model.AuthorityStationPeerID) ||
		state.FederationID != valueobject.FederationID(model.FederationID) ||
		state.AuthorityEpoch != valueobject.AuthorityEpoch(model.AuthorityEpoch) ||
		state.Owner != valueobject.PTID(model.OwnerPTID) ||
		state.MembershipEpoch != valueobject.Epoch(model.MembershipEpoch) ||
		state.MLSEpoch != valueobject.Epoch(model.MLSEpoch) ||
		len(state.ActiveDevices) == 0 ||
		!sameActiveMembers(members, state.ActiveMembers) ||
		!valueobject.EqualEndpointSets(
			activeDeviceEndpoints(state.ActiveDevices),
			state.ActiveEndpoints,
		) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.recover_direct_projection",
			"genesis_event",
			"does not match the persisted Direct aggregate",
		)
	}
	devices := append([]entity.MemberDevice(nil), state.ActiveDevices...)
	sort.Slice(devices, func(i int, j int) bool {
		return devices[i].Endpoint.Key() < devices[j].Endpoint.Key()
	})
	return devices, nil
}

func sameActiveMembers(left []entity.Member, right []entity.Member) bool {
	leftActive := make([]entity.Member, 0, len(left))
	for _, member := range left {
		if member.Active() {
			leftActive = append(leftActive, member)
		}
	}
	rightActive := append([]entity.Member(nil), right...)
	sort.Slice(leftActive, func(i int, j int) bool {
		return leftActive[i].Actor < leftActive[j].Actor
	})
	sort.Slice(rightActive, func(i int, j int) bool {
		return rightActive[i].Actor < rightActive[j].Actor
	})
	if len(leftActive) != len(rightActive) {
		return false
	}
	for index := range leftActive {
		if leftActive[index] != rightActive[index] {
			return false
		}
	}
	return true
}

func activeDeviceEndpoints(devices []entity.MemberDevice) []valueobject.Endpoint {
	endpoints := make([]valueobject.Endpoint, 0, len(devices))
	for _, device := range devices {
		if device.Active {
			endpoints = append(endpoints, device.Endpoint)
		}
	}
	return valueobject.SortEndpoints(endpoints)
}

func cloneTimePointer(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	copy := value.UTC()
	return &copy
}

type eventRepository struct {
	db     *gorm.DB
	sealer domainevent.Sealer
}

func newEventRepository(db *gorm.DB, sealer domainevent.Sealer) *eventRepository {
	return &eventRepository{db: db, sealer: sealer}
}

func (r *eventRepository) Append(ctx context.Context, event domainevent.Record) error {
	rehydrated, err := domainevent.Verify(event, r.sealer)
	if err != nil {
		return err
	}
	var messageID *string
	var messageAuthor string
	if rehydrated.Fact.Kind == domainevent.KindMessageCommitted ||
		rehydrated.Fact.Kind == domainevent.KindMessageForwarded {
		value := string(rehydrated.Fact.MessageID)
		messageID = &value
		messageAuthor = string(rehydrated.Actor.Actor)
	}
	snapshot := rehydrated.Clone()
	snapshot.EncodedBytes = nil
	domainSnapshot, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("conversation persistence: encode event: %w", err)
	}
	return r.db.WithContext(ctx).Create(&ConversationEventModel{
		EventID:          string(rehydrated.ID),
		ConversationID:   string(rehydrated.ConversationID),
		Sequence:         uint64(rehydrated.Sequence),
		CommandID:        string(rehydrated.CommandID),
		MessageID:        messageID,
		MessageAuthor:    messageAuthor,
		ActorPTID:        string(rehydrated.Actor.Actor),
		ActorDeviceID:    string(rehydrated.Actor.Device),
		PreviousHash:     optionalHash(rehydrated.PreviousHash),
		EventHash:        rehydrated.Hash.Bytes(),
		MembershipEpoch:  uint64(rehydrated.MembershipEpoch),
		MLSEpoch:         uint64(rehydrated.MLSEpoch),
		AuthorityStation: string(rehydrated.AuthorityStation),
		EventKind:        string(rehydrated.Fact.Kind),
		HashScheme:       string(rehydrated.HashScheme),
		EventBytes:       rehydrated.Bytes(),
		DomainSnapshot:   domainSnapshot,
		CommittedAt:      rehydrated.CommittedAt,
	}).Error
}

func (r *eventRepository) GetByID(
	ctx context.Context,
	eventID valueobject.EventID,
) (domainevent.Record, error) {
	var model ConversationEventModel
	if err := r.db.WithContext(ctx).
		First(&model, "event_id = ?", string(eventID)).
		Error; err != nil {
		return domainevent.Record{}, persistenceError("get event", err)
	}
	return r.eventFromModel(model)
}

func (r *eventRepository) GetByCommand(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
) (domainevent.Record, error) {
	var model ConversationEventModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND command_id = ?",
			string(conversationID),
			string(commandID),
		).Error; err != nil {
		return domainevent.Record{}, persistenceError("get event by command", err)
	}
	return r.eventFromModel(model)
}

func (r *eventRepository) GetBySequence(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	sequence valueobject.Sequence,
) (domainevent.Record, error) {
	var model ConversationEventModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND sequence = ?",
			string(conversationID),
			uint64(sequence),
		).Error; err != nil {
		return domainevent.Record{}, persistenceError("get event by sequence", err)
	}
	return r.eventFromModel(model)
}

func (r *eventRepository) GetMessageIdentity(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	messageID valueobject.MessageID,
) (repository.MessageIdentity, error) {
	var model ConversationEventModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND message_id = ?",
			string(conversationID),
			string(messageID),
		).Error; err != nil {
		return repository.MessageIdentity{}, persistenceError("get message identity", err)
	}
	return repository.MessageIdentity{
		ConversationID: valueobject.ConversationID(model.ConversationID),
		MessageID:      valueobject.MessageID(*model.MessageID),
		Author:         valueobject.PTID(model.MessageAuthor),
		EventID:        valueobject.EventID(model.EventID),
		Sequence:       valueobject.Sequence(model.Sequence),
	}, nil
}

func (r *eventRepository) List(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	after valueobject.Sequence,
	limit int,
) ([]domainevent.Record, error) {
	var models []ConversationEventModel
	if err := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND sequence > ?",
			string(conversationID),
			uint64(after),
		).
		Order("sequence ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("conversation persistence: list events: %w", err)
	}
	events := make([]domainevent.Record, 0, len(models))
	for _, model := range models {
		event, err := r.eventFromModel(model)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, nil
}

const messageQueryBatchSize = 500

func (r *eventRepository) ListMessages(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	after valueobject.Sequence,
	limit int,
) ([]domainevent.Record, error) {
	models, err := r.listMessageModels(ctx, conversationID, after, limit)
	if err != nil {
		return nil, err
	}
	return r.eventsFromModels(models)
}

func (r *eventRepository) ListThreadMessages(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	threadRootID valueobject.MessageID,
	after valueobject.Sequence,
	limit int,
) ([]domainevent.Record, error) {
	if threadRootID == "" {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"persistence.list_thread_messages",
			"thread_root_message_id",
			"is required",
		)
	}
	if limit <= 0 {
		return []domainevent.Record{}, nil
	}

	events := make([]domainevent.Record, 0, limit)
	cursor := after
	for len(events) < limit {
		models, err := r.listMessageModels(
			ctx,
			conversationID,
			cursor,
			messageQueryBatchSize,
		)
		if err != nil {
			return nil, err
		}
		if len(models) == 0 {
			break
		}
		for _, model := range models {
			event, err := r.eventFromModel(model)
			if err != nil {
				return nil, err
			}
			rootID, err := canonicalThreadRoot(event)
			if err != nil {
				return nil, err
			}
			if rootID == threadRootID {
				events = append(events, event)
				if len(events) == limit {
					return events, nil
				}
			}
		}
		nextCursor := valueobject.Sequence(models[len(models)-1].Sequence)
		if nextCursor <= cursor {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"persistence.list_thread_messages",
				"sequence",
				"message query cursor did not advance",
			)
		}
		cursor = nextCursor
		if len(models) < messageQueryBatchSize {
			break
		}
	}
	return events, nil
}

func (r *eventRepository) ThreadCounts(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	rootIDs []valueobject.MessageID,
) ([]repository.ThreadCount, error) {
	normalizedRoots, err := normalizeThreadRootIDs(rootIDs)
	if err != nil {
		return nil, err
	}
	counts := make([]repository.ThreadCount, len(normalizedRoots))
	countIndex := make(map[valueobject.MessageID]int, len(normalizedRoots))
	for index, rootID := range normalizedRoots {
		counts[index].RootMessageID = rootID
		countIndex[rootID] = index
	}
	if len(counts) == 0 {
		return counts, nil
	}

	var cursor valueobject.Sequence
	for {
		models, err := r.listMessageModels(
			ctx,
			conversationID,
			cursor,
			messageQueryBatchSize,
		)
		if err != nil {
			return nil, err
		}
		if len(models) == 0 {
			break
		}
		for _, model := range models {
			event, err := r.eventFromModel(model)
			if err != nil {
				return nil, err
			}
			rootID, err := canonicalThreadRoot(event)
			if err != nil {
				return nil, err
			}
			index, requested := countIndex[rootID]
			if !requested {
				continue
			}
			counts[index].ReplyCount++
			counts[index].LatestReplyID = event.Fact.MessageID
			counts[index].LatestReplyAt = event.CommittedAt
		}
		nextCursor := valueobject.Sequence(models[len(models)-1].Sequence)
		if nextCursor <= cursor {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"persistence.thread_counts",
				"sequence",
				"message query cursor did not advance",
			)
		}
		cursor = nextCursor
		if len(models) < messageQueryBatchSize {
			break
		}
	}
	return counts, nil
}

func (r *eventRepository) listMessageModels(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	after valueobject.Sequence,
	limit int,
) ([]ConversationEventModel, error) {
	if limit <= 0 {
		return []ConversationEventModel{}, nil
	}
	var models []ConversationEventModel
	if err := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND sequence > ? AND event_kind IN ?",
			string(conversationID),
			uint64(after),
			[]string{
				string(domainevent.KindMessageCommitted),
				string(domainevent.KindMessageForwarded),
			},
		).
		Order("sequence ASC, event_id ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("conversation persistence: list message events: %w", err)
	}
	return models, nil
}

func (r *eventRepository) eventsFromModels(
	models []ConversationEventModel,
) ([]domainevent.Record, error) {
	events := make([]domainevent.Record, 0, len(models))
	for _, model := range models {
		event, err := r.eventFromModel(model)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, nil
}

func canonicalThreadRoot(event domainevent.Record) (valueobject.MessageID, error) {
	if event.Fact.Kind != domainevent.KindMessageCommitted &&
		event.Fact.Kind != domainevent.KindMessageForwarded {
		return "", conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_message_query_index",
			"event_kind",
			"is not a committed message",
		)
	}
	var source chat.ChatCommand
	if err := proto.Unmarshal(event.Fact.Payload, &source); err != nil {
		return "", conversationdomain.WrapError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_message_query_index",
			fmt.Errorf("decode canonical source command: %w", err),
		)
	}
	messageID := ""
	threadRootMessageID := ""
	switch event.Fact.Kind {
	case domainevent.KindMessageCommitted:
		message := source.GetSendMessage()
		if message == nil {
			return "", conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"persistence.decode_message_query_index",
				"message",
				"canonical source command has no send payload",
			)
		}
		messageID = message.GetMessageId()
		threadRootMessageID = message.GetThreadRootMessageId()
	case domainevent.KindMessageForwarded:
		message := source.GetForwardMessage()
		if message == nil {
			return "", conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"persistence.decode_message_query_index",
				"message",
				"canonical source command has no forward payload",
			)
		}
		messageID = message.GetDestinationMessageId()
	}
	if valueobject.ConversationID(source.GetConversationId()) != event.ConversationID ||
		valueobject.CommandID(source.GetCommandId()) != event.CommandID ||
		source.GetSender() == nil ||
		valueobject.PTID(source.GetSender().GetPtid()) != event.Actor.Actor ||
		valueobject.DeviceID(source.GetSender().GetDeviceId()) != event.Actor.Device ||
		valueobject.MessageID(messageID) != event.Fact.MessageID {
		return "", conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_message_query_index",
			"message_identity",
			"canonical source command disagrees with the domain event",
		)
	}
	return valueobject.MessageID(threadRootMessageID), nil
}

func normalizeThreadRootIDs(
	rootIDs []valueobject.MessageID,
) ([]valueobject.MessageID, error) {
	unique := make(map[valueobject.MessageID]struct{}, len(rootIDs))
	for _, rootID := range rootIDs {
		if rootID == "" {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"persistence.thread_counts",
				"root_ids",
				"cannot contain an empty message identity",
			)
		}
		unique[rootID] = struct{}{}
	}
	normalized := make([]valueobject.MessageID, 0, len(unique))
	for rootID := range unique {
		normalized = append(normalized, rootID)
	}
	sort.Slice(normalized, func(i int, j int) bool {
		return normalized[i] < normalized[j]
	})
	return normalized, nil
}

func (r *eventRepository) eventFromModel(
	model ConversationEventModel,
) (domainevent.Record, error) {
	var event domainevent.Record
	if err := json.Unmarshal(model.DomainSnapshot, &event); err != nil {
		return domainevent.Record{}, fmt.Errorf("conversation persistence: decode event: %w", err)
	}
	event.HashScheme = domainevent.HashScheme(model.HashScheme)
	event.EncodedBytes = append([]byte(nil), model.EventBytes...)
	rehydrated, err := domainevent.Rehydrate(event)
	if err != nil {
		return domainevent.Record{}, err
	}
	if rehydrated.ID != valueobject.EventID(model.EventID) ||
		rehydrated.ConversationID != valueobject.ConversationID(model.ConversationID) ||
		rehydrated.Sequence != valueobject.Sequence(model.Sequence) ||
		rehydrated.CommandID != valueobject.CommandID(model.CommandID) ||
		rehydrated.Actor.Actor != valueobject.PTID(model.ActorPTID) ||
		rehydrated.Actor.Device != valueobject.DeviceID(model.ActorDeviceID) ||
		!bytes.Equal(optionalHash(rehydrated.PreviousHash), model.PreviousHash) ||
		!bytes.Equal(rehydrated.Hash[:], model.EventHash) ||
		rehydrated.MembershipEpoch != valueobject.Epoch(model.MembershipEpoch) ||
		rehydrated.MLSEpoch != valueobject.Epoch(model.MLSEpoch) ||
		rehydrated.AuthorityStation != valueobject.StationID(model.AuthorityStation) ||
		rehydrated.Fact.Kind != domainevent.Kind(model.EventKind) ||
		!rehydrated.CommittedAt.Equal(model.CommittedAt) {
		return domainevent.Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_event",
			"event",
			"indexed columns disagree with canonical event bytes",
		)
	}
	switch {
	case (rehydrated.Fact.Kind == domainevent.KindMessageCommitted ||
		rehydrated.Fact.Kind == domainevent.KindMessageForwarded) &&
		(model.MessageID == nil ||
			rehydrated.Fact.MessageID != valueobject.MessageID(*model.MessageID) ||
			rehydrated.Actor.Actor != valueobject.PTID(model.MessageAuthor)):
		return domainevent.Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_event",
			"message_identity",
			"indexed message identity disagrees with canonical event bytes",
		)
	case rehydrated.Fact.Kind != domainevent.KindMessageCommitted &&
		rehydrated.Fact.Kind != domainevent.KindMessageForwarded &&
		(model.MessageID != nil || model.MessageAuthor != ""):
		return domainevent.Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_event",
			"message_identity",
			"non-message event contains indexed message identity",
		)
	}
	return domainevent.Verify(rehydrated, r.sealer)
}

type receiptRepository struct {
	db *gorm.DB
}

func newReceiptRepository(db *gorm.DB) *receiptRepository {
	return &receiptRepository{db: db}
}

func (r *receiptRepository) Get(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
) (repository.CommandReceipt, error) {
	var model ConversationCommandReceiptModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND command_id = ?",
			string(conversationID),
			string(commandID),
		).Error; err != nil {
		return repository.CommandReceipt{}, persistenceError("get command receipt", err)
	}
	hash, err := valueobject.NewHash(model.CommandHash)
	if err != nil {
		return repository.CommandReceipt{}, err
	}
	outcome := repository.CommandReceiptOutcome(model.Outcome)
	switch outcome {
	case repository.CommandReceiptOutcomeAccepted:
		if model.EventID == "" || len(model.EventBytes) == 0 || model.RejectionCode != "" {
			return repository.CommandReceipt{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"persistence.get_command_receipt",
				"outcome",
				"accepted receipt does not contain one canonical event result",
			)
		}
	case repository.CommandReceiptOutcomeRejected:
		if model.EventID != "" || len(model.EventBytes) != 0 || model.RejectionCode == "" {
			return repository.CommandReceipt{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"persistence.get_command_receipt",
				"outcome",
				"rejected receipt does not contain one terminal rejection result",
			)
		}
	default:
		return repository.CommandReceipt{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.get_command_receipt",
			"outcome",
			"is not a recognized command result",
		)
	}
	return repository.CommandReceipt{
		ConversationID: valueobject.ConversationID(model.ConversationID),
		CommandID:      valueobject.CommandID(model.CommandID),
		CommandHash:    hash,
		Outcome:        outcome,
		EventID:        valueobject.EventID(model.EventID),
		EventBytes:     append([]byte(nil), model.EventBytes...),
		RejectionCode:  conversationdomain.ErrorCode(model.RejectionCode),
		CreatedAt:      model.CreatedAt,
	}, nil
}

func (r *receiptRepository) Create(
	ctx context.Context,
	receipt repository.CommandReceipt,
) error {
	switch receipt.Outcome {
	case repository.CommandReceiptOutcomeAccepted:
		if receipt.EventID == "" || len(receipt.EventBytes) == 0 || receipt.RejectionCode != "" {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"persistence.create_command_receipt",
				"outcome",
				"accepted receipt requires only a canonical event result",
			)
		}
	case repository.CommandReceiptOutcomeRejected:
		if receipt.EventID != "" || len(receipt.EventBytes) != 0 || receipt.RejectionCode == "" {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"persistence.create_command_receipt",
				"outcome",
				"rejected receipt requires only a terminal rejection code",
			)
		}
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"persistence.create_command_receipt",
			"outcome",
			"is required",
		)
	}
	return r.db.WithContext(ctx).Create(&ConversationCommandReceiptModel{
		ConversationID: string(receipt.ConversationID),
		CommandID:      string(receipt.CommandID),
		CommandHash:    receipt.CommandHash.Bytes(),
		Outcome:        string(receipt.Outcome),
		EventID:        string(receipt.EventID),
		EventBytes:     append([]byte(nil), receipt.EventBytes...),
		RejectionCode:  string(receipt.RejectionCode),
		CreatedAt:      receipt.CreatedAt.UTC(),
	}).Error
}

type authorityPlanRepository struct {
	db *gorm.DB
}

func newAuthorityPlanRepository(db *gorm.DB) *authorityPlanRepository {
	return &authorityPlanRepository{db: db}
}

func (r *authorityPlanRepository) Create(
	ctx context.Context,
	plan entity.AuthorityPlan,
) error {
	model, err := authorityPlanModel(plan)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Create(&model).Error
}

func (r *authorityPlanRepository) LoadForUpdate(
	ctx context.Context,
	planID valueobject.PlanID,
) (entity.AuthorityPlan, error) {
	var model ConversationAuthorityPlanModel
	if err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "plan_id = ?", string(planID)).
		Error; err != nil {
		return entity.AuthorityPlan{}, persistenceError("load authority plan", err)
	}
	return authorityPlanFromModel(model)
}

func (r *authorityPlanRepository) Save(
	ctx context.Context,
	plan entity.AuthorityPlan,
) error {
	model, err := authorityPlanModel(plan)
	if err != nil {
		return err
	}
	result := r.db.WithContext(ctx).
		Model(&ConversationAuthorityPlanModel{}).
		Where("plan_id = ?", model.PlanID).
		Updates(map[string]any{
			"state":          model.State,
			"terminal_at":    model.TerminalAt,
			"snapshot_bytes": model.SnapshotBytes,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return notFound("save authority plan")
	}
	return nil
}

func authorityPlanModel(plan entity.AuthorityPlan) (ConversationAuthorityPlanModel, error) {
	snapshotBytes, err := json.Marshal(plan)
	if err != nil {
		return ConversationAuthorityPlanModel{}, fmt.Errorf(
			"conversation persistence: encode authority plan: %w",
			err,
		)
	}
	return ConversationAuthorityPlanModel{
		PlanID:            string(plan.ID),
		ConversationID:    string(plan.ConversationID),
		FederationID:      string(plan.FederationID),
		AuthorityEpoch:    uint64(plan.AuthorityEpoch),
		RequesterPTID:     string(plan.Requester.Actor),
		RequesterDeviceID: string(plan.Requester.Device),
		AuthoritySequence: uint64(plan.AuthorityHead.Sequence),
		AuthorityHash:     plan.AuthorityHead.EventHash.Bytes(),
		MembershipEpoch:   uint64(plan.AuthorityHead.MembershipEpoch),
		MLSEpoch:          uint64(plan.AuthorityHead.MLSEpoch),
		PlanHash:          plan.Hash.Bytes(),
		State:             string(plan.State),
		SnapshotBytes:     snapshotBytes,
		ExpiresAt:         plan.ExpiresAt.UTC(),
		TerminalAt:        plan.TerminalAt,
	}, nil
}

func authorityPlanFromModel(
	model ConversationAuthorityPlanModel,
) (entity.AuthorityPlan, error) {
	var plan entity.AuthorityPlan
	if err := json.Unmarshal(model.SnapshotBytes, &plan); err != nil {
		return entity.AuthorityPlan{}, fmt.Errorf(
			"conversation persistence: decode authority plan: %w",
			err,
		)
	}
	rehydrated, err := entity.RehydrateAuthorityPlan(plan)
	if err != nil {
		return entity.AuthorityPlan{}, err
	}
	if rehydrated.ID != valueobject.PlanID(model.PlanID) ||
		rehydrated.ConversationID != valueobject.ConversationID(model.ConversationID) ||
		rehydrated.FederationID != valueobject.FederationID(model.FederationID) ||
		rehydrated.AuthorityEpoch != valueobject.AuthorityEpoch(model.AuthorityEpoch) ||
		!bytes.Equal(rehydrated.Hash[:], model.PlanHash) {
		return entity.AuthorityPlan{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"persistence.decode_authority_plan",
			"plan",
			"indexed columns disagree with the plan snapshot",
		)
	}
	return *rehydrated, nil
}

type memberSettingsRepository struct {
	db *gorm.DB
}

func newMemberSettingsRepository(db *gorm.DB) *memberSettingsRepository {
	return &memberSettingsRepository{db: db}
}

func (r *memberSettingsRepository) Get(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) (repository.MemberSettings, error) {
	var model ConversationMemberSettingsModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND ptid = ?",
			string(conversationID),
			string(actor),
		).Error; err != nil {
		return repository.MemberSettings{}, persistenceError("get member settings", err)
	}
	return memberSettingsFromModel(model), nil
}

func (r *memberSettingsRepository) Save(
	ctx context.Context,
	settings repository.MemberSettings,
) error {
	model := ConversationMemberSettingsModel{
		ConversationID:  string(settings.ConversationID),
		PTID:            string(settings.Actor),
		Nickname:        settings.Nickname,
		Muted:           settings.Muted,
		Pinned:          settings.Pinned,
		AlertEnabled:    settings.AlertEnabled,
		Background:      settings.Background,
		BackgroundImage: settings.BackgroundImage,
		UpdatedAt:       settings.UpdatedAt.UTC(),
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "conversation_id"}, {Name: "ptid"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"nickname",
				"muted",
				"pinned",
				"alert_enabled",
				"background",
				"background_image",
				"updated_at",
			}),
		}).
		Create(&model).Error
}

func memberSettingsFromModel(model ConversationMemberSettingsModel) repository.MemberSettings {
	return repository.MemberSettings{
		ConversationID:  valueobject.ConversationID(model.ConversationID),
		Actor:           valueobject.PTID(model.PTID),
		Nickname:        model.Nickname,
		Muted:           model.Muted,
		Pinned:          model.Pinned,
		AlertEnabled:    model.AlertEnabled,
		Background:      model.Background,
		BackgroundImage: model.BackgroundImage,
		UpdatedAt:       model.UpdatedAt,
	}
}

type readCursorRepository struct {
	db *gorm.DB
}

func newReadCursorRepository(db *gorm.DB) *readCursorRepository {
	return &readCursorRepository{db: db}
}

func (r *readCursorRepository) Get(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
) (repository.ReadCursor, error) {
	var model ConversationReadCursorModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND ptid = ?",
			string(conversationID),
			string(actor),
		).Error; err != nil {
		return repository.ReadCursor{}, persistenceError("get read cursor", err)
	}
	return repository.ReadCursor{
		ConversationID: valueobject.ConversationID(model.ConversationID),
		Actor:          valueobject.PTID(model.PTID),
		Sequence:       valueobject.Sequence(model.Sequence),
		UpdatedAt:      model.UpdatedAt,
	}, nil
}

func (r *readCursorRepository) Advance(
	ctx context.Context,
	cursor repository.ReadCursor,
) (repository.ReadCursor, bool, error) {
	var current ConversationReadCursorModel
	err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(
			&current,
			"conversation_id = ? AND ptid = ?",
			string(cursor.ConversationID),
			string(cursor.Actor),
		).Error
	if err == nil && current.Sequence >= uint64(cursor.Sequence) {
		return repository.ReadCursor{
			ConversationID: cursor.ConversationID,
			Actor:          cursor.Actor,
			Sequence:       valueobject.Sequence(current.Sequence),
			UpdatedAt:      current.UpdatedAt,
		}, false, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return repository.ReadCursor{}, false, fmt.Errorf(
			"conversation persistence: lock read cursor: %w",
			err,
		)
	}
	model := ConversationReadCursorModel{
		ConversationID: string(cursor.ConversationID),
		PTID:           string(cursor.Actor),
		Sequence:       uint64(cursor.Sequence),
		UpdatedAt:      cursor.UpdatedAt.UTC(),
	}
	if err := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "conversation_id"}, {Name: "ptid"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"last_read_sequence",
				"updated_at",
			}),
		}).
		Create(&model).Error; err != nil {
		return repository.ReadCursor{}, false, err
	}
	return cursor, true, nil
}

type leaveIntentRepository struct {
	db *gorm.DB
}

func newLeaveIntentRepository(db *gorm.DB) *leaveIntentRepository {
	return &leaveIntentRepository{db: db}
}

func (r *leaveIntentRepository) Create(
	ctx context.Context,
	intent repository.LeaveIntent,
) (repository.LeaveIntent, error) {
	model := leaveIntentModel(intent)
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(model)
	if result.Error != nil {
		return repository.LeaveIntent{}, result.Error
	}
	if result.RowsAffected == 1 {
		return intent, nil
	}
	existing, err := r.LoadForUpdate(ctx, intent.ID)
	if err != nil {
		return repository.LeaveIntent{}, err
	}
	if existing.SameIdentity(intent) {
		return existing, nil
	}
	return repository.LeaveIntent{}, conversationdomain.NewError(
		conversationdomain.ErrorCodeCommandConflict,
		"persistence.create_leave_intent",
		"intent_id",
		"already belongs to different signed leave intent bytes",
	)
}

func (r *leaveIntentRepository) LoadForUpdate(
	ctx context.Context,
	intentID string,
) (repository.LeaveIntent, error) {
	var model ConversationLeaveIntentModel
	if err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "intent_id = ?", intentID).
		Error; err != nil {
		return repository.LeaveIntent{}, persistenceError("load leave intent", err)
	}
	return leaveIntentFromModel(model)
}

func (r *leaveIntentRepository) Save(
	ctx context.Context,
	intent repository.LeaveIntent,
) error {
	model := leaveIntentModel(intent)
	result := r.db.WithContext(ctx).
		Model(&ConversationLeaveIntentModel{}).
		Where("intent_id = ?", model.IntentID).
		Updates(map[string]any{
			"state":         model.State,
			"consumed_at":   model.ConsumedAt,
			"transition_id": model.TransitionID,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return notFound("save leave intent")
	}
	return nil
}

func (r *leaveIntentRepository) ListPending(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	excludedActor valueobject.PTID,
	limit int,
) ([]repository.LeaveIntent, error) {
	var models []ConversationLeaveIntentModel
	query := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND state = ? AND expires_at > ?",
			string(conversationID),
			string(repository.LeaveIntentStatePending),
			time.Now().UTC(),
		)
	if excludedActor != "" {
		query = query.Where("actor_ptid <> ?", string(excludedActor))
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Order("expires_at ASC").Find(&models).Error; err != nil {
		return nil, err
	}
	intents := make([]repository.LeaveIntent, 0, len(models))
	for _, model := range models {
		intent, err := leaveIntentFromModel(model)
		if err != nil {
			return nil, err
		}
		intents = append(intents, intent)
	}
	return intents, nil
}

type followerRepository struct {
	db     *gorm.DB
	sealer domainevent.Sealer
}

const maxBufferedFollowerEvents = 128

func newFollowerRepository(db *gorm.DB, sealer domainevent.Sealer) *followerRepository {
	return &followerRepository{db: db, sealer: sealer}
}

func (r *followerRepository) Get(
	ctx context.Context,
	conversationID valueobject.ConversationID,
) (repository.FollowerProjection, error) {
	var model ConversationFollowerHeadModel
	if err := r.db.WithContext(ctx).
		First(&model, "conversation_id = ?", string(conversationID)).
		Error; err != nil {
		return repository.FollowerProjection{}, persistenceError("get follower projection", err)
	}
	status, err := r.Status(ctx, conversationID)
	if err != nil {
		return repository.FollowerProjection{}, err
	}
	return followerFromModel(model, status)
}

func (r *followerRepository) ListByActor(
	ctx context.Context,
	actor valueobject.PTID,
) ([]repository.FollowerProjection, error) {
	var models []ConversationFollowerHeadModel
	if err := r.db.WithContext(ctx).
		Joins(
			"JOIN conversation_follower_members ON "+
				"conversation_follower_members.conversation_id = conversation_follower_heads.conversation_id",
		).
		Where(
			"conversation_follower_members.ptid = ? AND conversation_follower_members.status = ?",
			string(actor),
			string(valueobject.MemberStatusActive),
		).
		Order("conversation_follower_heads.updated_at DESC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	projections := make([]repository.FollowerProjection, 0, len(models))
	for _, model := range models {
		status, err := r.Status(ctx, valueobject.ConversationID(model.ConversationID))
		if err != nil {
			return nil, err
		}
		projection, err := followerFromModel(model, status)
		if err != nil {
			return nil, err
		}
		projections = append(projections, projection)
	}
	return projections, nil
}

func (r *followerRepository) ListByStatus(
	ctx context.Context,
	status repository.FollowerStatus,
	limit int,
) ([]repository.FollowerProjection, error) {
	if limit <= 0 {
		return []repository.FollowerProjection{}, nil
	}
	var models []ConversationFollowerHeadModel
	if err := r.db.WithContext(ctx).
		Joins(
			"JOIN conversation_follower_states ON "+
				"conversation_follower_states.conversation_id = conversation_follower_heads.conversation_id",
		).
		Where("conversation_follower_states.status = ?", string(status)).
		Order("conversation_follower_states.updated_at ASC").
		Limit(limit).
		Find(&models).Error; err != nil {
		return nil, persistenceError("list follower projections by status", err)
	}
	projections := make([]repository.FollowerProjection, 0, len(models))
	for _, model := range models {
		projection, err := followerFromModel(model, status)
		if err != nil {
			return nil, err
		}
		projections = append(projections, projection)
	}

	return projections, nil
}

func (r *followerRepository) Apply(
	ctx context.Context,
	projection repository.FollowerProjection,
	event domainevent.Record,
) error {
	verified, err := domainevent.Verify(event, r.sealer)
	if err != nil {
		return err
	}
	event = verified
	eventHead := authorityHeadFromEvent(event)
	if projection.Head != eventHead ||
		projection.Conversation.Head != eventHead ||
		projection.Conversation.ID != event.ConversationID ||
		projection.Conversation.AuthorityStation != event.AuthorityStation {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.apply_follower_event",
			"projection",
			"does not match the verified authority event head",
		)
	}
	var existing ConversationFollowerHeadModel
	err = r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&existing, "conversation_id = ?", string(event.ConversationID)).
		Error
	status, statusErr := r.Status(ctx, event.ConversationID)
	if statusErr != nil &&
		!conversationdomain.IsCode(statusErr, conversationdomain.ErrorCodeNotFound) {
		return statusErr
	}
	switch {
	case statusErr == nil && status == repository.FollowerStatusReadOnly:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.apply_follower_event",
			"projection",
			"requires an explicit resynchronization before applying more events",
		)
	case statusErr == nil && status == repository.FollowerStatusDegraded:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"persistence.apply_follower_event",
			"projection",
			"requires an explicit resynchronization before applying more events",
		)
	case err == nil &&
		status == repository.FollowerStatusResyncRequired &&
		existing.Sequence+1 != uint64(event.Sequence):
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"persistence.apply_follower_event",
			"projection",
			"is waiting for the next contiguous authority event",
		)
	case err == nil && existing.Sequence == uint64(event.Sequence):
		if existing.AuthorityStationPeerID == string(event.AuthorityStation) &&
			bytes.Equal(existing.EventHash, event.Hash[:]) {
			return nil
		}
		return r.markFollowerReadOnly(ctx, existing, "same sequence has a different event hash")
	case err == nil && uint64(event.Sequence) < existing.Sequence:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"persistence.apply_follower_event",
			"sequence",
			"is older than the durable follower head",
		)
	case err == nil && existing.Sequence+1 < uint64(event.Sequence):
		return r.markFollowerResyncRequired(ctx, existing, "authority event sequence has a gap")
	case err == nil && existing.AuthorityStationPeerID != string(event.AuthorityStation):
		return r.markFollowerReadOnly(ctx, existing, "authority Station changed without a handover")
	case err == nil && !bytes.Equal(existing.EventHash, event.PreviousHash[:]):
		return r.markFollowerReadOnly(ctx, existing, "authority event previous hash mismatch")
	case errors.Is(err, gorm.ErrRecordNotFound) && event.Sequence != 1:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"persistence.apply_follower_event",
			"sequence",
			"first follower event must be sequence one",
		)
	case err != nil && !errors.Is(err, gorm.ErrRecordNotFound):
		return err
	}
	snapshotBytes, err := json.Marshal(projection.Conversation)
	if err != nil {
		return err
	}
	model := ConversationFollowerHeadModel{
		ConversationID:         string(event.ConversationID),
		FederationID:           string(projection.Conversation.FederationID),
		AuthorityStationPeerID: string(event.AuthorityStation),
		AuthorityEpoch:         uint64(projection.Conversation.AuthorityEpoch),
		Sequence:               uint64(event.Sequence),
		EventHash:              event.Hash.Bytes(),
		MembershipEpoch:        uint64(event.MembershipEpoch),
		MLSEpoch:               uint64(event.MLSEpoch),
		SnapshotBytes:          snapshotBytes,
		UpdatedAt:              event.CommittedAt,
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		result := r.db.WithContext(ctx).
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&model)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var winner ConversationFollowerHeadModel
			if loadErr := r.db.WithContext(ctx).
				First(&winner, "conversation_id = ?", model.ConversationID).
				Error; loadErr != nil {
				return loadErr
			}
			if winner.Sequence == model.Sequence &&
				winner.AuthorityStationPeerID == model.AuthorityStationPeerID &&
				bytes.Equal(winner.EventHash, model.EventHash) {
				return nil
			}
			return r.markFollowerReadOnly(
				ctx,
				winner,
				"concurrent genesis committed a different authority event",
			)
		}
	} else if saveErr := r.db.WithContext(ctx).Save(&model).Error; saveErr != nil {
		return saveErr
	}
	if err := r.SetStatus(
		ctx,
		event.ConversationID,
		repository.FollowerStatusActive,
	); err != nil {
		return err
	}
	if err := r.db.WithContext(ctx).
		Where("conversation_id = ?", string(event.ConversationID)).
		Delete(&ConversationFollowerMemberModel{}).Error; err != nil {
		return err
	}
	members := make([]ConversationFollowerMemberModel, 0, len(projection.Conversation.Members))
	for _, member := range projection.Conversation.Members {
		members = append(members, ConversationFollowerMemberModel{
			ConversationID: string(event.ConversationID),
			PTID:           string(member.Actor),
			Status:         string(member.Status),
		})
	}
	if len(members) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(&members).Error
}

func (r *followerRepository) Buffer(
	ctx context.Context,
	event domainevent.Record,
) error {
	verified, err := domainevent.Verify(event, r.sealer)
	if err != nil {
		return err
	}
	snapshot := verified.Clone()
	snapshot.EncodedBytes = nil
	domainSnapshot, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("conversation persistence: encode buffered follower event: %w", err)
	}
	model := ConversationFollowerPendingEventModel{
		ConversationID: string(verified.ConversationID),
		Sequence:       uint64(verified.Sequence),
		EventID:        string(verified.ID),
		EventHash:      verified.Hash.Bytes(),
		HashScheme:     string(verified.HashScheme),
		EventBytes:     verified.Bytes(),
		DomainSnapshot: domainSnapshot,
		ReceivedAt:     time.Now().UTC(),
	}
	existing, exists, err := r.findBufferedEvent(ctx, model)
	if err != nil {
		return err
	}
	if exists {
		return r.resolveBufferedEvent(ctx, model, existing)
	}

	var count int64
	if err := r.db.WithContext(ctx).
		Model(&ConversationFollowerPendingEventModel{}).
		Where("conversation_id = ?", model.ConversationID).
		Count(&count).Error; err != nil {
		return err
	}
	if count >= maxBufferedFollowerEvents {
		if markErr := r.SetStatus(
			ctx,
			verified.ConversationID,
			repository.FollowerStatusReadOnly,
		); markErr != nil {
			return markErr
		}
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.buffer_follower_event",
			"buffer",
			"exceeded the bounded follower event capacity",
		)
	}
	result := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	existing, exists, err = r.findBufferedEvent(ctx, model)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf(
			"conversation persistence: buffered follower event conflict was not readable",
		)
	}
	return r.resolveBufferedEvent(ctx, model, existing)
}

func (r *followerRepository) findBufferedEvent(
	ctx context.Context,
	candidate ConversationFollowerPendingEventModel,
) (ConversationFollowerPendingEventModel, bool, error) {
	var existing ConversationFollowerPendingEventModel
	err := r.db.WithContext(ctx).
		Where(
			"(conversation_id = ? AND sequence = ?) OR event_id = ?",
			candidate.ConversationID,
			candidate.Sequence,
			candidate.EventID,
		).
		First(&existing).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ConversationFollowerPendingEventModel{}, false, nil
	}
	if err != nil {
		return ConversationFollowerPendingEventModel{}, false, err
	}
	return existing, true, nil
}

func (r *followerRepository) resolveBufferedEvent(
	ctx context.Context,
	candidate ConversationFollowerPendingEventModel,
	existing ConversationFollowerPendingEventModel,
) error {
	if existing.ConversationID == candidate.ConversationID &&
		existing.Sequence == candidate.Sequence &&
		existing.EventID == candidate.EventID &&
		existing.HashScheme == candidate.HashScheme &&
		bytes.Equal(existing.EventHash, candidate.EventHash) &&
		bytes.Equal(existing.EventBytes, candidate.EventBytes) &&
		bytes.Equal(existing.DomainSnapshot, candidate.DomainSnapshot) {
		return nil
	}
	if err := r.SetStatus(
		ctx,
		valueobject.ConversationID(candidate.ConversationID),
		repository.FollowerStatusReadOnly,
	); err != nil {
		return err
	}
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"persistence.buffer_follower_event",
		"event",
		"same sequence has conflicting buffered event bytes",
	)
}

func (r *followerRepository) NextBuffered(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	after valueobject.Sequence,
) (domainevent.Record, error) {
	var model ConversationFollowerPendingEventModel
	if err := r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND sequence > ?",
			string(conversationID),
			uint64(after),
		).
		Order("sequence ASC").
		First(&model).
		Error; err != nil {
		return domainevent.Record{}, persistenceError("get buffered follower event", err)
	}
	return r.decodeBufferedEvent(model)
}

func (r *followerRepository) GetBuffered(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	sequence valueobject.Sequence,
) (domainevent.Record, error) {
	var model ConversationFollowerPendingEventModel
	if err := r.db.WithContext(ctx).
		First(
			&model,
			"conversation_id = ? AND sequence = ?",
			string(conversationID),
			uint64(sequence),
		).
		Error; err != nil {
		return domainevent.Record{}, persistenceError("get buffered follower event", err)
	}
	return r.decodeBufferedEvent(model)
}

func (r *followerRepository) decodeBufferedEvent(
	model ConversationFollowerPendingEventModel,
) (domainevent.Record, error) {
	var event domainevent.Record
	if err := json.Unmarshal(model.DomainSnapshot, &event); err != nil {
		return domainevent.Record{}, fmt.Errorf(
			"conversation persistence: decode buffered follower event: %w",
			err,
		)
	}
	event.HashScheme = domainevent.HashScheme(model.HashScheme)
	event.EncodedBytes = append([]byte(nil), model.EventBytes...)
	verified, err := domainevent.Verify(event, r.sealer)
	if err != nil {
		return domainevent.Record{}, err
	}
	if verified.ConversationID != valueobject.ConversationID(model.ConversationID) ||
		verified.Sequence != valueobject.Sequence(model.Sequence) ||
		verified.ID != valueobject.EventID(model.EventID) ||
		!bytes.Equal(verified.Hash[:], model.EventHash) {
		return domainevent.Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_buffered_follower_event",
			"event",
			"indexed columns disagree with canonical event bytes",
		)
	}
	return verified, nil
}

func (r *followerRepository) DeleteBuffered(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	sequence valueobject.Sequence,
) error {
	return r.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND sequence = ?",
			string(conversationID),
			uint64(sequence),
		).
		Delete(&ConversationFollowerPendingEventModel{}).
		Error
}

func (r *followerRepository) SetStatus(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	status repository.FollowerStatus,
) error {
	switch status {
	case repository.FollowerStatusActive,
		repository.FollowerStatusResyncRequired,
		repository.FollowerStatusDegraded,
		repository.FollowerStatusReadOnly:
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"persistence.set_follower_status",
			"status",
			"is not supported",
		)
	}
	var existing ConversationFollowerStateModel
	err := r.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&existing, "conversation_id = ?", string(conversationID)).
		Error
	if err == nil &&
		existing.Status == string(repository.FollowerStatusReadOnly) &&
		status != repository.FollowerStatusReadOnly {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.set_follower_status",
			"status",
			"read-only follower protection requires explicit resynchronization",
		)
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return r.db.WithContext(ctx).Save(&ConversationFollowerStateModel{
		ConversationID: string(conversationID),
		Status:         string(status),
		UpdatedAt:      time.Now().UTC(),
	}).Error
}

func (r *followerRepository) Status(
	ctx context.Context,
	conversationID valueobject.ConversationID,
) (repository.FollowerStatus, error) {
	var model ConversationFollowerStateModel
	if err := r.db.WithContext(ctx).
		First(&model, "conversation_id = ?", string(conversationID)).
		Error; err != nil {
		return "", persistenceError("get follower status", err)
	}
	return repository.FollowerStatus(model.Status), nil
}

func authorityHeadFromEvent(event domainevent.Record) valueobject.AuthorityHead {
	return valueobject.AuthorityHead{
		Sequence:        event.Sequence,
		EventHash:       event.Hash,
		MembershipEpoch: event.MembershipEpoch,
		MLSEpoch:        event.MLSEpoch,
	}
}

func (r *followerRepository) markFollowerReadOnly(
	ctx context.Context,
	model ConversationFollowerHeadModel,
	reason string,
) error {
	if err := r.SetStatus(
		ctx,
		valueobject.ConversationID(model.ConversationID),
		repository.FollowerStatusReadOnly,
	); err != nil {
		return err
	}
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"persistence.apply_follower_event",
		"event",
		reason,
	)
}

func (r *followerRepository) markFollowerResyncRequired(
	ctx context.Context,
	model ConversationFollowerHeadModel,
	reason string,
) error {
	if err := r.SetStatus(
		ctx,
		valueobject.ConversationID(model.ConversationID),
		repository.FollowerStatusResyncRequired,
	); err != nil {
		return err
	}
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeStaleAuthorityHead,
		"persistence.apply_follower_event",
		"event",
		reason,
	)
}

func followerFromModel(
	model ConversationFollowerHeadModel,
	status repository.FollowerStatus,
) (repository.FollowerProjection, error) {
	var snapshot aggregate.Snapshot
	if err := json.Unmarshal(model.SnapshotBytes, &snapshot); err != nil {
		return repository.FollowerProjection{}, err
	}
	if _, err := aggregate.Rehydrate(snapshot); err != nil {
		return repository.FollowerProjection{}, err
	}
	if snapshot.FederationID != valueobject.FederationID(model.FederationID) ||
		snapshot.AuthorityStation != valueobject.StationID(model.AuthorityStationPeerID) ||
		snapshot.AuthorityEpoch != valueobject.AuthorityEpoch(model.AuthorityEpoch) {
		return repository.FollowerProjection{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_follower",
			"authority_scope",
			"indexed authority scope disagrees with the canonical follower snapshot",
		)
	}
	hash, err := valueobject.NewHash(model.EventHash)
	if err != nil {
		return repository.FollowerProjection{}, err
	}
	indexedHead := valueobject.AuthorityHead{
		Sequence:        valueobject.Sequence(model.Sequence),
		EventHash:       hash,
		MembershipEpoch: valueobject.Epoch(model.MembershipEpoch),
		MLSEpoch:        valueobject.Epoch(model.MLSEpoch),
	}
	if snapshot.ID != valueobject.ConversationID(model.ConversationID) ||
		snapshot.Head != indexedHead {
		return repository.FollowerProjection{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"persistence.decode_follower",
			"authority_head",
			"indexed identity or head disagrees with the canonical follower snapshot",
		)
	}
	return repository.FollowerProjection{
		Conversation: snapshot,
		Head:         indexedHead,
		Status:       status,
		UpdatedAt:    model.UpdatedAt,
	}, nil
}

func conversationModelFromSnapshot(snapshot aggregate.Snapshot) ConversationModel {
	return ConversationModel{
		ConversationID:         string(snapshot.ID),
		Kind:                   string(snapshot.Kind),
		Status:                 string(snapshot.Status),
		FederationID:           string(snapshot.FederationID),
		AuthorityStationPeerID: string(snapshot.AuthorityStation),
		AuthorityEpoch:         uint64(snapshot.AuthorityEpoch),
		OwnerPTID:              string(snapshot.Owner),
		CurrentSequence:        uint64(snapshot.Head.Sequence),
		CurrentEventHash:       snapshot.Head.EventHash.Bytes(),
		MembershipEpoch:        uint64(snapshot.Head.MembershipEpoch),
		MLSEpoch:               uint64(snapshot.Head.MLSEpoch),
		Name:                   snapshot.Settings.Name,
		Description:            snapshot.Settings.Description,
		AvatarObjectID:         snapshot.Settings.AvatarObjectID,
		Visibility:             string(snapshot.Settings.Visibility),
		CreatedAt:              snapshot.CreatedAt.UTC(),
		UpdatedAt:              snapshot.UpdatedAt.UTC(),
	}
}

func leaveIntentModel(intent repository.LeaveIntent) *ConversationLeaveIntentModel {
	return &ConversationLeaveIntentModel{
		Version:           intent.Version,
		IntentID:          intent.ID,
		FederationID:      string(intent.FederationID),
		ConversationID:    string(intent.ConversationID),
		ActorPTID:         string(intent.Actor.Actor),
		ActorDeviceID:     string(intent.Actor.Device),
		ActorSigningKeyID: intent.SigningKeyID,
		HomeStation:       string(intent.HomeStation),
		AuthorityStation:  string(intent.AuthorityStation),
		AuthorityEpoch:    uint64(intent.AuthorityEpoch),
		AuthoritySequence: uint64(intent.AuthorityHead.Sequence),
		AuthorityHash:     intent.AuthorityHead.EventHash.Bytes(),
		MembershipEpoch:   uint64(intent.AuthorityHead.MembershipEpoch),
		MLSEpoch:          uint64(intent.AuthorityHead.MLSEpoch),
		SigningBytes:      append([]byte(nil), intent.SigningBytes...),
		Signature:         append([]byte(nil), intent.Signature...),
		State:             string(intent.State),
		CreatedAt:         intent.CreatedAt.UTC(),
		ExpiresAt:         intent.ExpiresAt.UTC(),
		ConsumedAt:        intent.ConsumedAt,
		TransitionID:      string(intent.TransitionID),
	}
}

func leaveIntentFromModel(
	model ConversationLeaveIntentModel,
) (repository.LeaveIntent, error) {
	hash, err := valueobject.NewHash(model.AuthorityHash)
	if err != nil {
		return repository.LeaveIntent{}, err
	}
	return repository.LeaveIntent{
		Version:        model.Version,
		ID:             model.IntentID,
		FederationID:   valueobject.FederationID(model.FederationID),
		ConversationID: valueobject.ConversationID(model.ConversationID),
		Actor: valueobject.Endpoint{
			Actor:  valueobject.PTID(model.ActorPTID),
			Device: valueobject.DeviceID(model.ActorDeviceID),
		},
		SigningKeyID:   model.ActorSigningKeyID,
		AuthorityEpoch: valueobject.AuthorityEpoch(model.AuthorityEpoch),
		AuthorityHead: valueobject.AuthorityHead{
			Sequence:        valueobject.Sequence(model.AuthoritySequence),
			EventHash:       hash,
			MembershipEpoch: valueobject.Epoch(model.MembershipEpoch),
			MLSEpoch:        valueobject.Epoch(model.MLSEpoch),
		},
		SigningBytes:     append([]byte(nil), model.SigningBytes...),
		Signature:        append([]byte(nil), model.Signature...),
		State:            repository.LeaveIntentState(model.State),
		CreatedAt:        model.CreatedAt,
		ExpiresAt:        model.ExpiresAt,
		ConsumedAt:       model.ConsumedAt,
		TransitionID:     valueobject.TransitionID(model.TransitionID),
		HomeStation:      valueobject.StationID(model.HomeStation),
		AuthorityStation: valueobject.StationID(model.AuthorityStation),
	}, nil
}

func persistedHash(value []byte, zeroAllowed bool) (valueobject.Hash, error) {
	if zeroAllowed && len(value) == 0 {
		return valueobject.Hash{}, nil
	}
	return valueobject.NewHash(value)
}

func optionalHash(hash valueobject.Hash) []byte {
	if hash.IsZero() {
		return nil
	}
	return hash.Bytes()
}

func persistenceError(operation string, err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFound(operation)
	}
	return fmt.Errorf("conversation persistence: %s: %w", operation, err)
}

func notFound(operation string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeNotFound,
		"persistence."+operation,
		"record",
		"was not found",
	)
}
