package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var (
	attachmentTestBody     = append([]byte{137, 80, 78, 71, 13, 10, 26, 10}, []byte("actor-private png attachment body")...)
	attachmentTestChecksum = func() string {
		sum := sha256.Sum256(attachmentTestBody)
		return hex.EncodeToString(sum[:])
	}()
)

type attachmentMetadataReaderStub struct {
	meta  *ossmodel.FileMeta
	body  []byte
	err   error
	calls int
}

func (s *attachmentMetadataReaderStub) ReadOwnedFile(context.Context, string, string, uint64) (*ossmodel.FileMeta, []byte, error) {
	s.calls++
	return s.meta, append([]byte(nil), s.body...), s.err
}

func TestAttachmentAdmissionAcceptsActorPrivateObject(t *testing.T) {
	now := time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC)
	objectExpiry := now.Add(time.Hour)
	reader := &attachmentMetadataReaderStub{meta: &ossmodel.FileMeta{
		Key:        "cas/01/object",
		Name:       "diagram.png",
		Size:       int64(len(attachmentTestBody)),
		Mime:       "image/png",
		Sha256:     attachmentTestChecksum,
		OwnerPTID:  "actor-1",
		Visibility: ossmodel.VisibilityPrivate,
		ExpiresAt:  &objectExpiry,
	}, body: attachmentTestBody}
	admission := NewAttachmentAdmissionService(reader)
	admission.now = func() time.Time { return now }

	attachments, err := admission.Admit(
		context.Background(),
		"actor-1",
		"conversation-1",
		[]*model.AgentAttachmentRef{validAttachment(now)},
		attachmentCapabilities(true, true, 4, 1024),
		&model.RuntimeBudget{MaxAttachmentBytes: 512},
	)
	if err != nil {
		t.Fatalf("admit attachment: %v", err)
	}
	if reader.calls != 1 || len(attachments) != 1 {
		t.Fatalf("unexpected admission result: calls=%d attachments=%d", reader.calls, len(attachments))
	}
	if attachments[0].Ref.GetFilename() != "diagram.png" ||
		attachments[0].Ref.GetChecksum() != "sha256:"+attachmentTestChecksum ||
		string(attachments[0].Body) != string(attachmentTestBody) {
		t.Fatalf("attachment was not normalized from OSS metadata: %+v", attachments[0])
	}

	segments := attachmentContextSegments(attachments)
	if len(segments) != 1 ||
		segments[0].Type != model.ContextSegmentType_CONTEXT_SEGMENT_TYPE_ATTACHMENT ||
		segments[0].Decision != model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED ||
		segments[0].DecisionReason != "provider_adapter_binary_not_available" ||
		len(segments[0].SourceRefs) != 1 ||
		segments[0].SourceRefs[0] != "attachment:attachment-1" ||
		strings.Contains(segments[0].Content, "cas/01/object") {
		t.Fatalf("attachment attribution leaked storage identity: %+v", segments)
	}
}

func TestAttachmentAdmissionRejectsBeforeObjectUseWhenCountExceedsCapability(t *testing.T) {
	now := time.Now().UTC()
	reader := &attachmentMetadataReaderStub{}
	admission := NewAttachmentAdmissionService(reader)
	admission.now = func() time.Time { return now }

	_, err := admission.Admit(
		context.Background(),
		"actor-1",
		"conversation-1",
		[]*model.AgentAttachmentRef{validAttachment(now), validAttachment(now)},
		attachmentCapabilities(true, true, 1, 1024),
		nil,
	)
	if err == nil || reader.calls != 0 {
		t.Fatalf("count rejection must happen before OSS lookup: err=%v calls=%d", err, reader.calls)
	}
}

func TestAttachmentAdmissionRejectsInvalidAuthorityAndMetadata(t *testing.T) {
	now := time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC)
	future := now.Add(time.Hour)
	baseMeta := ossmodel.FileMeta{
		Key:        "cas/01/object",
		Name:       "diagram.png",
		Size:       int64(len(attachmentTestBody)),
		Mime:       "image/png",
		Sha256:     attachmentTestChecksum,
		OwnerPTID:  "actor-1",
		Visibility: ossmodel.VisibilityPrivate,
		ExpiresAt:  &future,
	}

	tests := []struct {
		name       string
		mutateRef  func(*model.AgentAttachmentRef)
		mutateMeta func(*ossmodel.FileMeta)
		caps       *model.RuntimeCapabilitySnapshot
	}{
		{name: "foreign owner", mutateMeta: func(meta *ossmodel.FileMeta) { meta.OwnerPTID = "actor-2" }},
		{name: "non-private object", mutateMeta: func(meta *ossmodel.FileMeta) { meta.Visibility = ossmodel.VisibilityPublic }},
		{name: "expired object", mutateMeta: func(meta *ossmodel.FileMeta) {
			expired := now.Add(-time.Second)
			meta.ExpiresAt = &expired
		}},
		{name: "checksum mismatch", mutateRef: func(ref *model.AgentAttachmentRef) {
			ref.Checksum = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		}},
		{name: "MIME mismatch", mutateRef: func(ref *model.AgentAttachmentRef) { ref.MimeType = "application/pdf" }},
		{name: "unsupported MIME", mutateRef: func(ref *model.AgentAttachmentRef) {
			ref.MimeType = "application/zip"
		}, mutateMeta: func(meta *ossmodel.FileMeta) {
			meta.Mime = "application/zip"
		}},
		{name: "byte budget", caps: attachmentCapabilities(true, true, 4, uint64(len(attachmentTestBody)-1))},
		{name: "wrong scope", mutateRef: func(ref *model.AgentAttachmentRef) {
			ref.AuthorizationScope = "conversation:conversation-2"
		}},
		{name: "client supplied extraction ref", mutateRef: func(ref *model.AgentAttachmentRef) {
			ref.ExtractedContentRef = "file:///tmp/extracted.txt"
		}},
		{name: "raw path", mutateRef: func(ref *model.AgentAttachmentRef) { ref.ObjectRef = "/tmp/diagram.png" }},
		{name: "arbitrary URL", mutateRef: func(ref *model.AgentAttachmentRef) {
			ref.ObjectRef = "https://example.invalid/diagram.png"
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ref := validAttachment(now)
			meta := baseMeta
			if test.mutateRef != nil {
				test.mutateRef(ref)
			}
			if test.mutateMeta != nil {
				test.mutateMeta(&meta)
			}
			caps := test.caps
			if caps == nil {
				caps = attachmentCapabilities(true, true, 4, 1024)
			}
			admission := NewAttachmentAdmissionService(&attachmentMetadataReaderStub{meta: &meta, body: attachmentTestBody})
			admission.now = func() time.Time { return now }

			if _, err := admission.Admit(
				context.Background(),
				"actor-1",
				"conversation-1",
				[]*model.AgentAttachmentRef{ref},
				caps,
				nil,
			); err == nil {
				t.Fatal("expected attachment rejection")
			}
		})
	}
}

