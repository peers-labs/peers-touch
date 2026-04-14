package group_chat

import (
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
	Deleted          bool
	Attachments      []domain.Attachment
	SentAt           time.Time
}

type member struct {
	GroupID   string
	ActorDID  string
	Role      int32
	Nickname  string
	Muted     bool
	JoinedAt  time.Time
	InvitedBy string
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
}

type offlineMessage struct {
	ID         string
	GroupID    string
	MessageID  string
	ReceiverID string
	CreatedAt  time.Time
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

func (s *service) ListGroups() []domain.Group {
	items := s.listGroups()
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
		})
	}
	for i := range messages {
		if atts, ok := m[messages[i].ID]; ok {
			messages[i].Attachments = atts
		}
	}
	return nil
}

func (s *service) SendMessage(groupID, senderDID string, messageType int32, content, replyToID string, attachments []domain.Attachment, encryptedPayload []byte) domain.Message {
	item := s.appendMessage(groupID, senderDID, messageType, content, replyToID, attachments, encryptedPayload)
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
			Attachments:      append([]domain.Attachment(nil), item.Attachments...),
			EncryptedPayload: enc,
			SentAt:           item.SentAt,
		})
	}
	if err := s.mergeGroupAttachmentsIntoDomainMessages(out); err != nil {
		return nil, err
	}
	return out, nil
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
	return &domain.Member{
		GroupID:   item.GroupID,
		ActorDID:  item.ActorDID,
		Role:      item.Role,
		Nickname:  item.Nickname,
		Muted:     item.Muted,
		JoinedAt:  item.JoinedAt,
		InvitedBy: item.InvitedBy,
	}, true
}

func (s *service) AddMember(groupID, actorDID, inviterDID string) (*domain.Member, bool) {
	item, ok := s.addMember(groupID, actorDID, inviterDID)
	if !ok {
		return nil, false
	}
	return &domain.Member{
		GroupID:   item.GroupID,
		ActorDID:  item.ActorDID,
		Role:      item.Role,
		Nickname:  item.Nickname,
		Muted:     item.Muted,
		JoinedAt:  item.JoinedAt,
		InvitedBy: item.InvitedBy,
	}, true
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
		out = append(out, domain.Member{
			GroupID:   item.GroupID,
			ActorDID:  item.ActorDID,
			Role:      item.Role,
			Nickname:  item.Nickname,
			Muted:     item.Muted,
			JoinedAt:  item.JoinedAt,
			InvitedBy: item.InvitedBy,
		})
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

func (s *service) RecallMessage(messageID string) bool {
	return s.recallMessage(messageID)
}

func (s *service) DeleteMessage(messageID string) bool {
	return s.deleteMessage(messageID)
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
			Attachments:      append([]domain.Attachment(nil), item.Attachments...),
			EncryptedPayload: enc,
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
	return &domain.Member{
		GroupID:   item.GroupID,
		ActorDID:  item.ActorDID,
		Role:      item.Role,
		Nickname:  item.Nickname,
		Muted:     item.Muted,
		JoinedAt:  item.JoinedAt,
		InvitedBy: item.InvitedBy,
	}, true
}

func (s *service) GetSettings(groupID, actorDID string) domain.GroupSetting {
	item := s.getSettings(groupID, actorDID)
	return domain.GroupSetting{
		IsMuted:            item.IsMuted,
		IsPinned:           item.IsPinned,
		ShowMemberNickname: item.ShowMemberNickname,
	}
}

func (s *service) UpdateSettings(groupID, actorDID string, muted, pinned, showNickname *bool) {
	s.updateSettings(groupID, actorDID, muted, pinned, showNickname)
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
		s.members[item.GroupULID][item.ActorDID] = &member{
			GroupID:   item.GroupULID,
			ActorDID:  item.ActorDID,
			Role:      item.Role,
			Nickname:  item.Nickname,
			Muted:     item.Muted,
			JoinedAt:  item.JoinedAt,
			InvitedBy: item.InvitedBy,
		}
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
			Deleted:          item.Deleted,
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
				Role:      1,
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
		Role:     1,
		JoinedAt: now,
	}
	if s.unread == nil {
		s.unread = make(map[string]map[string]int64)
	}
	s.unread[item.ID] = make(map[string]int64)
	return item
}

