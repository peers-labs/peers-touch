package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	artifactKindDocument       = "document"
	artifactOriginAgent        = "agent_output"
	artifactOriginHumanEdit    = "human_edit"
	artifactOriginFeedback     = "feedback_revision"
	artifactOriginImport       = "import"
	artifactFeedbackSelection  = "selection"
	artifactFeedbackComment    = "comment"
	artifactCheckStructural    = "structural"
	artifactCheckHumanReview   = "human_review"
	artifactResultPassed       = "passed"
	artifactResultFailed       = "failed"
	defaultArtifactContentType = "text/markdown"
)

// LogicalArtifactService owns the TW-D3 immutable version sequence,
// feedback, check and acceptance contracts for task results.
type LogicalArtifactService struct {
	db  *gorm.DB
	now func() time.Time
}

func NewLogicalArtifactService() *LogicalArtifactService {
	return &LogicalArtifactService{now: func() time.Time { return time.Now().UTC() }}
}

func (s *LogicalArtifactService) SetDB(db *gorm.DB) { s.db = db }

func (s *LogicalArtifactService) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "open Agent database", err)
	}
	return db, nil
}

func artifactKindToString(kind model.LogicalArtifactKind) string {
	switch kind {
	case model.LogicalArtifactKind_LOGICAL_ARTIFACT_KIND_DOCUMENT:
		return artifactKindDocument
	}
	return ""
}

// taskIDForConversationTx resolves the canonical Chat task owning a
// conversation inside an artifact transaction.
func taskIDForConversationTx(tx *gorm.DB, conversationID string) (string, error) {
	var task persistence.TaskRun
	if err := tx.
		Where("conversation_id = ?", conversationID).
		Order("created_at ASC, task_id ASC").
		First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "resolve conversation task", err)
	}
	return task.TaskID, nil
}

func artifactKindFromString(kind string) model.LogicalArtifactKind {
	switch kind {
	case artifactKindDocument:
		return model.LogicalArtifactKind_LOGICAL_ARTIFACT_KIND_DOCUMENT
	}
	return model.LogicalArtifactKind_LOGICAL_ARTIFACT_KIND_UNSPECIFIED
}

func artifactOriginToString(origin model.ArtifactVersionOrigin) string {
	switch origin {
	case model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT:
		return artifactOriginAgent
	case model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_HUMAN_EDIT:
		return artifactOriginHumanEdit
	case model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_FEEDBACK_REVISION:
		return artifactOriginFeedback
	case model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_IMPORT:
		return artifactOriginImport
	}
	return ""
}

func artifactOriginFromString(origin string) model.ArtifactVersionOrigin {
	switch origin {
	case artifactOriginAgent:
		return model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT
	case artifactOriginHumanEdit:
		return model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_HUMAN_EDIT
	case artifactOriginFeedback:
		return model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_FEEDBACK_REVISION
	case artifactOriginImport:
		return model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_IMPORT
	}
	return model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_UNSPECIFIED
}

func artifactFeedbackKindToString(kind model.ArtifactFeedbackKind) string {
	switch kind {
	case model.ArtifactFeedbackKind_ARTIFACT_FEEDBACK_KIND_SELECTION:
		return artifactFeedbackSelection
	case model.ArtifactFeedbackKind_ARTIFACT_FEEDBACK_KIND_COMMENT:
		return artifactFeedbackComment
	}
	return ""
}

func artifactCheckTypeToString(kind model.ArtifactCheckType) string {
	switch kind {
	case model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_STRUCTURAL:
		return artifactCheckStructural
	case model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_HUMAN_REVIEW:
		return artifactCheckHumanReview
	}
	return ""
}

func artifactCheckTypeFromString(kind string) model.ArtifactCheckType {
	switch kind {
	case artifactCheckStructural:
		return model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_STRUCTURAL
	case artifactCheckHumanReview:
		return model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_HUMAN_REVIEW
	}
	return model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_UNSPECIFIED
}

