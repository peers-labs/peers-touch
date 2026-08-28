package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"google.golang.org/protobuf/proto"
)

const (
	agentAttachmentObjectPrefix = "oss:"
	agentAttachmentScopePrefix  = "conversation:"
)

type attachmentObjectReader interface {
	ReadOwnedFile(context.Context, string, string, uint64) (*ossmodel.FileMeta, []byte, error)
}

type AdmittedAttachment struct {
	Ref            *model.AgentAttachmentRef
	Body           []byte
	OmissionReason string
}

type AttachmentAdmissionService struct {
	objects attachmentObjectReader
	now     func() time.Time
}

func NewAttachmentAdmissionService(objects attachmentObjectReader) *AttachmentAdmissionService {
	return &AttachmentAdmissionService{
		objects: objects,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

func (s *AttachmentAdmissionService) Admit(
	ctx context.Context,
	actorID string,
	conversationID string,
	attachments []*model.AgentAttachmentRef,
	capabilities *model.RuntimeCapabilitySnapshot,
	budget *model.RuntimeBudget,
) ([]AdmittedAttachment, error) {
	if len(attachments) == 0 {
		return nil, nil
	}
	if s == nil || s.objects == nil {
		return nil, attachmentRejected("attachment storage authority is unavailable")
	}
	if capabilities == nil || capabilities.GetInput() == nil || capabilities.GetLimits() == nil {
		return nil, attachmentRejected("model attachment capability is unavailable")
	}

	maxCount := capabilities.GetLimits().GetAttachmentCount()
	if maxCount == 0 || uint32(len(attachments)) > maxCount {
		return nil, attachmentRejected("attachment count exceeds model capability")
	}
	maxBytes := capabilities.GetLimits().GetAttachmentBytes()
	if budget != nil && budget.GetMaxAttachmentBytes() > 0 &&
		(maxBytes == 0 || budget.GetMaxAttachmentBytes() < maxBytes) {
		maxBytes = budget.GetMaxAttachmentBytes()
	}

	now := s.now()
	expectedScope := agentAttachmentScopePrefix + strings.TrimSpace(conversationID)
	seenIDs := make(map[string]struct{}, len(attachments))
	admitted := make([]AdmittedAttachment, 0, len(attachments))
	var totalBytes uint64

	for _, candidate := range attachments {
		if candidate == nil {
			return nil, attachmentRejected("attachment reference is required")
		}
		attachmentID := strings.TrimSpace(candidate.GetAttachmentId())
		if attachmentID == "" {
			return nil, attachmentRejected("attachment_id is required")
		}
		if _, exists := seenIDs[attachmentID]; exists {
			return nil, attachmentRejected("duplicate attachment_id")
		}
		seenIDs[attachmentID] = struct{}{}
		if strings.TrimSpace(candidate.GetExtractedContentRef()) != "" {
			return nil, attachmentRejected("extracted_content_ref is Station-owned")
		}

		if strings.TrimSpace(candidate.GetAuthorizationScope()) != expectedScope {
			return nil, attachmentRejected("attachment authorization scope is invalid")
		}
		if candidate.GetExpiresAt() == nil || !candidate.GetExpiresAt().IsValid() ||
			!candidate.GetExpiresAt().AsTime().After(now) {
			return nil, attachmentRejected("attachment reference is expired")
		}

		objectKey, err := attachmentObjectKey(candidate.GetObjectRef())
		if err != nil {
			return nil, attachmentRejected(err.Error())
		}
		meta, body, err := s.objects.ReadOwnedFile(ctx, actorID, objectKey, maxBytes-totalBytes)
		if err != nil || meta == nil {
			return nil, attachmentRejected("attachment object is unavailable")
		}
		if meta.OwnerActorID != strings.TrimSpace(actorID) ||
			meta.Visibility != ossmodel.VisibilityPrivate ||
			meta.DeletedAt != nil {
			return nil, attachmentRejected("attachment object is unauthorized")
		}
		if meta.ExpiresAt != nil {
			if !meta.ExpiresAt.After(now) || candidate.GetExpiresAt().AsTime().After(*meta.ExpiresAt) {
				return nil, attachmentRejected("attachment object is expired")
			}
		}

		mimeType := strings.ToLower(strings.TrimSpace(candidate.GetMimeType()))
		if mimeType != strings.ToLower(strings.TrimSpace(meta.Mime)) {
			return nil, attachmentRejected("attachment MIME metadata does not match stored object")
		}
		if !attachmentMimeAllowed(mimeType) {
			return nil, attachmentRejected("attachment MIME is unsupported")
		}
		if !attachmentContentMatches(mimeType, body) {
			return nil, attachmentRejected("attachment content does not match MIME")
		}
		if meta.Size < 0 || candidate.GetSizeBytes() != uint64(meta.Size) {
			return nil, attachmentRejected("attachment size metadata does not match stored object")
		}
		totalBytes += candidate.GetSizeBytes()
		if maxBytes == 0 || totalBytes > maxBytes {
			return nil, attachmentRejected("attachment bytes exceed model or turn budget")
		}

		checksum := normalizedSHA256(candidate.GetChecksum())
		if checksum == "" || checksum != normalizedSHA256(meta.Sha256) {
			return nil, attachmentRejected("attachment checksum does not match stored object")
		}
		bodyChecksum := sha256.Sum256(body)
		if checksum != hex.EncodeToString(bodyChecksum[:]) {
			return nil, attachmentRejected("attachment body checksum does not match stored object")
		}

		normalized := proto.Clone(candidate).(*model.AgentAttachmentRef)
		normalized.MimeType = mimeType
		normalized.SizeBytes = uint64(meta.Size)
		normalized.Checksum = "sha256:" + checksum
		normalized.Filename = strings.TrimSpace(meta.Name)
		normalized.AuthorizationScope = expectedScope
		admitted = append(admitted, AdmittedAttachment{
			Ref:            normalized,
			Body:           append([]byte(nil), body...),
			OmissionReason: attachmentOmissionReason(mimeType, capabilities.GetInput()),
		})
	}

	return admitted, nil
}

func attachmentObjectKey(objectRef string) (string, error) {
	ref := strings.TrimSpace(objectRef)
	if !strings.HasPrefix(ref, agentAttachmentObjectPrefix) {
		return "", fmt.Errorf("attachment object_ref must be an opaque OSS reference")
	}
	key := strings.TrimSpace(strings.TrimPrefix(ref, agentAttachmentObjectPrefix))
	if key == "" || strings.HasPrefix(key, "/") || strings.Contains(key, `\`) ||
		strings.Contains(key, "://") || strings.Contains(key, "..") {
		return "", fmt.Errorf("attachment object_ref is invalid")
	}
	return key, nil
}

func attachmentMimeAllowed(mimeType string) bool {
	switch mimeType {
	case "image/png", "application/pdf":
		return true
	default:
		return false
	}
}

func attachmentContentMatches(mimeType string, body []byte) bool {
	switch mimeType {
	case "image/png":
		return bytes.HasPrefix(body, []byte{137, 80, 78, 71, 13, 10, 26, 10})
	case "application/pdf":
		return bytes.HasPrefix(body, []byte("%PDF-"))
	default:
		return false
	}
}

func attachmentOmissionReason(
	mimeType string,
	input *model.RuntimeInputCapabilities,
) string {
	if mimeType == "image/png" && !input.GetImage() {
		return "selected_model_has_no_image_input"
	}
	if mimeType == "application/pdf" && !input.GetFile() {
		return "selected_model_has_no_file_input"
	}
	return "provider_adapter_binary_not_available"
}

func normalizedSHA256(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "sha256:")
	if len(value) != sha256.Size*2 {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	return value
}

func attachmentRejected(message string) error {
	reasonCode := strings.NewReplacer(" ", "_", "-", "_").Replace(
		strings.ToLower(strings.TrimSpace(message)),
	)
	return errcode.NewAttachmentRejected(reasonCode)
}

func attachmentRefs(attachments []AdmittedAttachment) []*model.AgentAttachmentRef {
	refs := make([]*model.AgentAttachmentRef, 0, len(attachments))
	for _, attachment := range attachments {
		refs = append(refs, attachment.Ref)
	}
	return refs
}

func attachmentContextSegments(attachments []AdmittedAttachment) []ContextSegment {
	segments := make([]ContextSegment, 0, len(attachments))
	for _, admitted := range attachments {
		attachment := admitted.Ref
		if attachment == nil {
			continue
		}
		segments = append(segments, ContextSegment{
			Type:            model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_ATTACHMENT,
			Content:         attachmentProviderSummary(attachment),
			SourceRefs:      []string{"attachment:" + attachment.GetAttachmentId()},
			ContentHash:     normalizedSHA256(attachment.GetChecksum()),
			EstimatedTokens: 0,
			Decision:        model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED,
			DecisionReason:  admitted.OmissionReason,
		})
	}
	return segments
}

func attachmentProviderSummary(attachment *model.AgentAttachmentRef) string {
	return fmt.Sprintf(
		"User attachment %q: MIME %s, %d bytes, attachment ID %s.",
		strings.TrimSpace(attachment.GetFilename()),
		strings.TrimSpace(attachment.GetMimeType()),
		attachment.GetSizeBytes(),
		strings.TrimSpace(attachment.GetAttachmentId()),
	)
}
