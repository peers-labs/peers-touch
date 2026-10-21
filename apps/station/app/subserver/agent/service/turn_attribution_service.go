package service

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/gorm"
)

const maxTurnAttributionBatchSize = 100

func (s *TurnService) GetTurnAttributions(
	ctx context.Context,
	ptid string,
	turnIDs []string,
) ([]*model.TurnAttributionProjection, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	ptid = strings.TrimSpace(ptid)
	if ptid == "" {
		return nil, errcode.New(
			errcode.AgentUnauthorized,
			http.StatusUnauthorized,
			"actor identity is required",
			nil,
		)
	}
	normalized := uniqueAttributionTurnIDs(turnIDs)
	if len(normalized) == 0 || len(normalized) > maxTurnAttributionBatchSize {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"between 1 and 100 turn_ids are required",
			nil,
		)
	}

	var turns []persistence.AgentTurn
	if err := db.WithContext(ctx).
		Table("agent_turns AS turns").
		Select("turns.*").
		Joins("JOIN agent_conversations AS conversations ON conversations.id = turns.conversation_id").
		Where("turns.id IN ? AND conversations.actor_ptid = ?", normalized, ptid).
		Find(&turns).Error; err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"load turn attribution ownership",
			err,
		)
	}
	if len(turns) != len(normalized) {
		return nil, errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"turn attribution source not found",
			nil,
		)
	}

	turnByID := make(map[string]persistence.AgentTurn, len(turns))
	for _, turn := range turns {
		turnByID[turn.ID] = turn
	}
	result := make([]*model.TurnAttributionProjection, 0, len(normalized))
	for _, turnID := range normalized {
		projection, projectionErr := buildTurnAttributionProjection(
			ctx,
			db,
			ptid,
			turnByID[turnID],
		)
		if projectionErr != nil {
			return nil, projectionErr
		}
		result = append(result, projection)
	}
	return result, nil
}

func uniqueAttributionTurnIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func buildTurnAttributionProjection(
	ctx context.Context,
	db *gorm.DB,
	ptid string,
	turn persistence.AgentTurn,
) (*model.TurnAttributionProjection, error) {
	switch turn.Status {
	case string(domain.TurnStatusCompleted),
		string(domain.TurnStatusFailed),
		string(domain.TurnStatusCancelled),
		string(domain.TurnStatusInterrupted):
	default:
		return unavailableTurnAttribution(
			turn.ID,
			"",
			"turn_not_terminal",
		), nil
	}
	var attempt persistence.TurnAttempt
	if err := db.WithContext(ctx).
		Where("turn_id = ?", turn.ID).
		Order("attempt_index DESC").
		First(&attempt).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return unavailableTurnAttribution(turn.ID, "", "context_ledger_unavailable"), nil
		}
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"load turn attribution attempt",
			err,
		)
	}
	if strings.TrimSpace(attempt.ContextLedger) == "" {
		return unavailableTurnAttribution(
			turn.ID,
			attempt.ID,
			"context_ledger_unavailable",
		), nil
	}

	var ledger model.ContextLedger
	if err := protojson.Unmarshal([]byte(attempt.ContextLedger), &ledger); err != nil {
		return unavailableTurnAttribution(
			turn.ID,
			attempt.ID,
			"context_ledger_malformed",
		), nil
	}
	if ledger.GetTurnId() != turn.ID ||
		ledger.GetAttemptId() != attempt.ID ||
		strings.TrimSpace(ledger.GetContextLedgerId()) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"context ledger identity does not match the requested turn",
			nil,
		)
	}

	attachmentNames, attachmentVersions, err := attributionAttachments(
		ctx,
		db,
		turn.ID,
	)
	if err != nil {
		return nil, err
	}
	entries := make([]*model.TurnAttributionEntry, 0)
	for _, segment := range ledger.GetSegments() {
		segmentEntries, segmentErr := attributionEntriesForSegment(
			ctx,
			db,
			ptid,
			segment,
			attachmentNames,
			attachmentVersions,
		)
		if segmentErr != nil {
			return nil, segmentErr
		}
		entries = append(entries, segmentEntries...)
	}
	toolEntries, err := attributionToolEntries(
		ctx,
		db,
		ptid,
		turn.ID,
		attempt.ID,
	)
	if err != nil {
		return nil, err
	}
	entries = append(entries, toolEntries...)
	entries = dedupeTurnAttributionEntries(entries)

	return &model.TurnAttributionProjection{
		TurnId:          turn.ID,
		AttemptId:       attempt.ID,
		ContextLedgerId: ledger.GetContextLedgerId(),
		PromptVersion:   safeProjectionText(ledger.GetPromptVersion(), 64),
		State:           model.TurnAttributionState_TURN_ATTRIBUTION_STATE_AVAILABLE,
		Entries:         entries,
	}, nil
}