func TestAttachmentAdmissionRecordsExplicitModelOmission(t *testing.T) {
	now := time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC)
	objectExpiry := now.Add(time.Hour)
	admission := NewAttachmentAdmissionService(&attachmentMetadataReaderStub{
		meta: &ossmodel.FileMeta{
			Key:        "cas/01/object",
			Name:       "diagram.png",
			Size:       int64(len(attachmentTestBody)),
			Mime:       "image/png",
			Sha256:     attachmentTestChecksum,
			OwnerPTID:  "actor-1",
			Visibility: ossmodel.VisibilityPrivate,
			ExpiresAt:  &objectExpiry,
		},
		body: attachmentTestBody,
	})
	admission.now = func() time.Time { return now }

	attachments, err := admission.Admit(
		context.Background(),
		"actor-1",
		"conversation-1",
		[]*model.AgentAttachmentRef{validAttachment(now)},
		attachmentCapabilities(false, false, 4, 1024),
		nil,
	)
	if err != nil {
		t.Fatalf("admit attachment for explicit omission: %v", err)
	}
	segments := attachmentContextSegments(attachments)
	if len(segments) != 1 ||
		segments[0].Decision != model.ContextSegmentDecision_CONTEXT_SEGMENT_DECISION_REJECTED ||
		segments[0].DecisionReason != "selected_model_has_no_image_input" {
		t.Fatalf("explicit omission segment = %+v", segments)
	}
}

func TestAttachmentAdmissionRejectsSpoofedMimeContent(t *testing.T) {
	now := time.Date(2026, time.August, 28, 12, 0, 0, 0, time.UTC)
	body := []byte("not a png")
	sum := sha256.Sum256(body)
	checksum := hex.EncodeToString(sum[:])
	objectExpiry := now.Add(time.Hour)
	admission := NewAttachmentAdmissionService(&attachmentMetadataReaderStub{
		meta: &ossmodel.FileMeta{
			Key:        "cas/01/object",
			Name:       "spoofed.png",
			Size:       int64(len(body)),
			Mime:       "image/png",
			Sha256:     checksum,
			OwnerPTID:  "actor-1",
			Visibility: ossmodel.VisibilityPrivate,
			ExpiresAt:  &objectExpiry,
		},
		body: body,
	})
	admission.now = func() time.Time { return now }
	ref := validAttachment(now)
	ref.SizeBytes = uint64(len(body))
	ref.Checksum = "sha256:" + checksum

	if _, err := admission.Admit(
		context.Background(),
		"actor-1",
		"conversation-1",
		[]*model.AgentAttachmentRef{ref},
		attachmentCapabilities(true, true, 4, 1024),
		nil,
	); err == nil {
		t.Fatal("expected spoofed PNG content to be rejected")
	}
}

func TestAttachmentAdmissionHidesStorageLookupFailure(t *testing.T) {
	now := time.Now().UTC()
	admission := NewAttachmentAdmissionService(&attachmentMetadataReaderStub{
		err:  errors.New("storage backend detail"),
		body: attachmentTestBody,
	})
	admission.now = func() time.Time { return now }

	_, err := admission.Admit(
		context.Background(),
		"actor-1",
		"conversation-1",
		[]*model.AgentAttachmentRef{validAttachment(now)},
		attachmentCapabilities(true, true, 4, 1024),
		nil,
	)
	if err == nil || strings.Contains(err.Error(), "storage backend detail") {
		t.Fatalf("storage failure must be rejected without leaking backend details: %v", err)
	}
}

func validAttachment(now time.Time) *model.AgentAttachmentRef {
	return &model.AgentAttachmentRef{
		AttachmentId:       "attachment-1",
		ObjectRef:          "oss:cas/01/object",
		MimeType:           "image/png",
		SizeBytes:          uint64(len(attachmentTestBody)),
		Checksum:           "sha256:" + attachmentTestChecksum,
		Filename:           "client-name.png",
		AuthorizationScope: "conversation:conversation-1",
		ExpiresAt:          timestamppb.New(now.Add(30 * time.Minute)),
	}
}

func attachmentCapabilities(
	image bool,
	file bool,
	count uint32,
	bytes uint64,
) *model.RuntimeCapabilitySnapshot {
	return &model.RuntimeCapabilitySnapshot{
		Input: &model.RuntimeInputCapabilities{
			Text:  true,
			Image: image,
			File:  file,
		},
		Limits: &model.RuntimeCapabilityLimits{
			AttachmentCount: count,
			AttachmentBytes: bytes,
		},
	}
}
