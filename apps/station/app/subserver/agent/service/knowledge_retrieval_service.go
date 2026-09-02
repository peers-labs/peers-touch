package service

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/gorm"
)

const (
	knowledgeMaxResourceChars = 48000
	knowledgeChunkChars       = 1200
	knowledgeChunkOverlap     = 160
	knowledgeMaxChunks        = 6
	knowledgeEmbeddingDims    = 64
)

type KnowledgeRetrievalResult struct {
	PromptBlock string
	Chunks      []domain.KnowledgeChunkReference
}

type knowledgeChunk struct {
	ref     domain.KnowledgeChunkReference
	content string
	vector  []float64
	score   float64
}

type KnowledgeRetrievalService struct {
	embeddingProvider MemoryEmbeddingProvider
}

func NewKnowledgeRetrievalService(embeddingProvider MemoryEmbeddingProvider) *KnowledgeRetrievalService {
	if embeddingProvider == nil {
		embeddingProvider = NewHashMemoryEmbeddingProvider(knowledgeEmbeddingDims)
	}
	return &KnowledgeRetrievalService{
		embeddingProvider: embeddingProvider,
	}
}

func (s *KnowledgeRetrievalService) Retrieve(
	ctx context.Context,
	db *gorm.DB,
	authorized *AuthorizedCapabilitySet,
	query string,
) (*KnowledgeRetrievalResult, error) {
	if authorized == nil {
		return nil, capabilityStateError("authorized capability set is required for Knowledge retrieval", nil)
	}
	capabilities := authorized.Sources(
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE,
	)
	if len(capabilities) == 0 {
		return &KnowledgeRetrievalResult{}, nil
	}

	queryVector := s.embedText(ctx, query)
	var candidates []knowledgeChunk
	for _, capability := range capabilities {
		resource, content, err := loadAuthorizedKnowledgeResource(
			ctx,
			db,
			authorized,
			capability,
		)
		if err != nil {
			return nil, err
		}
		for _, chunk := range s.splitKnowledgeChunks(ctx, *resource, content) {
			chunk.score = cosineSimilarity(queryVector, chunk.vector) + keywordOverlapScore(query, chunk.content)
			candidates = append(candidates, chunk)
		}
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})
	if len(candidates) > knowledgeMaxChunks {
		candidates = candidates[:knowledgeMaxChunks]
	}

	chunks := make([]domain.KnowledgeChunkReference, 0, len(candidates))
	for i := range candidates {
		candidates[i].ref.Score = candidates[i].score
		chunks = append(chunks, candidates[i].ref)
	}

	return &KnowledgeRetrievalResult{
		PromptBlock: formatKnowledgePromptBlock(candidates),
		Chunks:      chunks,
	}, nil
}

func loadAuthorizedKnowledgeResource(
	ctx context.Context,
	db *gorm.DB,
	authorized *AuthorizedCapabilitySet,
	capability AuthorizedCapability,
) (*domain.KnowledgeResource, string, error) {
	if db == nil {
		return nil, "", capabilityStateError("database is required for Knowledge retrieval", nil)
	}
	revision, err := authorized.KnowledgeRevision(capability)
	if err != nil {
		return nil, "", err
	}
	resourceID := capability.Manifest.GetSourceInstanceId()
	var descriptor persistence.KnowledgeResourceRevision
	if err := db.WithContext(ctx).Where(
		"resource_id = ? AND revision = ? AND ptid = ?",
		resourceID,
		revision,
		authorized.ActorID,
	).First(&descriptor).Error; err != nil {
		return nil, "", capabilityStateError(
			"authorized Knowledge descriptor revision is unavailable",
			err,
		)
	}
	if descriptor.LocatorKind != "station" ||
		strings.TrimSpace(descriptor.StationContentRef) == "" ||
		model.KnowledgeResourceAvailability(descriptor.Availability) !=
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY {
		return nil, "", capabilityStateError(
			"authorized Knowledge descriptor is not immutable Station content",
			nil,
		)
	}
	var content persistence.KnowledgeContentRevision
	if err := db.WithContext(ctx).Where(
		"content_ref = ? AND resource_id = ? AND revision = ? AND ptid = ?",
		descriptor.StationContentRef,
		resourceID,
		revision,
		authorized.ActorID,
	).First(&content).Error; err != nil {
		return nil, "", capabilityStateError(
			"authorized Knowledge content revision is unavailable",
			err,
		)
	}
	sum := sha256.Sum256(content.Content)
	if content.ContentHash != descriptor.ContentHash ||
		content.ContentHash != hex.EncodeToString(sum[:]) ||
		content.IndexRevision != descriptor.IndexRevision {
		return nil, "", capabilityStateError(
			"authorized Knowledge content integrity mismatch",
			nil,
		)
	}
	return &domain.KnowledgeResource{
		ResourceID: descriptor.ResourceID,
		AgentID:    authorized.AgentID,
		Title:      descriptor.Title,
		Source:     descriptor.StationContentRef,
	}, truncateKnowledgeContent(string(content.Content)), nil
}

