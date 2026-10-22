package oss

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/textproto"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
)

type TrustedAttachment struct {
	ObjectRef          string
	MIMEType           string
	SizeBytes          uint64
	Checksum           string
	FileName           string
	AuthorizationScope string
	ExpiresAt          time.Time
}

func (s *ossSubServer) ReadChannelAttachment(
	ctx context.Context,
	actorPTID, objectRef string,
	maxBytes uint64,
) (TrustedAttachment, []byte, error) {
	if s == nil || s.fileService == nil {
		return TrustedAttachment{}, nil, fmt.Errorf("OSS attachment service is unavailable")
	}
	key := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(objectRef), "oss:"))
	if key == "" || !strings.HasPrefix(strings.TrimSpace(objectRef), "oss:") {
		return TrustedAttachment{}, nil, fmt.Errorf("channel output reference is invalid")
	}
	meta, body, err := s.fileService.ReadOwnedFile(
		ctx, strings.TrimSpace(actorPTID), key, maxBytes,
	)
	if err != nil {
		return TrustedAttachment{}, nil, err
	}
	expiresAt := time.Now().UTC().Add(24 * time.Hour)
	if meta.ExpiresAt != nil {
		expiresAt = meta.ExpiresAt.UTC()
	}
	return TrustedAttachment{
		ObjectRef: "oss:" + meta.Key, MIMEType: meta.Mime,
		SizeBytes: uint64(meta.Size), Checksum: "sha256:" + meta.Sha256,
		FileName: meta.Name, ExpiresAt: expiresAt,
	}, body, nil
}

// StoreChannelAttachment is the narrow host interface used by the Agent
// channel adapter. It applies the same actor, bucket, visibility, quota,
// checksum and lifecycle rules as ordinary uploads.
func (s *ossSubServer) StoreChannelAttachment(
	ctx context.Context,
	actorPTID, conversationID, fileName, mimeType string,
	body []byte,
) (TrustedAttachment, error) {
	if s == nil || s.fileService == nil {
		return TrustedAttachment{}, fmt.Errorf("OSS attachment service is unavailable")
	}
	actorPTID = strings.TrimSpace(actorPTID)
	conversationID = strings.TrimSpace(conversationID)
	fileName = strings.TrimSpace(fileName)
	if actorPTID == "" || conversationID == "" || fileName == "" || len(body) == 0 {
		return TrustedAttachment{}, fmt.Errorf("channel attachment identity and body are required")
	}
	file := &memoryMultipartFile{Reader: *bytes.NewReader(body)}
	header := &multipart.FileHeader{
		Filename: fileName,
		Size:     int64(len(body)),
		Header:   textproto.MIMEHeader{"Content-Type": []string{strings.TrimSpace(mimeType)}},
	}
	meta, err := s.fileService.SaveFile(ctx, service.UploadAttribution{
		ActorPTID: actorPTID, BucketName: "chat",
		Visibility: model.VisibilityPrivate,
	}, file, header)
	if err != nil {
		return TrustedAttachment{}, err
	}
	expiresAt := time.Now().UTC().Add(24 * time.Hour)
	if meta.ExpiresAt != nil {
		expiresAt = meta.ExpiresAt.UTC()
	}
	return TrustedAttachment{
		ObjectRef: "oss:" + meta.Key, MIMEType: meta.Mime,
		SizeBytes: uint64(meta.Size), Checksum: "sha256:" + meta.Sha256,
		FileName: meta.Name, AuthorizationScope: "conversation:" + conversationID,
		ExpiresAt: expiresAt,
	}, nil
}

type memoryMultipartFile struct {
	bytes.Reader
}

func (f *memoryMultipartFile) Close() error { return nil }
