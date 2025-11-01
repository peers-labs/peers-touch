package aibox

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// Service represents the AI box service
type Service struct {
	store            store.Store
	agents           map[string]*Agent
	providerRegistry *ProviderRegistry
	vectorService    *VectorService
	mu               sync.RWMutex
}

// NewService creates a new AI box service
func NewService(store store.Store) *Service {
	return &Service{
		store:            store,
		agents:           make(map[string]*Agent),
		providerRegistry: CreateDefaultProviderRegistry(),
		vectorService:    NewVectorService(store),
	}
}

// Initialize sets up the service
func (s *Service) Initialize(ctx context.Context) error {
	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	// Auto migrate database tables (LobeChat-like design)
	if err := db.AutoMigrate(
		&Agent{},
		&AgentConfiguration{},
		&Conversation{},
		&Message{},
		&AgentStats{},
		&KnowledgeBase{},
		&AgentKnowledgeBase{},
		&Document{},
		&Plugin{},
		&AgentPlugin{},
		&Model{},
		&User{},
		&UserAgent{},
	); err != nil {
		return fmt.Errorf("failed to migrate database: %w", err)
	}

	// Load active agents
	if err := s.loadAgents(ctx); err != nil {
		return fmt.Errorf("failed to load agents: %w", err)
	}

	// Note: models and plugins loading removed for MVP

	logger.Log(logger.InfoLevel, "AI box service initialized successfully")
	return nil
}

// Agent Management

// CreateAgent creates a new AI agent (LobeChat-like design)
func (s *Service) CreateAgent(ctx context.Context, agent *Agent) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	agent.ID = generateID()
	agent.CreatedAt = time.Now()
	agent.UpdatedAt = time.Now()

	if err := db.Create(agent).Error; err != nil {
		return fmt.Errorf("failed to create agent: %w", err)
	}

	s.agents[agent.ID] = agent

	logger.Logf(logger.InfoLevel, "Agent created: agent_id=%s, name=%s", agent.ID, agent.Name)
	return nil
}

// CreateAgentConfiguration creates agent configuration (LobeChat-like design)
func (s *Service) CreateAgentConfiguration(ctx context.Context, config *AgentConfiguration) error {
	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	config.CreatedAt = time.Now()
	config.UpdatedAt = time.Now()

	if err := db.Create(config).Error; err != nil {
		return fmt.Errorf("failed to create agent configuration: %w", err)
	}

	logger.Logf(logger.InfoLevel, "Agent configuration created: agent_id=%s, model=%s", config.AgentID, config.Model)
	return nil
}

// GetAgentConfiguration retrieves agent configuration
func (s *Service) GetAgentConfiguration(ctx context.Context, agentID string) (*AgentConfiguration, error) {
	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database from store: %w", err)
	}

	config := &AgentConfiguration{}
	if err := db.First(config, "agent_id = ?", agentID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("agent configuration not found: %s", agentID)
		}
		return nil, fmt.Errorf("failed to get agent configuration: %w", err)
	}

	return config, nil
}

// GetAgent retrieves an agent by ID
func (s *Service) GetAgent(ctx context.Context, agentID string) (*Agent, error) {
	s.mu.RLock()
	agent, exists := s.agents[agentID]
	s.mu.RUnlock()

	if exists {
		return agent, nil
	}

	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database from store: %w", err)
	}

	// Load from database
	agent = &Agent{}
	if err := db.First(agent, "id = ?", agentID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("agent not found: %s", agentID)
		}
		return nil, fmt.Errorf("failed to get agent: %w", err)
	}

	s.mu.Lock()
	s.agents[agentID] = agent
	s.mu.Unlock()

	return agent, nil
}

// ListAgents returns all agents
func (s *Service) ListAgents(ctx context.Context, limit, offset int) ([]*Agent, int64, error) {
	var agents []*Agent
	var total int64

	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get database from store: %w", err)
	}

	query := db.Model(&Agent{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count agents: %w", err)
	}

	if err := query.Limit(limit).Offset(offset).Find(&agents).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list agents: %w", err)
	}

	return agents, total, nil
}

// UpdateAgent updates an existing agent (simplified version for MVP)
func (s *Service) UpdateAgent(ctx context.Context, agentID string, updates map[string]interface{}) error {
	return fmt.Errorf("update agent not implemented in MVP")
}

// DeleteAgent deletes an agent (simplified version for MVP)
func (s *Service) DeleteAgent(ctx context.Context, agentID string) error {
	return fmt.Errorf("delete agent not implemented in MVP")
}

// Conversation Management

// CreateConversation creates a new conversation
func (s *Service) CreateConversation(ctx context.Context, conversation *Conversation) error {
	conversation.ID = generateID()
	conversation.CreatedAt = time.Now()
	conversation.UpdatedAt = time.Now()

	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	if err := db.Create(conversation).Error; err != nil {
		return fmt.Errorf("failed to create conversation: %w", err)
	}

	// Note: Agent stats removed for MVP

	logger.Logf(logger.InfoLevel, "Conversation created: conversation_id=%s, agent_id=%s", conversation.ID, conversation.AgentID)
	return nil
}

// GetConversation retrieves a conversation by ID
func (s *Service) GetConversation(ctx context.Context, conversationID string) (*Conversation, error) {
	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database from store: %w", err)
	}

	conversation := &Conversation{}
	if err := db.First(conversation, "id = ?", conversationID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("conversation not found: %s", conversationID)
		}
		return nil, fmt.Errorf("failed to get conversation: %w", err)
	}

	return conversation, nil
}