func artifactCheckResultToString(result model.ArtifactCheckResult) string {
	switch result {
	case model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED:
		return artifactResultPassed
	case model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_FAILED:
		return artifactResultFailed
	}
	return ""
}

func artifactCheckResultFromString(result string) model.ArtifactCheckResult {
	switch result {
	case artifactResultPassed:
		return model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_PASSED
	case artifactResultFailed:
		return model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_FAILED
	}
	return model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_UNSPECIFIED
}

// artifactBodySHA256 is the non-test digest helper for version bodies.
func artifactBodySHA256(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func encodeAttachmentRefs(refs []string) string {
	if len(refs) == 0 {
		return ""
	}
	encoded, err := json.Marshal(refs)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func decodeAttachmentRefs(encoded string) []string {
	trimmed := strings.TrimSpace(encoded)
	if trimmed == "" {
		return nil
	}
	var refs []string
	if err := json.Unmarshal([]byte(trimmed), &refs); err != nil {
		return nil
	}
	return refs
}

func artifactStaleBaseConflict(currentVersionID string) error {
	return errcode.New(
		errcode.AgentInvalidSourceState,
		http.StatusConflict,
		fmt.Sprintf("artifact base version is stale; current_version_id=%s", currentVersionID),
		nil,
	)
}

// lockArtifactConversation locks the actor's conversation row for the
// duration of an artifact transaction.
func (s *LogicalArtifactService) lockArtifactConversation(
	tx *gorm.DB,
	actorID string,
	conversationID string,
) (*persistence.Conversation, error) {
	var conversation persistence.Conversation
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(conversationID), strings.TrimSpace(actorID)).
		First(&conversation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load artifact conversation", err)
	}
	if conversation.Status != string(domain.ConversationStatusActive) {
		return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict, "conversation is not active", nil)
	}
	return &conversation, nil
}

func (s *LogicalArtifactService) getOwnedArtifactTx(
	tx *gorm.DB,
	actorID string,
	artifactID string,
) (*persistence.LogicalArtifact, error) {
	var artifact persistence.LogicalArtifact
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(artifactID), strings.TrimSpace(actorID)).
		First(&artifact).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "artifact not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load logical artifact", err)
	}
	return &artifact, nil
}

func (s *LogicalArtifactService) getOwnedVersionTx(
	tx *gorm.DB,
	actorID string,
	versionID string,
) (*persistence.ArtifactVersion, *persistence.LogicalArtifact, error) {
	var version persistence.ArtifactVersion
	if err := tx.Where("id = ?", strings.TrimSpace(versionID)).First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "artifact version not found", err)
		}
		return nil, nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load artifact version", err)
	}
	artifact, err := s.getOwnedArtifactTx(tx, actorID, version.ArtifactID)
	if err != nil {
		return nil, nil, err
	}
	return &version, artifact, nil
}