func unavailableTurnAttribution(
	turnID string,
	attemptID string,
	reasonCode string,
) *model.TurnAttributionProjection {
	return &model.TurnAttributionProjection{
		TurnId:     turnID,
		AttemptId:  attemptID,
		State:      model.TurnAttributionState_TURN_ATTRIBUTION_STATE_UNAVAILABLE,
		ReasonCode: safeProjectionReasonCode(reasonCode),
	}
}

func attributionEntriesForSegment(
	ctx context.Context,
	db *gorm.DB,
	ptid string,
	segment *model.ContextSegment,
	attachmentNames map[string]string,
	attachmentVersions map[string]string,
) ([]*model.TurnAttributionEntry, error) {
	if segment == nil {
		return nil, nil
	}
	kind := model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_UNSPECIFIED
	switch segment.GetType() {
	case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_SKILL_BODY:
		kind = model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_SKILL
	case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_MEMORY:
		kind = model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY
	case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_KNOWLEDGE:
		kind = model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_KNOWLEDGE
	case model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_ATTACHMENT:
		kind = model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_ATTACHMENT
	default:
		return nil, nil
	}

	outcome := attributionOutcome(segment.GetDecision())
	reasonCode := attributionSegmentReason(segment, outcome)
	refs := segment.GetSourceRefs()
	if kind == model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY &&
		len(refs) == 0 {
		refs = []string{"memory"}
	}
	if len(refs) == 0 {
		return nil, nil
	}

	entries := make([]*model.TurnAttributionEntry, 0, len(refs))
	for _, ref := range refs {
		sourceID, version, valid := parseAttributionSourceRef(kind, ref)
		if !valid {
			continue
		}
		name := ""
		switch kind {
		case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_SKILL:
			name = historicalCapabilityName(
				ctx,
				db,
				ptid,
				"skill:"+sourceID,
				version,
				name,
			)
		case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_KNOWLEDGE:
			name = historicalKnowledgeName(
				ctx,
				db,
				ptid,
				sourceID,
				version,
				name,
			)
		case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_ATTACHMENT:
			if value := attachmentNames[sourceID]; value != "" {
				name = value
			}
			if version == "" {
				version = attachmentVersions[sourceID]
			}
		case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY:
			if version == "" {
				version = shortProjectionHash(segment.GetContentHash())
			}
		}
		if version == "" {
			version = shortProjectionHash(segment.GetContentHash())
		}
		entries = append(entries, newTurnAttributionEntry(
			kind,
			sourceID,
			name,
			version,
			outcome,
			reasonCode,
		))
	}
	return entries, nil
}