// ListConversations returns conversations for an agent
func (s *Service) ListConversations(ctx context.Context, agentID string, limit, offset int) ([]*Conversation, int64, error) {
	var conversations []*Conversation
	var total int64

	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get database from store: %w", err)
	}

	query := db.Model(&Conversation{}).Where("agent_id = ?", agentID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count conversations: %w", err)
	}

	if err := query.Order("updated_at DESC").Limit(limit).Offset(offset).Find(&conversations).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list conversations: %w", err)
	}

	return conversations, total, nil
}

// Chat sends a message and gets a response (LobeChat-like design)
func (s *Service) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	// Get agent
	agent, err := s.GetAgent(ctx, req.AgentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get agent: %w", err)
	}

	if !agent.IsActive {
		return nil, fmt.Errorf("agent is not active: %s", req.AgentID)
	}

	// Get agent configuration
	config, err := s.GetAgentConfiguration(ctx, req.AgentID)
	if err != nil {
		return nil, fmt.Errorf("failed to get agent configuration: %w", err)
	}

	// Get or create conversation
	var conversation *Conversation
	if req.ConversationID != "" {
		conversation, err = s.GetConversation(ctx, req.ConversationID)
		if err != nil {
			return nil, fmt.Errorf("failed to get conversation: %w", err)
		}
	} else {
		conversation = &Conversation{
			AgentID: req.AgentID,
			Title:   generateConversationTitle(req.Message),
		}
		if err := s.CreateConversation(ctx, conversation); err != nil {
			return nil, fmt.Errorf("failed to create conversation: %w", err)
		}
	}

	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database from store: %w", err)
	}

	// Save user message
	userMessage := &Message{
		ConversationID: conversation.ID,
		Role:           "user",
		Content:        req.Message,
		Model:          config.Model,
		CreatedAt:      time.Now(),
	}
	if err := db.Create(userMessage).Error; err != nil {
		logger.Logf(logger.WarnLevel, "failed to save user message: %v", err)
	}

	// Get provider and generate response
	provider, err := s.providerRegistry.Get(config.Provider)
	if err != nil {
		return nil, fmt.Errorf("failed to get provider: %w", err)
	}

	// Create enhanced agent with configuration
	enhancedAgent := &Agent{
		ID:          agent.ID,
		Name:        agent.Name,
		Description: agent.Description,
		IsActive:    agent.IsActive,
	}

	response, err := provider.GenerateResponse(ctx, req, enhancedAgent)
	if err != nil {
		return nil, fmt.Errorf("failed to generate response: %w", err)
	}

	// Save assistant message
	assistantMessage := &Message{
		ConversationID: conversation.ID,
		Role:           "assistant",
		Content:        response.Content,
		TokenCount:     response.TokenCount,
		Model:          response.Model,
		CreatedAt:      response.Timestamp,
	}
	if err := db.Create(assistantMessage).Error; err != nil {
		logger.Logf(logger.WarnLevel, "failed to save assistant message: %v", err)
	}

	// Update conversation timestamp
	if err := db.Model(conversation).Update("updated_at", time.Now()).Error; err != nil {
		logger.Logf(logger.WarnLevel, "failed to update conversation timestamp: %v", err)
	}

	return response, nil
}

// Helper functions

func (s *Service) loadAgents(ctx context.Context) error {
	// Get database connection from store
	db, err := s.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	var agents []*Agent
	if err := db.Find(&agents).Error; err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, agent := range agents {
		s.agents[agent.ID] = agent
	}

	return nil
}

// GetProviders returns all available providers
func (s *Service) GetProviders(ctx context.Context) []string {
	return s.providerRegistry.List()
}

// GetProviderInfo returns detailed information about a provider
func (s *Service) GetProviderInfo(ctx context.Context, providerName string) (*ProviderInfo, error) {
	return s.providerRegistry.GetProviderInfo(providerName)
}

// ListProviderInfos returns detailed information about all providers
func (s *Service) ListProviderInfos(ctx context.Context) []*ProviderInfo {
	return s.providerRegistry.ListProviderInfos()
}

// UpdateProviderConfig updates provider configuration
func (s *Service) UpdateProviderConfig(ctx context.Context, providerName string, config map[string]interface{}) error {
	return s.providerRegistry.UpdateProviderConfig(providerName, config)
}

// SetProviderEnabled sets provider enabled status
func (s *Service) SetProviderEnabled(ctx context.Context, providerName string, enabled bool) error {
	return s.providerRegistry.SetProviderEnabled(providerName, enabled)
}

// TestProviderConnection tests provider connection
func (s *Service) TestProviderConnection(ctx context.Context, providerName string) error {
	return s.providerRegistry.TestProviderConnection(providerName)
}

// Vector Service Delegation Methods

// CreateKnowledgeBase creates a new knowledge base
func (s *Service) CreateKnowledgeBase(ctx context.Context, kb *KnowledgeBase) error {
	return s.vectorService.CreateKnowledgeBase(ctx, kb)
}

// ListKnowledgeBases returns all knowledge bases
func (s *Service) ListKnowledgeBases(ctx context.Context, limit, offset int) ([]*KnowledgeBase, int64, error) {
	return s.vectorService.ListKnowledgeBases(ctx, limit, offset)
}

// AssociateAgentWithKnowledgeBase associates an agent with a knowledge base
func (s *Service) AssociateAgentWithKnowledgeBase(ctx context.Context, agentID, knowledgeBaseID string, priority int) error {
	return s.vectorService.AssociateAgentWithKnowledgeBase(ctx, agentID, knowledgeBaseID, priority)
}

// GetAgentKnowledgeBases gets knowledge bases associated with an agent
func (s *Service) GetAgentKnowledgeBases(ctx context.Context, agentID string) ([]*KnowledgeBase, error) {
	return s.vectorService.GetAgentKnowledgeBases(ctx, agentID)
}

// loadModels and loadPlugins removed for MVP