// ClaimVersion creates a new immutable version (or a new logical artifact).
func (s *LogicalArtifactService) ClaimVersion(
	ctx context.Context,
	actorID string,
	req *model.ClaimArtifactVersionRequest,
) (*persistence.LogicalArtifact, *persistence.ArtifactVersion, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || req == nil || strings.TrimSpace(req.GetConversationId()) == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor and conversation_id are required", nil)
	}
	origin := req.GetOrigin()
	if origin == model.ArtifactVersionOrigin_ARTIFACT_VERSION_ORIGIN_UNSPECIFIED {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "version origin is required", nil)
	}

	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	now := s.now()
	var savedArtifact persistence.LogicalArtifact
	var savedVersion persistence.ArtifactVersion
	err = db.Transaction(func(tx *gorm.DB) error {
		conversation, lockErr := s.lockArtifactConversation(tx, actorID, req.GetConversationId())
		if lockErr != nil {
			return lockErr
		}

		// Resolve bytes: either a persisted assistant message or the
		// explicit request body (human edit / import).
		var body []byte
		contentType := strings.TrimSpace(req.GetContentType())
		if contentType == "" {
			contentType = defaultArtifactContentType
		}
		sourceTurnID := strings.TrimSpace(req.GetSourceTurnId())
		sourceMessageID := strings.TrimSpace(req.GetSourceMessageId())
		if sourceMessageID != "" {
			var message persistence.AgentMessage
			if findErr := tx.
				Where("id = ? AND conversation_id = ? AND role = ?",
					sourceMessageID, conversation.ID, string(domain.MessageRoleAssistant)).
				First(&message).Error; findErr != nil {
				if errors.Is(findErr, gorm.ErrRecordNotFound) {
					return errcode.New(errcode.AgentNotFound, http.StatusNotFound, "source assistant message not found", findErr)
				}
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load source assistant message", findErr)
			}
			if message.TurnID != nil && sourceTurnID != "" && *message.TurnID != sourceTurnID {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "source turn/message mismatch", nil)
			}
			if sourceTurnID == "" && message.TurnID != nil {
				sourceTurnID = *message.TurnID
			}
			if message.Content == nil {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "source assistant message has no content", nil)
			}
			body = []byte(*message.Content)
		} else {
			body = []byte(req.GetBody())
		}
		if strings.TrimSpace(string(body)) == "" {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "artifact version body is empty", nil)
		}
		hash := artifactBodySHA256(body)

		idempotencyKey := strings.TrimSpace(req.GetClientIdempotencyKey())
		if idempotencyKey != "" {
			var existing persistence.ArtifactVersion
			findErr := tx.
				Where("idempotency_key = ? AND created_by = ?", idempotencyKey, actorID).
				First(&existing).Error
			if findErr == nil {
				var existingArtifact persistence.LogicalArtifact
				if loadErr := tx.Where("id = ?", existing.ArtifactID).First(&existingArtifact).Error; loadErr != nil {
					return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load replayed artifact", loadErr)
				}
				savedArtifact = existingArtifact
				savedVersion = existing
				return nil
			}
			if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "resolve version idempotency", findErr)
			}
		}

		kind := req.GetKind()
		if kind == model.LogicalArtifactKind_LOGICAL_ARTIFACT_KIND_UNSPECIFIED {
			kind = model.LogicalArtifactKind_LOGICAL_ARTIFACT_KIND_DOCUMENT
		}
		name := strings.TrimSpace(req.GetName())

		var artifact *persistence.LogicalArtifact
		baseVersionID := ""
		if artifactID := strings.TrimSpace(req.GetArtifactId()); artifactID != "" {
			owned, ownedErr := s.getOwnedArtifactTx(tx, actorID, artifactID)
			if ownedErr != nil {
				return ownedErr
			}
			artifact = owned
			baseVersionID = artifact.CurrentVersion
			expectedBase := strings.TrimSpace(req.GetExpectedBaseVersionId())
			if expectedBase != "" && expectedBase != artifact.CurrentVersion {
				return artifactStaleBaseConflict(artifact.CurrentVersion)
			}
		} else {
			if name == "" {
				name = "Untitled document"
			}
			taskID, taskErr := taskIDForConversationTx(tx, conversation.ID)
			if taskErr != nil {
				return taskErr
			}
			artifact = &persistence.LogicalArtifact{
				ID:             generateID("art"),
				TaskID:         taskID,
				ConversationID: conversation.ID,
				ActorPTID:      actorID,
				AgentID:        conversation.AgentID,
				Kind:           artifactKindToString(kind),
				Name:           name,
			}
			if createErr := tx.Create(artifact).Error; createErr != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create logical artifact", createErr)
			}
		}

		// Identical current bytes never manufacture a new revision.
		if artifact.CurrentVersion != "" {
			var currentBody persistence.ArtifactVersionBody
			if findErr := tx.Where("version_id = ?", artifact.CurrentVersion).First(&currentBody).Error; findErr == nil {
				if artifactBodySHA256(currentBody.Body) == hash {
					var current persistence.ArtifactVersion
					if loadErr := tx.Where("id = ?", artifact.CurrentVersion).First(&current).Error; loadErr != nil {
						return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load unchanged current version", loadErr)
					}
					savedArtifact = *artifact
					savedVersion = current
					return nil
				}
			} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "read current version body", findErr)
			}
		}

		nextSeq := artifact.CurrentSeq + 1
		version := &persistence.ArtifactVersion{
			ID:                    generateID("artver"),
			ArtifactID:            artifact.ID,
			Seq:                   nextSeq,
			ParentVersionID:       baseVersionID,
			Origin:                artifactOriginToString(origin),
			ContentType:           contentType,
			SHA256:                hash,
			Size:                  uint64(len(body)),
			Summary:               strings.TrimSpace(req.GetSummary()),
			SourceTurnID:          sourceTurnID,
			SourceMessageID:       sourceMessageID,
			FeedbackID:            strings.TrimSpace(req.GetFeedbackId()),
			AdoptedAttachmentRefs: encodeAttachmentRefs(req.GetAdoptedAttachmentRefs()),
			IdempotencyKey:        idempotencyKey,
			CreatedBy:             actorID,
			CreatedAt:             now,
		}
		if err := tx.Create(version).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create artifact version", err)
		}
		bodyRow := &persistence.ArtifactVersionBody{
			VersionID:   version.ID,
			SHA256:      hash,
			ContentType: contentType,
			Body:        body,
			CreatedAt:   now,
		}
		if err := tx.Create(bodyRow).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create artifact version body", err)
		}
		if err := tx.Model(&persistence.LogicalArtifact{}).
			Where("id = ?", artifact.ID).
			Updates(map[string]interface{}{
				"current_version": version.ID,
				"current_seq":     nextSeq,
				"name":            nameOrExisting(name, artifact.Name),
				"updated_at":      now,
			}).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "advance artifact current version", err)
		}
		if feedbackID := version.FeedbackID; feedbackID != "" {
			if err := tx.Model(&persistence.ArtifactFeedback{}).
				Where("id = ? AND artifact_id = ? AND created_by = ?", feedbackID, artifact.ID, actorID).
				Update("resulting_version_id", version.ID).Error; err != nil {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "link feedback revision", err)
			}
		}
		artifact.CurrentVersion = version.ID
		artifact.CurrentSeq = nextSeq
		savedArtifact = *artifact
		savedVersion = *version
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return &savedArtifact, &savedVersion, nil
}

