package aibox

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/store"
	"github.com/pgvector/pgvector-go"
)

// VectorService provides vector storage and search capabilities
type VectorService struct {
	store store.Store
}

// NewVectorService creates a new vector service
func NewVectorService(store store.Store) *VectorService {
	return &VectorService{store: store}
}

// CreateDocument creates a new document with vector embedding
func (vs *VectorService) CreateDocument(ctx context.Context, doc *Document) error {
	db, err := vs.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	doc.ID = generateID()
	doc.CreatedAt = time.Now()
	doc.UpdatedAt = time.Now()

	if err := db.Create(doc).Error; err != nil {
		return fmt.Errorf("failed to create document: %w", err)
	}

	logger.Logf(logger.InfoLevel, "Document created: id=%s, knowledge_base_id=%s", doc.ID, doc.KnowledgeBaseID)
	return nil
}

// SearchSimilarDocuments searches for similar documents using vector similarity
func (vs *VectorService) SearchSimilarDocuments(ctx context.Context, knowledgeBaseID string, embedding []float32, limit int) ([]*Document, error) {
	db, err := vs.store.RDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database from store: %w", err)
	}

	queryVector := pgvector.NewVector(embedding)

	var documents []*Document
	query := `
		SELECT *, (embedding <=> ?) as distance 
		FROM documents 
		WHERE knowledge_base_id = ? AND embedding IS NOT NULL
		ORDER BY embedding <=> ? 
		LIMIT ?
	`

	if err := db.Raw(query, queryVector, knowledgeBaseID, queryVector, limit).Scan(&documents).Error; err != nil {
		return nil, fmt.Errorf("failed to search similar documents: %w", err)
	}

	return documents, nil
}

// HybridSearch performs combined vector and full-text search
func (vs *VectorService) HybridSearch(ctx context.Context, knowledgeBaseID string, queryText string, embedding []float32, limit int) ([]*Document, error) {
	db, err := vs.store.RDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database from store: %w", err)
	}

	queryVector := pgvector.NewVector(embedding)

	var documents []*Document
	query := `
		SELECT d.*, 
			   (embedding <=> ?) as vector_score,
			   ts_rank(to_tsvector('english', d.content), plainto_tsquery(?)) as text_score,
			   ((embedding <=> ?) * 0.7 + ts_rank(to_tsvector('english', d.content), plainto_tsquery(?)) * 0.3) as combined_score
		FROM documents d
		WHERE d.knowledge_base_id = ? 
		  AND (embedding <=> ? < 0.8 OR to_tsvector('english', d.content) @@ plainto_tsquery(?))
		ORDER BY combined_score ASC
		LIMIT ?
	`

	if err := db.Raw(query, queryVector, queryText, queryVector, queryText, knowledgeBaseID, queryVector, queryText, limit).Scan(&documents).Error; err != nil {
		return nil, fmt.Errorf("failed to perform hybrid search: %w", err)
	}

	return documents, nil
}

// CreateKnowledgeBase creates a new knowledge base
func (vs *VectorService) CreateKnowledgeBase(ctx context.Context, kb *KnowledgeBase) error {
	db, err := vs.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	kb.ID = generateID()
	kb.CreatedAt = time.Now()
	kb.UpdatedAt = time.Now()

	if err := db.Create(kb).Error; err != nil {
		return fmt.Errorf("failed to create knowledge base: %w", err)
	}

	logger.Logf(logger.InfoLevel, "Knowledge base created: id=%s, name=%s", kb.ID, kb.Name)
	return nil
}

// ListKnowledgeBases lists all knowledge bases
func (vs *VectorService) ListKnowledgeBases(ctx context.Context, limit, offset int) ([]*KnowledgeBase, int64, error) {
	db, err := vs.store.RDS(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get database from store: %w", err)
	}

	var knowledgeBases []*KnowledgeBase
	var total int64

	query := db.Model(&KnowledgeBase{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count knowledge bases: %w", err)
	}

	if err := query.Limit(limit).Offset(offset).Find(&knowledgeBases).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list knowledge bases: %w", err)
	}

	return knowledgeBases, total, nil
}

// AssociateAgentWithKnowledgeBase associates an agent with a knowledge base
func (vs *VectorService) AssociateAgentWithKnowledgeBase(ctx context.Context, agentID, knowledgeBaseID string, priority int) error {
	db, err := vs.store.RDS(ctx)
	if err != nil {
		return fmt.Errorf("failed to get database from store: %w", err)
	}

	association := &AgentKnowledgeBase{
		AgentID:         agentID,
		KnowledgeBaseID: knowledgeBaseID,
		Priority:        priority,
		CreatedAt:       time.Now(),
	}

	if err := db.Create(association).Error; err != nil {
		return fmt.Errorf("failed to associate agent with knowledge base: %w", err)
	}

	logger.Logf(logger.InfoLevel, "Agent associated with knowledge base: agent_id=%s, kb_id=%s", agentID, knowledgeBaseID)
	return nil
}

// GetAgentKnowledgeBases gets knowledge bases associated with an agent
func (vs *VectorService) GetAgentKnowledgeBases(ctx context.Context, agentID string) ([]*KnowledgeBase, error) {
	db, err := vs.store.RDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database from store: %w", err)
	}

	var knowledgeBases []*KnowledgeBase
	query := `
		SELECT kb.*
		FROM knowledge_bases kb
		JOIN agent_knowledge_bases akb ON kb.id = akb.knowledge_base_id
		WHERE akb.agent_id = ? AND kb.is_active = true
		ORDER BY akb.priority DESC, kb.created_at DESC
	`

	if err := db.Raw(query, agentID).Scan(&knowledgeBases).Error; err != nil {
		return nil, fmt.Errorf("failed to get agent knowledge bases: %w", err)
	}

	return knowledgeBases, nil
}
