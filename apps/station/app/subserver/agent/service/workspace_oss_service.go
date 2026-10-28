package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	ossservice "github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
)

// WorkspaceOSSService links TurnArtifact metadata to the existing OSS
// subserver. It never stores file bytes or creates a parallel object store.
type WorkspaceOSSService struct {
	turnService *TurnService
	fileService ossservice.FileService
}

func NewWorkspaceOSSService(
	turnService *TurnService,
	fileService ossservice.FileService,
) *WorkspaceOSSService {
	return &WorkspaceOSSService{
		turnService: turnService,
		fileService: fileService,
	}
}

func (s *WorkspaceOSSService) PrepareArtifactUpload(
	ctx context.Context,
	actorPTID string,
	req *model.PrepareTurnArtifactUploadRequest,
) (*model.PrepareTurnArtifactUploadResponse, error) {
	artifact, err := s.turnService.GetTurnArtifact(ctx, actorPTID, req.GetArtifactId())
	if err != nil {
		return nil, err
	}
	return &model.PrepareTurnArtifactUploadResponse{
		Artifact:         artifact,
		UploadEndpoint:   "/sub-oss/upload",
		CompleteEndpoint: "/sub-agent/agent/turn/artifact/upload/complete",
	}, nil
}

func (s *WorkspaceOSSService) CompleteArtifactUpload(
	ctx context.Context,
	actorPTID string,
	req *model.CompleteTurnArtifactUploadRequest,
) (*model.CompleteTurnArtifactUploadResponse, error) {
	if s.fileService == nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusServiceUnavailable, "OSS service is unavailable", nil)
	}
	row, err := s.turnService.getTurnArtifactRow(ctx, actorPTID, req.GetArtifactId())
	if err != nil {
		return nil, err
	}
	objectRef := strings.TrimSpace(req.GetStationObjectRef())
	if objectRef == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "station_object_ref is required", nil)
	}
	readLimit := row.Size
	if readLimit == 0 {
		readLimit = 1
	}
	meta, body, err := s.fileService.ReadOwnedFile(ctx, actorPTID, objectRef, readLimit)
	if err != nil {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "uploaded OSS object is unavailable", err)
	}
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	if meta.Size != int64(row.Size) || digest != row.SHA256 {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "uploaded OSS object does not match artifact", nil)
	}
	db, err := s.turnService.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	result := db.WithContext(ctx).
		Model(&persistence.TurnArtifact{}).
		Where("id = ? AND actor_ptid = ?", row.ID, actorPTID).
		Updates(map[string]any{
			"station_object_ref": objectRef,
			"updated_at":         now,
		})
	if result.Error != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to link artifact OSS object", result.Error)
	}
	row.StationObjectRef = objectRef
	row.UpdatedAt = now
	return &model.CompleteTurnArtifactUploadResponse{Artifact: turnArtifactToProto(row)}, nil
}

func (s *WorkspaceOSSService) GetArtifactDownload(
	ctx context.Context,
	actorPTID string,
	req *model.GetTurnArtifactDownloadRequest,
) (*model.GetTurnArtifactDownloadResponse, error) {
	artifact, err := s.turnService.GetTurnArtifact(ctx, actorPTID, req.GetArtifactId())
	if err != nil {
		return nil, err
	}
	objectRef := strings.TrimSpace(artifact.GetLocator().GetStationObjectRef())
	if objectRef == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusConflict, "artifact has no Station copy", nil)
	}
	return &model.GetTurnArtifactDownloadResponse{
		Artifact:    artifact,
		DownloadUrl: "/sub-oss/file?key=" + url.QueryEscape(objectRef),
	}, nil
}