func nameOrExisting(name string, existing string) string {
	if name == "" {
		return existing
	}
	return name
}

// SubmitFeedback records selection/comment feedback against a base version.
func (s *LogicalArtifactService) SubmitFeedback(
	ctx context.Context,
	actorID string,
	req *model.SubmitArtifactFeedbackRequest,
) (*persistence.ArtifactFeedback, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || req == nil ||
		strings.TrimSpace(req.GetArtifactId()) == "" ||
		strings.TrimSpace(req.GetBaseVersionId()) == "" ||
		strings.TrimSpace(req.GetInstruction()) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"artifact_id, base_version_id and instruction are required", nil)
	}
	if req.GetKind() == model.ArtifactFeedbackKind_ARTIFACT_FEEDBACK_KIND_UNSPECIFIED {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "feedback kind is required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var saved persistence.ArtifactFeedback
	err = db.Transaction(func(tx *gorm.DB) error {
		artifact, lockErr := s.getOwnedArtifactTx(tx, actorID, req.GetArtifactId())
		if lockErr != nil {
			return lockErr
		}
		var base persistence.ArtifactVersion
		if findErr := tx.
			Where("id = ? AND artifact_id = ?", strings.TrimSpace(req.GetBaseVersionId()), artifact.ID).
			First(&base).Error; findErr != nil {
			if errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errcode.New(errcode.AgentNotFound, http.StatusNotFound, "base artifact version not found", findErr)
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load base artifact version", findErr)
		}
		if key := strings.TrimSpace(req.GetClientIdempotencyKey()); key != "" {
			var existing persistence.ArtifactFeedback
			if findErr := tx.
				Where("idempotency_key = ? AND created_by = ?", key, actorID).
				First(&existing).Error; findErr == nil {
				saved = existing
				return nil
			} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "resolve feedback idempotency", findErr)
			}
		}
		saved = persistence.ArtifactFeedback{
			ID:             generateID("artfb"),
			ArtifactID:     artifact.ID,
			BaseVersionID:  base.ID,
			Kind:           artifactFeedbackKindToString(req.GetKind()),
			AnchorText:     strings.TrimSpace(req.GetAnchorText()),
			Instruction:    strings.TrimSpace(req.GetInstruction()),
			IdempotencyKey: strings.TrimSpace(req.GetClientIdempotencyKey()),
			CreatedBy:      actorID,
			CreatedAt:      now,
		}
		if err := tx.Create(&saved).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create artifact feedback", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

// RecordCheck records a structural or human-review check against exact
// version bytes. It never mutates or auto-flips prior checks.
func (s *LogicalArtifactService) RecordCheck(
	ctx context.Context,
	actorID string,
	req *model.RecordArtifactCheckRequest,
) (*persistence.ArtifactCheck, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || req == nil ||
		strings.TrimSpace(req.GetArtifactId()) == "" ||
		strings.TrimSpace(req.GetVersionId()) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "artifact_id and version_id are required", nil)
	}
	if req.GetCheckType() == model.ArtifactCheckType_ARTIFACT_CHECK_TYPE_UNSPECIFIED ||
		req.GetResult() == model.ArtifactCheckResult_ARTIFACT_CHECK_RESULT_UNSPECIFIED {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "check type and result are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var saved persistence.ArtifactCheck
	err = db.Transaction(func(tx *gorm.DB) error {
		version, _, versionErr := s.getOwnedVersionTx(tx, actorID, req.GetVersionId())
		if versionErr != nil {
			return versionErr
		}
		if version.ArtifactID != strings.TrimSpace(req.GetArtifactId()) {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "check does not belong to the artifact", nil)
		}
		if key := strings.TrimSpace(req.GetClientIdempotencyKey()); key != "" {
			var existing persistence.ArtifactCheck
			if findErr := tx.
				Where("idempotency_key = ? AND created_by = ?", key, actorID).
				First(&existing).Error; findErr == nil {
				saved = existing
				return nil
			} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "resolve check idempotency", findErr)
			}
		}
		saved = persistence.ArtifactCheck{
			ID:             generateID("artchk"),
			ArtifactID:     version.ArtifactID,
			VersionID:      version.ID,
			SHA256:         version.SHA256,
			CheckType:      artifactCheckTypeToString(req.GetCheckType()),
			Result:         artifactCheckResultToString(req.GetResult()),
			Detail:         strings.TrimSpace(req.GetDetail()),
			Environment:    strings.TrimSpace(req.GetEnvironment()),
			IdempotencyKey: strings.TrimSpace(req.GetClientIdempotencyKey()),
			CreatedBy:      actorID,
			CreatedAt:      now,
		}
		if err := tx.Create(&saved).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create artifact check", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