func (s *KnowledgeRetrievalService) embedText(ctx context.Context, text string) []float64 {
	vec, err := s.embeddingProvider.Embed(ctx, text)
	if err != nil {
		return embedKnowledgeTextFallback(text)
	}
	return vec
}

func (s *KnowledgeRetrievalService) splitKnowledgeChunks(ctx context.Context, resource domain.KnowledgeResource, content string) []knowledgeChunk {
	content = strings.TrimSpace(truncateKnowledgeContent(content))
	if content == "" {
		return nil
	}
	title := resource.Title
	if title == "" {
		title = resource.Source
	}

	var chunks []knowledgeChunk
	for start, index := 0, 0; start < len(content); index++ {
		end := start + knowledgeChunkChars
		if end > len(content) {
			end = len(content)
		}
		text := strings.TrimSpace(content[start:end])
		if text != "" {
			chunkID := stableKnowledgeChunkID(resource.ResourceID, index, text)
			chunks = append(chunks, knowledgeChunk{
				ref: domain.KnowledgeChunkReference{
					ChunkID:        chunkID,
					ResourceID:     resource.ResourceID,
					ResourceTitle:  title,
					Source:         resource.Source,
					ChunkIndex:     index,
					ContentPreview: previewKnowledgeText(text),
				},
				content: text,
				vector:  s.embedText(ctx, text),
			})
		}
		if end == len(content) {
			break
		}
		start = end - knowledgeChunkOverlap
		if start < 0 {
			start = 0
		}
	}
	return chunks
}

func embedKnowledgeTextFallback(text string) []float64 {
	vector := make([]float64, knowledgeEmbeddingDims)
	for _, token := range tokenizeKnowledge(text) {
		sum := sha256.Sum256([]byte(token))
		index := int(binary.BigEndian.Uint64(sum[:8]) % uint64(knowledgeEmbeddingDims))
		vector[index] += 1
	}
	normalizeVector(vector)
	return vector
}

func cosineSimilarity(left, right []float64) float64 {
	if len(left) != len(right) {
		return 0
	}
	var dot float64
	for i := range left {
		dot += left[i] * right[i]
	}
	return dot
}

func keywordOverlapScore(query, content string) float64 {
	queryTokens := tokenizeKnowledge(query)
	if len(queryTokens) == 0 {
		return 0
	}
	contentSet := map[string]struct{}{}
	for _, token := range tokenizeKnowledge(content) {
		contentSet[token] = struct{}{}
	}
	matches := 0
	for _, token := range queryTokens {
		if _, ok := contentSet[token]; ok {
			matches++
		}
	}
	return float64(matches) / float64(len(queryTokens))
}

func tokenizeKnowledge(text string) []string {
	fields := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_'
	})
	tokens := make([]string, 0, len(fields))
	for _, field := range fields {
		if len(field) >= 2 {
			tokens = append(tokens, field)
		}
	}
	return tokens
}

func normalizeVector(vector []float64) {
	var sum float64
	for _, value := range vector {
		sum += value * value
	}
	if sum == 0 {
		return
	}
	length := math.Sqrt(sum)
	for i := range vector {
		vector[i] = vector[i] / length
	}
}

func formatKnowledgePromptBlock(chunks []knowledgeChunk) string {
	if len(chunks) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteString("<knowledge_context>\n")
	builder.WriteString("Use these retrieved Agent knowledge chunks when they are relevant. Cite the resource title when helpful.\n")
	for _, chunk := range chunks {
		builder.WriteString(fmt.Sprintf("\n[resource=%s chunk=%d score=%.3f source=%s]\n%s\n",
			chunk.ref.ResourceTitle,
			chunk.ref.ChunkIndex,
			chunk.score,
			chunk.ref.Source,
			chunk.content,
		))
	}
	builder.WriteString("</knowledge_context>")
	return builder.String()
}

func stableKnowledgeChunkID(resourceID string, index int, content string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%s", resourceID, index, content)))
	return fmt.Sprintf("kchunk_%x", sum[:8])
}

func previewKnowledgeText(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if len(text) <= 240 {
		return text
	}
	return text[:240]
}

func truncateKnowledgeContent(content string) string {
	if len(content) <= knowledgeMaxResourceChars {
		return content
	}
	return content[:knowledgeMaxResourceChars]
}
