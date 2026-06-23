package group_chat

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"gorm.io/gorm"
)

type group struct {
	ID          string
	Name        string
	Description string
	OwnerDID    string
	MemberCount int32
	CreatedAt   time.Time
	UpdatedAt   time.Time
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

type member struct {
	GroupID    string
	ActorDID   string
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
		Role:       item.Role,
		Nickname:   item.Nickname,
		Muted:      item.Muted,
		MutedUntil: item.MutedUntil,
		JoinedAt:   item.JoinedAt,
		InvitedBy:  item.InvitedBy,
	}
}

type invitation struct {
	ID         string
	GroupID    string
	InviterDID string
	InviteeDID string
	Status     int32
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

type service struct {
	mu           sync.RWMutex
	db           *gorm.DB
	groups       map[string]*group
	messages     map[string][]message
	messagesByID map[string]message
	members      map[string]map[string]*member
	invitations  map[string]*invitation
	settings     map[string]map[string]groupSetting
	offline      map[string][]offlineMessage
	unread       map[string]map[string]int64
	threadReads  map[string]threadRead
}

func (s *service) CreateGroup(ownerDID, name, description string) domain.Group {
	item := s.createGroup(ownerDID, name, description)
	return domain.Group{
		ID:          item.ID,
		Name:        item.Name,
		Description: item.Description,
		OwnerDID:    item.OwnerDID,
		MemberCount: item.MemberCount,
		CreatedAt:   item.CreatedAt,
		UpdatedAt:   item.UpdatedAt,
	}
}

func (s *service) ListGroups(actorDID string) []domain.Group {
	items := s.listGroups(actorDID)
	out := make([]domain.Group, 0, len(items))
	for _, item := range items {
		out = append(out, domain.Group{
			ID:          item.ID,
			Name:        item.Name,
			Description: item.Description,
			OwnerDID:    item.OwnerDID,
			MemberCount: item.MemberCount,
			CreatedAt:   item.CreatedAt,
			UpdatedAt:   item.UpdatedAt,
		})
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
	return &domain.Group{
		ID:          item.ID,
		Name:        item.Name,
		Description: item.Description,
		OwnerDID:    item.OwnerDID,
		MemberCount: item.MemberCount,
		CreatedAt:   item.CreatedAt,
		UpdatedAt:   item.UpdatedAt,
	}, true
}

func (s *service) GetMember(groupID, actorDID string) (*domain.Member, bool) {
	item, ok := s.getMember(groupID, actorDID)
	if !ok {
		return nil, false
	}
	return memberToDomain(item), true
}

func (s *service) AddMember(groupID, actorDID, inviterDID string) (*domain.Member, bool) {
	item, ok := s.addMember(groupID, actorDID, inviterDID)
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

func (s *service) UpdateGroup(groupID string, name, description *string, muted *bool) (*domain.Group, bool) {
	item, ok := s.updateGroup(groupID, name, description, muted)
	if !ok {
		return nil, false
	}
	return &domain.Group{
		ID:          item.ID,
		Name:        item.Name,
		Description: item.Description,
		OwnerDID:    item.OwnerDID,
		MemberCount: item.MemberCount,
		CreatedAt:   item.CreatedAt,
		UpdatedAt:   item.UpdatedAt,
	}, true
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
		g := &group{
			ID:          item.ULID,
			Name:        item.Name,
			Description: item.Description,
			OwnerDID:    item.OwnerDID,
			MemberCount: item.MemberCount,
			CreatedAt:   item.CreatedAt,
			UpdatedAt:   item.UpdatedAt,
		}
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
			ID:          fmt.Sprintf("gcg-%d", now.UnixNano()),
			Name:        name,
			Description: description,
			OwnerDID:    ownerDID,
			MemberCount: 1,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		_ = s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&groupModel{
				ULID:        item.ID,
				Name:        item.Name,
				Description: item.Description,
				OwnerDID:    item.OwnerDID,
				MemberCount: item.MemberCount,
				CreatedAt:   item.CreatedAt,
				UpdatedAt:   item.UpdatedAt,
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
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", now.UnixNano()),
				EventType: "group.created",
				TargetID:  item.ID,
				Payload:   fmt.Sprintf(`{"owner_did":"%s"}`, ownerDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		})
		return item
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	item := &group{
		ID:          fmt.Sprintf("gcg-%d", now.UnixNano()),
		Name:        name,
		Description: description,
		OwnerDID:    ownerDID,
		MemberCount: 1,
		CreatedAt:   now,
		UpdatedAt:   now,
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
				out = append(out, group{
					ID:          row.ULID,
					Name:        row.Name,
					Description: row.Description,
					OwnerDID:    row.OwnerDID,
					MemberCount: row.MemberCount,
					CreatedAt:   row.CreatedAt,
					UpdatedAt:   row.UpdatedAt,
				})
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
			ID:               fmt.Sprintf("gcm-%d", now.UnixNano()),
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
		_ = s.db.Transaction(func(tx *gorm.DB) error {
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
					ULID:        fmt.Sprintf("gco-%d", time.Now().UnixNano()),
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
			return tx.Create(&outboxModel{
				EventID:   fmt.Sprintf("gce-%d", time.Now().UnixNano()),
				EventType: "group.message.appended",
				TargetID:  groupID,
				Payload:   fmt.Sprintf(`{"message_ulid":"%s","sender_did":"%s"}`, item.ID, senderDID),
				Status:    "pending",
				CreatedAt: now,
				UpdatedAt: now,
			}).Error
		})
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
		ID:               fmt.Sprintf("gcm-%d", now.UnixNano()),
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
				ID:         fmt.Sprintf("gco-%d", time.Now().UnixNano()),
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
		if err := query.Order("sent_at DESC").Limit(limit).Find(&rows).Error; err == nil {
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
			return &group{
				ID:          row.ULID,
				Name:        row.Name,
				Description: row.Description,
				OwnerDID:    row.OwnerDID,
				MemberCount: row.MemberCount,
				CreatedAt:   row.CreatedAt,
				UpdatedAt:   row.UpdatedAt,
			}, true
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
	if s.db != nil {
		now := time.Now()
		item := &member{
			GroupID:   groupID,
			ActorDID:  actorDID,
			Role:      domain.GroupRoleMember,
			JoinedAt:  now,
			InvitedBy: inviterDID,
		}
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
					GroupULID: groupID,
					ActorDID:  actorDID,
					Role:      item.Role,
					Nickname:  item.Nickname,
					Muted:     item.Muted,
					JoinedAt:  item.JoinedAt,
					InvitedBy: item.InvitedBy,
					CreatedAt: now,
					UpdatedAt: now,
				}).Error; err != nil {
					return err
				}
			}
			var count int64
			if err := tx.Model(&memberModel{}).Where("group_ulid = ?", groupID).Count(&count).Error; err != nil {
				return err
			}
			if err := tx.Model(&groupModel{}).Where("ulid = ?", groupID).Updates(map[string]interface{}{
				"member_count": int32(count),
				"updated_at":   now,
			}).Error; err != nil {
				return err
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
	}
	s.members[groupID][actorDID] = item
	s.groups[groupID].MemberCount = int32(len(s.members[groupID]))
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
			if err := tx.Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).Delete(&memberModel{}).Error; err != nil {
				return err
			}
			var count int64
			if err := tx.Model(&memberModel{}).Where("group_ulid = ?", groupID).Count(&count).Error; err != nil {
				return err
			}
			if err := tx.Model(&groupModel{}).Where("ulid = ?", groupID).Updates(map[string]interface{}{
				"member_count": int32(count),
				"updated_at":   now,
			}).Error; err != nil {
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
	delete(s.members[groupID], actorDID)
	if s.groups[groupID] != nil {
		s.groups[groupID].MemberCount = int32(len(s.members[groupID]))
		s.groups[groupID].UpdatedAt = time.Now()
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
		item := invitation{
			ID:         fmt.Sprintf("gci-%d", now.UnixNano()),
			GroupID:    groupID,
			InviterDID: inviterDID,
			InviteeDID: inviteeDID,
			Status:     1,
			CreatedAt:  now,
		}
		_ = s.db.Create(&invitationModel{
			ULID:       item.ID,
			GroupULID:  item.GroupID,
			InviterDID: item.InviterDID,
			InviteeDID: item.InviteeDID,
			Status:     item.Status,
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
	item := invitation{
		ID:         fmt.Sprintf("gci-%d", now.UnixNano()),
		GroupID:    groupID,
		InviterDID: inviterDID,
		InviteeDID: inviteeDID,
		Status:     1,
		CreatedAt:  now,
	}
	s.invitations[item.ID] = &item
	return item
}

func (s *service) acceptInvitation(invitationID, actorDID string) (string, bool) {
	if s.db != nil {
		var row invitationModel
		if err := s.db.Where("ulid = ? AND invitee_did = ?", invitationID, actorDID).First(&row).Error; err != nil {
			return "", false
		}
		_ = s.db.Model(&invitationModel{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
			"status":     2,
			"updated_at": time.Now(),
		}).Error
		return row.GroupULID, true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.invitations[invitationID]
	if item == nil || item.InviteeDID != actorDID {
		return "", false
	}
	item.Status = 2
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