func (s *service) listGroups() []group {
	if s.db != nil {
		var rows []groupModel
		if err := s.db.Order("updated_at DESC").Find(&rows).Error; err == nil {
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
	out := make([]group, 0, len(s.groups))
	for _, item := range s.groups {
		out = append(out, *item)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

func (s *service) appendMessage(groupID, senderDID string, messageType int32, content, replyToID string, attachments []domain.Attachment, encryptedPayload []byte) message {
	if s.db != nil {
		now := time.Now()
		var enc []byte
		if len(encryptedPayload) > 0 {
			enc = append([]byte(nil), encryptedPayload...)
		}
		item := message{
			ID:               fmt.Sprintf("gcm-%d", now.UnixNano()),
			GroupID:          groupID,
			SenderDID:        senderDID,
			Type:             messageType,
			Content:          content,
			EncryptedPayload: enc,
			ReplyToID:        replyToID,
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
				Deleted:          false,
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
	item := message{
		ID:               fmt.Sprintf("gcm-%d", now.UnixNano()),
		GroupID:          groupID,
		SenderDID:        senderDID,
		Type:             messageType,
		Content:          content,
		EncryptedPayload: enc,
		ReplyToID:        replyToID,
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
						Deleted:          row.Deleted,
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
					Deleted:          rows[i].Deleted,
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
			return &member{
				GroupID:   row.GroupULID,
				ActorDID:  row.ActorDID,
				Role:      row.Role,
				Nickname:  row.Nickname,
				Muted:     row.Muted,
				JoinedAt:  row.JoinedAt,
				InvitedBy: row.InvitedBy,
			}, true
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
			Role:      3,
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
		Role:      3,
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
					out = append(out, member{
						GroupID:   row.GroupULID,
						ActorDID:  row.ActorDID,
						Role:      row.Role,
						Nickname:  row.Nickname,
						Muted:     row.Muted,
						JoinedAt:  row.JoinedAt,
						InvitedBy: row.InvitedBy,
					})
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

func (s *service) recallMessage(messageID string) bool {
	if s.db != nil {
		return s.db.Model(&messageModel{}).Where("ulid = ?", messageID).Updates(map[string]interface{}{
			"deleted":           true,
			"content":           "",
			"encrypted_payload": nil,
			"updated_at":        time.Now(),
		}).Error == nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	msg, ok := s.messagesByID[messageID]
	if !ok {
		return false
	}
	msg.Deleted = true
	msg.Content = ""
	msg.EncryptedPayload = nil
	s.messagesByID[messageID] = msg
	items := s.messages[msg.GroupID]
	for i := range items {
		if items[i].ID == messageID {
			items[i].Deleted = true
			items[i].Content = ""
			items[i].EncryptedPayload = nil
		}
	}
	s.messages[msg.GroupID] = items
	return true
}

func (s *service) deleteMessage(messageID string) bool {
	if s.db != nil {
		err := s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("message_ulid = ?", messageID).Delete(&MessageAttachmentModel{}).Error; err != nil {
				return err
			}
			return tx.Where("ulid = ?", messageID).Delete(&messageModel{}).Error
		})
		return err == nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	msg, ok := s.messagesByID[messageID]
	if !ok {
		return false
	}
	items := s.messages[msg.GroupID]
	out := make([]message, 0, len(items))
	for _, item := range items {
		if item.ID == messageID {
			continue
		}
		out = append(out, item)
	}
	s.messages[msg.GroupID] = out
	delete(s.messagesByID, messageID)
	return true
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
					Deleted:          row.Deleted,
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
			}
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.settings[groupID] == nil {
		return groupSetting{}
	}
	return s.settings[groupID][actorDID]
}

func (s *service) updateSettings(groupID, actorDID string, muted, pinned, showNickname *bool) {
	if s.db != nil {
		var row settingModel
		err := s.db.Where("group_ulid = ? AND actor_did = ?", groupID, actorDID).First(&row).Error
		now := time.Now()
		if err != nil {
			item := groupSetting{}
			if muted != nil {
				item.IsMuted = *muted
			}
			if pinned != nil {
				item.IsPinned = *pinned
			}
			if showNickname != nil {
				item.ShowMemberNickname = *showNickname
			}
			_ = s.db.Create(&settingModel{
				GroupULID:          groupID,
				ActorDID:           actorDID,
				IsMuted:            item.IsMuted,
				IsPinned:           item.IsPinned,
				ShowMemberNickname: item.ShowMemberNickname,
				CreatedAt:          now,
				UpdatedAt:          now,
			}).Error
			return
		}
		updates := map[string]interface{}{"updated_at": now}
		if muted != nil {
			updates["is_muted"] = *muted
		}
		if pinned != nil {
			updates["is_pinned"] = *pinned
		}
		if showNickname != nil {
			updates["show_member_nickname"] = *showNickname
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
	item := s.settings[groupID][actorDID]
	if muted != nil {
		item.IsMuted = *muted
	}
	if pinned != nil {
		item.IsPinned = *pinned
	}
	if showNickname != nil {
		item.ShowMemberNickname = *showNickname
	}
	s.settings[groupID][actorDID] = item
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