// AcceptVersion records acceptance of one exact version with a snapshot of
// its current passing checks. Acceptance stays a historical fact but is
// only "current" while the version remains the artifact head.
func (s *LogicalArtifactService) AcceptVersion(
	ctx context.Context,
	actorID string,
	req *model.AcceptArtifactVersionRequest,
) (*persistence.ArtifactAcceptance, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || req == nil ||
		strings.TrimSpace(req.GetArtifactId()) == "" ||
		strings.TrimSpace(req.GetVersionId()) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "artifact_id and version_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var saved persistence.ArtifactAcceptance
	err = db.Transaction(func(tx *gorm.DB) error {
		version, artifact, versionErr := s.getOwnedVersionTx(tx, actorID, req.GetVersionId())
		if versionErr != nil {
			return versionErr
		}
		if artifact.ID != strings.TrimSpace(req.GetArtifactId()) {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "acceptance does not belong to the artifact", nil)
		}
		if artifact.CurrentVersion != version.ID {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"only the current artifact version can be accepted",
				nil,
			)
		}
		if key := strings.TrimSpace(req.GetClientIdempotencyKey()); key != "" {
			var existing persistence.ArtifactAcceptance
			if findErr := tx.
				Where("idempotency_key = ? AND actor = ?", key, actorID).
				First(&existing).Error; findErr == nil {
				saved = existing
				return nil
			} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "resolve acceptance idempotency", findErr)
			}
		}
		var passingChecks []persistence.ArtifactCheck
		if findErr := tx.
			Where("artifact_id = ? AND version_id = ? AND result = ?", artifact.ID, version.ID, artifactResultPassed).
			Order("created_at ASC, id ASC").
			Find(&passingChecks).Error; findErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "snapshot acceptance checks", findErr)
		}
		checkIDs := make([]string, 0, len(passingChecks))
		for _, check := range passingChecks {
			checkIDs = append(checkIDs, check.ID)
		}
		saved = persistence.ArtifactAcceptance{
			ID:             generateID("artacc"),
			ArtifactID:     artifact.ID,
			VersionID:      version.ID,
			SHA256:         version.SHA256,
			CheckIDs:       encodeAttachmentRefs(checkIDs),
			IdempotencyKey: strings.TrimSpace(req.GetClientIdempotencyKey()),
			Actor:          actorID,
			CreatedAt:      now,
		}
		if err := tx.Create(&saved).Error; err != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "create artifact acceptance", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (s *LogicalArtifactService) ListArtifacts(
	ctx context.Context,
	actorID string,
	conversationID string,
) ([]persistence.LogicalArtifact, error) {
	actorID = strings.TrimSpace(actorID)
	conversationID = strings.TrimSpace(conversationID)
	if actorID == "" || conversationID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor and conversation_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.LogicalArtifact
	if err := db.
		Where("actor_ptid = ? AND conversation_id = ?", actorID, conversationID).
		Order("created_at ASC, id ASC").
		Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "list logical artifacts", err)
	}
	return rows, nil
}

