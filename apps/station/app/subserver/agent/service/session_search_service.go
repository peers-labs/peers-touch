package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const (
	sessionSearchMaxResults    = 5
	sessionSearchContextWindow = 3 // messages before and after match
	sessionSearchMaxContentLen = 500
)

type SessionSearchResult struct {
	ConversationID string    `json:"conversation_id"`
	Title          string    `json:"title"`
	MatchedContent string    `json:"matched_content"`
	Context        []string  `json:"context"`
	MatchedAt      time.Time `json:"matched_at"`
	MessageRole    string    `json:"message_role"`
}

type SessionSearchService struct{}

func NewSessionSearchService() *SessionSearchService {
	return &SessionSearchService{}
}

// Search performs a keyword search across all agent messages and returns
// matching results grouped by conversation, with surrounding context.
func (s *SessionSearchService) Search(
	ctx context.Context,
	agentID, query string,
	maxResults int,
) ([]SessionSearchResult, error) {
	if query == "" {
		return nil, fmt.Errorf("search query cannot be empty")
	}
	if maxResults <= 0 || maxResults > sessionSearchMaxResults {
		maxResults = sessionSearchMaxResults
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	keywords := strings.Fields(strings.ToLower(query))
	if len(keywords) == 0 {
		return nil, fmt.Errorf("search query must contain at least one keyword")
	}

	// Build LIKE conditions for each keyword.
	tx := db.WithContext(ctx).
		Model(&persistence.AgentMessage{}).
		Joins("JOIN agent_conversations ON agent_conversations.id = agent_messages.conversation_id").
		Where("agent_conversations.agent_id = ?", agentID).
		Where("agent_messages.role IN ('user', 'assistant')").
		Where("agent_messages.content IS NOT NULL")

	for _, kw := range keywords {
		tx = tx.Where("LOWER(agent_messages.content) LIKE ?", "%"+kw+"%")
	}

	var matches []struct {
		MessageID      string    `gorm:"column:id"`
		ConversationID string    `gorm:"column:conversation_id"`
		Content        *string   `gorm:"column:content"`
		Role           string    `gorm:"column:role"`
		CreatedAt      time.Time `gorm:"column:created_at"`
	}

	if queryErr := tx.
		Select("agent_messages.id, agent_messages.conversation_id, agent_messages.content, agent_messages.role, agent_messages.created_at").
		Order("agent_messages.created_at DESC").
		Limit(maxResults * 3). // over-fetch then deduplicate by conversation
		Find(&matches).Error; queryErr != nil {
		return nil, fmt.Errorf("session search query failed: %w", queryErr)
	}

	// Deduplicate by conversation (take first match per conversation).
	seen := make(map[string]bool)
	var results []SessionSearchResult

	for _, m := range matches {
		if seen[m.ConversationID] || len(results) >= maxResults {
			continue
		}
		seen[m.ConversationID] = true

		content := ""
		if m.Content != nil {
			content = *m.Content
		}
		if len(content) > sessionSearchMaxContentLen {
			content = content[:sessionSearchMaxContentLen] + "..."
		}

		var conv persistence.Conversation
		db.WithContext(ctx).Where("id = ?", m.ConversationID).First(&conv)

		contextMsgs := s.loadContext(ctx, db, m.ConversationID, m.CreatedAt)

		// Follow compression pedigree: if the conversation has a parent,
		// include the parent's title for lineage awareness.
		title := conv.Title
		if conv.ParentID != nil && *conv.ParentID != "" {
			var parent persistence.Conversation
			if parentErr := db.WithContext(ctx).Where("id = ?", *conv.ParentID).First(&parent).Error; parentErr == nil {
				title = fmt.Sprintf("%s (continued from: %s)", conv.Title, parent.Title)
			}
		}

		results = append(results, SessionSearchResult{
			ConversationID: m.ConversationID,
			Title:          title,
			MatchedContent: content,
			Context:        contextMsgs,
			MatchedAt:      m.CreatedAt,
			MessageRole:    m.Role,
		})
	}

	logger.Infof(ctx, "session_search: agent_id=%s query=%q results=%d", agentID, query, len(results))
	return results, nil
}

// loadContext returns messages surrounding the match time in the same conversation.
func (s *SessionSearchService) loadContext(
	ctx context.Context,
	db *gorm.DB,
	conversationID string,
	matchTime time.Time,
) []string {
	var contextMessages []persistence.AgentMessage
	db.WithContext(ctx).
		Where("conversation_id = ? AND role IN ('user', 'assistant') AND content IS NOT NULL", conversationID).
		Order("created_at ASC").
		Find(&contextMessages)

	// Find the index of the matched message.
	matchIdx := -1
	for i, msg := range contextMessages {
		if !msg.CreatedAt.After(matchTime) {
			matchIdx = i
		}
	}

	if matchIdx < 0 {
		return nil
	}

	start := matchIdx - sessionSearchContextWindow
	if start < 0 {
		start = 0
	}
	end := matchIdx + sessionSearchContextWindow + 1
	if end > len(contextMessages) {
		end = len(contextMessages)
	}

	var lines []string
	for _, msg := range contextMessages[start:end] {
		content := ""
		if msg.Content != nil {
			content = *msg.Content
		}
		if len(content) > sessionSearchMaxContentLen {
			content = content[:sessionSearchMaxContentLen] + "..."
		}
		lines = append(lines, fmt.Sprintf("[%s] %s", msg.Role, content))
	}

	return lines
}

// FormatResults renders search results as a human-readable string for tool output.
func FormatSearchResults(results []SessionSearchResult) string {
	if len(results) == 0 {
		return "No matching sessions found."
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Found %d matching session(s):\n\n", len(results)))

	for i, r := range results {
		sb.WriteString(fmt.Sprintf("### %d. %s\n", i+1, r.Title))
		sb.WriteString(fmt.Sprintf("**Conversation**: %s\n", r.ConversationID))
		sb.WriteString(fmt.Sprintf("**Date**: %s\n", r.MatchedAt.Format("2006-01-02 15:04")))
		sb.WriteString(fmt.Sprintf("**Match** (%s): %s\n", r.MessageRole, r.MatchedContent))

		if len(r.Context) > 0 {
			sb.WriteString("\n**Context**:\n")
			for _, line := range r.Context {
				sb.WriteString(fmt.Sprintf("  %s\n", line))
			}
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

func (s *SessionSearchService) getDB(ctx context.Context) (*gorm.DB, error) {
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, fmt.Errorf("session_search: database unavailable: %w", err)
	}
	return db, nil
}

// RegisterSessionSearchTool registers the session_search tool in the tool registry.
func RegisterSessionSearchTool(registry *ToolRegistryService, svc *SessionSearchService) {
	schema := json.RawMessage(`{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search keywords to find in past conversation history"
    }
  },
  "required": ["query"]
}`)

	handler := func(ctx context.Context, meta *domain.ToolCallMeta, raw json.RawMessage) (*domain.ToolResult, error) {
		var args struct {
			Query string `json:"query"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return &domain.ToolResult{Content: fmt.Sprintf("invalid session_search arguments: %v", err), IsError: true}, nil
		}

		results, err := svc.Search(ctx, meta.AgentID, args.Query, sessionSearchMaxResults)
		if err != nil {
			return &domain.ToolResult{Content: fmt.Sprintf("session_search failed: %v", err), IsError: true}, nil
		}

		return &domain.ToolResult{Content: FormatSearchResults(results)}, nil
	}

	registry.Register(&domain.ToolDefinition{
		Name:        "session_search",
		Description: "Search past conversation history by keywords. Use when the user references past discussions or you need context from previous sessions.",
		JSONSchema:  schema,
		Handler:     handler,
	})
}