func attributionToolEntries(
	ctx context.Context,
	db *gorm.DB,
	ptid string,
	turnID string,
	attemptID string,
) ([]*model.TurnAttributionEntry, error) {
	var calls []persistence.ToolCall
	if err := db.WithContext(ctx).
		Where("actor_id = ? AND turn_id = ? AND attempt_id = ?", ptid, turnID, attemptID).
		Order("created_at ASC").
		Find(&calls).Error; err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"load turn attribution tool lineage",
			err,
		)
	}
	entries := make([]*model.TurnAttributionEntry, 0, len(calls))
	for _, call := range calls {
		outcome, reasonCode := attributionToolOutcome(call.Status)
		version := strings.TrimSpace(call.ManifestVersion)
		if version == "" {
			version = strings.TrimSpace(call.SchemaVersion)
		}
		name := safeProjectionText(call.ToolName, 160)
		sourceID := strings.TrimSpace(call.ToolCallID)
		if sourceID == "" {
			sourceID = strings.TrimSpace(call.ID)
		}
		entries = append(entries, newTurnAttributionEntry(
			model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_TOOL,
			sourceID,
			name,
			version,
			outcome,
			reasonCode,
		))
	}
	return entries, nil
}

func attributionAttachments(
	ctx context.Context,
	db *gorm.DB,
	turnID string,
) (map[string]string, map[string]string, error) {
	var messages []persistence.AgentMessage
	if err := db.WithContext(ctx).
		Select("attachments_json").
		Where("turn_id = ? AND attachments_json IS NOT NULL", turnID).
		Find(&messages).Error; err != nil {
		return nil, nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"load turn attribution attachments",
			err,
		)
	}
	names := make(map[string]string)
	versions := make(map[string]string)
	for _, message := range messages {
		var attachments []*model.AgentAttachmentRef
		if len(message.AttachmentsJSON) == 0 {
			continue
		}
		if err := json.Unmarshal(message.AttachmentsJSON, &attachments); err != nil {
			return nil, nil, errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"decode historical turn attachment attribution",
				err,
			)
		}
		for _, attachment := range attachments {
			if attachment == nil || strings.TrimSpace(attachment.GetAttachmentId()) == "" {
				continue
			}
			id := strings.TrimSpace(attachment.GetAttachmentId())
			names[id] = safeProjectionText(attachment.GetFilename(), 160)
			versions[id] = shortProjectionHash(attachment.GetChecksum())
		}
	}
	return names, versions, nil
}