func (s *LogicalArtifactService) ListVersions(
	ctx context.Context,
	actorID string,
	artifactID string,
) ([]persistence.ArtifactVersion, error) {
	actorID = strings.TrimSpace(actorID)
	artifactID = strings.TrimSpace(artifactID)
	if actorID == "" || artifactID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor and artifact_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []persistence.ArtifactVersion
	err = db.Transaction(func(tx *gorm.DB) error {
		if _, lockErr := s.getOwnedArtifactTx(tx, actorID, artifactID); lockErr != nil {
			return lockErr
		}
		return tx.Where("artifact_id = ?", artifactID).
			Order("seq ASC").
			Find(&rows).Error
	})
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *LogicalArtifactService) GetVersionBody(
	ctx context.Context,
	actorID string,
	versionID string,
) (*persistence.ArtifactVersion, *persistence.ArtifactVersionBody, error) {
	actorID = strings.TrimSpace(actorID)
	versionID = strings.TrimSpace(versionID)
	if actorID == "" || versionID == "" {
		return nil, nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor and version_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, nil, err
	}
	var version persistence.ArtifactVersion
	var body persistence.ArtifactVersionBody
	err = db.Transaction(func(tx *gorm.DB) error {
		v, _, versionErr := s.getOwnedVersionTx(tx, actorID, versionID)
		if versionErr != nil {
			return versionErr
		}
		version = *v
		if findErr := tx.Where("version_id = ?", version.ID).First(&body).Error; findErr != nil {
			if errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errcode.New(errcode.AgentNotFound, http.StatusNotFound, "artifact version body not found", findErr)
			}
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load artifact version body", findErr)
		}
		if body.SHA256 != version.SHA256 {
			return errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict, "artifact version body digest mismatch", nil)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return &version, &body, nil
}

func (s *LogicalArtifactService) ListFeedback(
	ctx context.Context,
	actorID string,
	artifactID string,
) ([]persistence.ArtifactFeedback, error) {
	var rows []persistence.ArtifactFeedback
	if err := s.listArtifactRows(ctx, actorID, artifactID, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *LogicalArtifactService) ListChecks(
	ctx context.Context,
	actorID string,
	artifactID string,
) ([]persistence.ArtifactCheck, error) {
	var rows []persistence.ArtifactCheck
	if err := s.listArtifactRows(ctx, actorID, artifactID, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *LogicalArtifactService) ListAcceptances(
	ctx context.Context,
	actorID string,
	artifactID string,
) ([]persistence.ArtifactAcceptance, error) {
	var rows []persistence.ArtifactAcceptance
	if err := s.listArtifactRows(ctx, actorID, artifactID, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *LogicalArtifactService) listArtifactRows(
	ctx context.Context,
	actorID string,
	artifactID string,
	dest any,
) error {
	actorID = strings.TrimSpace(actorID)
	artifactID = strings.TrimSpace(artifactID)
	if actorID == "" || artifactID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "actor and artifact_id are required", nil)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if _, lockErr := s.getOwnedArtifactTx(tx, actorID, artifactID); lockErr != nil {
			return lockErr
		}
		if findErr := tx.Where("artifact_id = ?", artifactID).
			Order("created_at ASC, id ASC").
			Find(dest).Error; findErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "list artifact rows", findErr)
		}
		return nil
	})
}

// CurrentVersionID returns the artifact head version for an actor.
func (s *LogicalArtifactService) CurrentVersionID(
	ctx context.Context,
	actorID string,
	artifactID string,
) (string, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return "", err
	}
	var artifact persistence.LogicalArtifact
	if findErr := db.
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(artifactID), strings.TrimSpace(actorID)).
		First(&artifact).Error; findErr != nil {
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			return "", errcode.New(errcode.AgentNotFound, http.StatusNotFound, "artifact not found", findErr)
		}
		return "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load artifact current version", findErr)
	}
	return artifact.CurrentVersion, nil
}

// IsAcceptanceCurrent reports whether an acceptance's version is the head.
func (s *LogicalArtifactService) IsAcceptanceCurrent(
	ctx context.Context,
	actorID string,
	artifactID string,
	versionID string,
) (bool, error) {
	current, err := s.CurrentVersionID(ctx, actorID, artifactID)
	if err != nil {
		return false, err
	}
	return current == strings.TrimSpace(versionID), nil
}

// ── proto mappers ──────────────────────────────────────────────────────────

func LogicalArtifactProto(row *persistence.LogicalArtifact) *model.LogicalArtifact {
	return logicalArtifactToProto(row)
}

func ArtifactVersionProto(row *persistence.ArtifactVersion) *model.ArtifactVersion {
	return artifactVersionToProto(row)
}

func ArtifactFeedbackProto(row *persistence.ArtifactFeedback) *model.ArtifactFeedback {
	return artifactFeedbackToProto(row)
}

func ArtifactCheckProto(row *persistence.ArtifactCheck) *model.ArtifactCheck {
	return artifactCheckToProto(row, "")
}

func ArtifactAcceptanceProto(row *persistence.ArtifactAcceptance, currentVersionID string) *model.ArtifactAcceptance {
	return artifactAcceptanceToProto(row, currentVersionID)
}