func parseAttributionSourceRef(
	kind model.TurnAttributionKind,
	ref string,
) (string, string, bool) {
	ref = strings.TrimSpace(ref)
	prefix := ""
	switch kind {
	case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_SKILL:
		prefix = "skill:"
	case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_KNOWLEDGE:
		prefix = "knowledge:"
	case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_ATTACHMENT:
		prefix = "attachment:"
	case model.TurnAttributionKind_TURN_ATTRIBUTION_KIND_MEMORY:
		if ref == "memory" || strings.HasPrefix(ref, "memory:") {
			return "memory", "", true
		}
		return "", "", false
	default:
		return "", "", false
	}
	if !strings.HasPrefix(ref, prefix) {
		return "", "", false
	}
	value := strings.TrimPrefix(ref, prefix)
	version := ""
	if marker := strings.LastIndex(value, ":version="); marker >= 0 {
		version = value[marker+len(":version="):]
		value = value[:marker]
	}
	value = strings.TrimSpace(value)
	version = safeProjectionText(version, 64)
	if value == "" || strings.ContainsAny(value, `/\`) {
		return "", "", false
	}
	return safeProjectionText(value, 160), version, true
}

func historicalCapabilityName(
	ctx context.Context,
	db *gorm.DB,
	ptid string,
	capabilityID string,
	version string,
	fallback string,
) string {
	if version == "" {
		return fallback
	}
	var record persistence.CapabilityManifest
	if err := db.WithContext(ctx).
		Where(
			"capability_id = ? AND version = ? AND (owner_ptid = ? OR owner_ptid = '')",
			capabilityID,
			version,
			ptid,
		).
		First(&record).Error; err != nil {
		return fallback
	}
	manifest := capabilityManifestModel(&record)
	if manifest.GetDisplayMetadata() == nil {
		return fallback
	}
	if name := safeProjectionText(manifest.GetDisplayMetadata().GetName(), 160); name != "" {
		return name
	}
	return fallback
}

func historicalKnowledgeName(
	ctx context.Context,
	db *gorm.DB,
	ptid string,
	resourceID string,
	version string,
	fallback string,
) string {
	revision, err := strconv.ParseUint(version, 10, 64)
	if err != nil || revision == 0 {
		return fallback
	}
	var record persistence.KnowledgeResourceRevision
	if err := db.WithContext(ctx).
		Where(
			"resource_id = ? AND revision = ? AND ptid = ?",
			resourceID,
			revision,
			ptid,
		).
		First(&record).Error; err != nil {
		return fallback
	}
	if title := safeProjectionText(record.Title, 160); title != "" {
		return title
	}
	return fallback
}

func attributionOutcome(
	decision model.ContextSegmentDecision,
) model.TurnAttributionOutcome {
	switch decision {
	case model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_INCLUDED:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_INCLUDED
	case model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_TRUNCATED,
		model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_SUMMARIZED:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_TRUNCATED
	default:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_OMITTED
	}
}

func attributionSegmentReason(
	segment *model.ContextSegment,
	outcome model.TurnAttributionOutcome,
) string {
	if reason := safeProjectionReasonCode(segment.GetDecisionReason()); reason != "" {
		return reason
	}
	switch outcome {
	case model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_INCLUDED:
		return "context_included"
	case model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_TRUNCATED:
		return "context_truncated"
	default:
		return "context_omitted"
	}
}

func attributionToolOutcome(
	status string,
) (model.TurnAttributionOutcome, string) {
	switch status {
	case persistence.ToolCallStatusSucceeded:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_INCLUDED, "tool_succeeded"
	case persistence.ToolCallStatusFailed,
		persistence.ToolCallStatusUnknownSideEffect:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_TRUNCATED, "tool_partial"
	case persistence.ToolCallStatusDenied:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_OMITTED, "tool_denied"
	case persistence.ToolCallStatusCancelled:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_OMITTED, "tool_cancelled"
	case persistence.ToolCallStatusExpired:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_OMITTED, "tool_expired"
	default:
		return model.TurnAttributionOutcome_TURN_ATTRIBUTION_OUTCOME_TRUNCATED, "tool_incomplete"
	}
}

func newTurnAttributionEntry(
	kind model.TurnAttributionKind,
	sourceID string,
	name string,
	version string,
	outcome model.TurnAttributionOutcome,
	reasonCode string,
) *model.TurnAttributionEntry {
	sourceID = safeProjectionText(sourceID, 160)
	version = safeProjectionText(version, 64)
	return &model.TurnAttributionEntry{
		AttributionId: "turn-source-" + shortCapabilityHash(
			kind.String(),
			sourceID,
			version,
			outcome.String(),
		),
		Kind:       kind,
		SourceId:   sourceID,
		Name:       safeProjectionText(name, 160),
		Version:    version,
		Outcome:    outcome,
		ReasonCode: safeProjectionReasonCode(reasonCode),
	}
}

func dedupeTurnAttributionEntries(
	entries []*model.TurnAttributionEntry,
) []*model.TurnAttributionEntry {
	byID := make(map[string]*model.TurnAttributionEntry, len(entries))
	for _, entry := range entries {
		if entry == nil || strings.TrimSpace(entry.GetAttributionId()) == "" {
			continue
		}
		byID[entry.GetAttributionId()] = entry
	}
	result := make([]*model.TurnAttributionEntry, 0, len(byID))
	for _, entry := range byID {
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].GetKind() != result[j].GetKind() {
			return result[i].GetKind() < result[j].GetKind()
		}
		if result[i].GetName() != result[j].GetName() {
			return result[i].GetName() < result[j].GetName()
		}
		return result[i].GetAttributionId() < result[j].GetAttributionId()
	})
	return result
}

func shortProjectionHash(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 12 {
		return value
	}
	return value[:12]
}

func safeProjectionText(value string, limit int) string {
	value = redactDiagnosticText(strings.TrimSpace(value))
	runes := []rune(value)
	if len(runes) > limit {
		value = string(runes[:limit])
	}
	return value
}