func logicalArtifactToProto(row *persistence.LogicalArtifact) *model.LogicalArtifact {
	if row == nil {
		return nil
	}
	return &model.LogicalArtifact{
		ArtifactId:       row.ID,
		TaskId:           row.TaskID,
		ConversationId:   row.ConversationID,
		AgentId:          row.AgentID,
		Kind:             artifactKindFromString(row.Kind),
		Name:             row.Name,
		CurrentVersionId: row.CurrentVersion,
		CurrentSeq:       row.CurrentSeq,
		CreatedAt:        timestamppb.New(row.CreatedAt),
		UpdatedAt:        timestamppb.New(row.UpdatedAt),
	}
}

func artifactVersionToProto(row *persistence.ArtifactVersion) *model.ArtifactVersion {
	if row == nil {
		return nil
	}
	return &model.ArtifactVersion{
		VersionId:             row.ID,
		ArtifactId:            row.ArtifactID,
		Seq:                   row.Seq,
		ParentVersionId:       row.ParentVersionID,
		Origin:                artifactOriginFromString(row.Origin),
		ContentType:           row.ContentType,
		Sha256:                row.SHA256,
		Size:                  row.Size,
		Summary:               row.Summary,
		SourceTurnId:          row.SourceTurnID,
		SourceMessageId:       row.SourceMessageID,
		FeedbackId:            row.FeedbackID,
		AdoptedAttachmentRefs: decodeAttachmentRefs(row.AdoptedAttachmentRefs),
		CreatedBy:             row.CreatedBy,
		CreatedAt:             timestamppb.New(row.CreatedAt),
	}
}

func artifactFeedbackToProto(row *persistence.ArtifactFeedback) *model.ArtifactFeedback {
	if row == nil {
		return nil
	}
	kind := model.ArtifactFeedbackKind_ARTIFACT_FEEDBACK_KIND_UNSPECIFIED
	switch row.Kind {
	case artifactFeedbackSelection:
		kind = model.ArtifactFeedbackKind_ARTIFACT_FEEDBACK_KIND_SELECTION
	case artifactFeedbackComment:
		kind = model.ArtifactFeedbackKind_ARTIFACT_FEEDBACK_KIND_COMMENT
	}
	return &model.ArtifactFeedback{
		FeedbackId:         row.ID,
		ArtifactId:         row.ArtifactID,
		BaseVersionId:      row.BaseVersionID,
		Kind:               kind,
		AnchorText:         row.AnchorText,
		Instruction:        row.Instruction,
		ResultingVersionId: row.ResultingVersionID,
		CreatedBy:          row.CreatedBy,
		CreatedAt:          timestamppb.New(row.CreatedAt),
	}
}

func artifactCheckToProto(row *persistence.ArtifactCheck, currentVersionID string) *model.ArtifactCheck {
	if row == nil {
		return nil
	}
	return &model.ArtifactCheck{
		CheckId:          row.ID,
		ArtifactId:       row.ArtifactID,
		VersionId:        row.VersionID,
		Sha256:           row.SHA256,
		CheckType:        artifactCheckTypeFromString(row.CheckType),
		Result:           artifactCheckResultFromString(row.Result),
		Detail:           row.Detail,
		CriteriaRevision: row.CriteriaRevision,
		MaterialRevision: row.MaterialRevision,
		Environment:      row.Environment,
		CreatedBy:        row.CreatedBy,
		CreatedAt:        timestamppb.New(row.CreatedAt),
	}
}

func artifactAcceptanceToProto(row *persistence.ArtifactAcceptance, currentVersionID string) *model.ArtifactAcceptance {
	if row == nil {
		return nil
	}
	return &model.ArtifactAcceptance{
		AcceptanceId: row.ID,
		ArtifactId:   row.ArtifactID,
		VersionId:    row.VersionID,
		Sha256:       row.SHA256,
		CheckIds:     decodeAttachmentRefs(row.CheckIDs),
		Actor:        row.Actor,
		CreatedAt:    timestamppb.New(row.CreatedAt),
		Current:      row.VersionID == currentVersionID,
	}
}
