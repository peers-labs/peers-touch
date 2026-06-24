package applet_store

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type AppletHandlers struct {
	service *service.StoreService
}

func NewAppletHandlers(svc *service.StoreService) *AppletHandlers {
	return &AppletHandlers{
		service: svc,
	}
}

func (h *AppletHandlers) HandleListApplets(ctx context.Context, req *model.ListAppletsRequest) (*model.ListAppletsResponse, error) {
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	offset := int(req.Offset)
	if offset < 0 {
		offset = 0
	}

	applets, err := h.service.ListApplets(limit, offset)
	if err != nil {
		logger.Error(ctx, "Failed to list applets", "error", err)
		return nil, err
	}

	protoApplets := make([]*model.AppletInfo, 0, len(applets))
	for _, app := range applets {
		protoApplets = append(protoApplets, &model.AppletInfo{
			Id:            app.ID,
			Name:          app.Name,
			Description:   app.Description,
			IconUrl:       app.Icon,
			DeveloperId:   app.DeveloperID,
			DownloadCount: app.DownloadCount,
			LatestVersion: app.LatestVersionURL,
			UpdatedAt:     app.UpdatedAt.Unix(),
			Status:        model.AppletPackageStatus(app.Status),
		})
	}

	return &model.ListAppletsResponse{
		Applets:    protoApplets,
		TotalCount: int64(len(protoApplets)),
	}, nil
}

func (h *AppletHandlers) HandleGetAppletDetails(ctx context.Context, req *model.GetAppletDetailsRequest) (*model.GetAppletDetailsResponse, error) {
	if req.AppletId == "" {
		logger.Error(ctx, "Missing applet_id in request")
		return nil, &appletError{message: "applet_id is required"}
	}

	applet, version, err := h.service.GetAppletDetails(req.AppletId)
	if err != nil {
		logger.Error(ctx, "Failed to get applet details", "error", err, "applet_id", req.AppletId)
		return nil, err
	}

	response := &model.GetAppletDetailsResponse{}

	if applet != nil {
		response.Info = &model.AppletInfo{
			Id:            applet.ID,
			Name:          applet.Name,
			Description:   applet.Description,
			IconUrl:       applet.Icon,
			DeveloperId:   applet.DeveloperID,
			DownloadCount: applet.DownloadCount,
			LatestVersion: applet.LatestVersionURL,
			UpdatedAt:     applet.UpdatedAt.Unix(),
			Status:        model.AppletPackageStatus(applet.Status),
		}
	}

	if version != nil {
		response.LatestVersion = &model.AppletVersionInfo{
			Id:            version.ID,
			AppletId:      version.AppletID,
			Version:       version.Version,
			BundleUrl:     version.BundleURL,
			BundleHash:    version.BundleHash,
			BundleSize:    version.BundleSize,
			MinSdkVersion: version.MinSDKVersion,
			Changelog:     version.Changelog,
			CreatedAt:     version.CreatedAt.Unix(),
			Status:        model.AppletPackageStatus(version.Status),
			Channel:       model.AppletReleaseChannel(version.Channel),
		}
	}

	return response, nil
}

func (h *AppletHandlers) HandleListAppletCatalog(ctx context.Context, req *model.ListAppletCatalogRequest) (*model.ListAppletCatalogResponse, error) {
	response, err := h.service.ListCatalog(req)
	if err != nil {
		logger.Error(ctx, "Failed to list applet catalog", "error", err, "actor_id", req.GetActorId())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleGetAppletVersion(ctx context.Context, req *model.GetAppletVersionRequest) (*model.GetAppletVersionResponse, error) {
	response, err := h.service.GetAppletVersion(req)
	if err != nil {
		logger.Error(ctx, "Failed to get applet version", "error", err, "applet_id", req.GetAppletId(), "version", req.GetVersion())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandlePublishAppletVersion(ctx context.Context, req *model.PublishAppletRequest) (*model.PublishAppletResponse, error) {
	response, err := h.service.PublishAppletVersion(req)
	if err != nil {
		logger.Error(ctx, "Failed to publish applet version", "error", err, "applet_id", req.GetAppletId(), "version", req.GetVersion())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleInstallApplet(ctx context.Context, req *model.InstallAppletRequest) (*model.InstallAppletResponse, error) {
	response, err := h.service.InstallApplet(req)
	if err != nil {
		logger.Error(ctx, "Failed to install applet", "error", err, "actor_id", req.GetActorId(), "applet_id", req.GetAppletId())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleUninstallApplet(ctx context.Context, req *model.UninstallAppletRequest) (*model.UninstallAppletResponse, error) {
	response, err := h.service.UninstallApplet(req)
	if err != nil {
		logger.Error(ctx, "Failed to uninstall applet", "error", err, "actor_id", req.GetActorId(), "applet_id", req.GetAppletId())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleListInstalledApplets(ctx context.Context, req *model.ListInstalledAppletsRequest) (*model.ListInstalledAppletsResponse, error) {
	response, err := h.service.ListInstalledApplets(req)
	if err != nil {
		logger.Error(ctx, "Failed to list installed applets", "error", err, "actor_id", req.GetActorId())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleRevokeAppletVersion(ctx context.Context, req *model.RevokeAppletVersionRequest) (*model.RevokeAppletVersionResponse, error) {
	response, err := h.service.RevokeAppletVersion(req)
	if err != nil {
		logger.Error(ctx, "Failed to revoke applet version", "error", err, "applet_id", req.GetAppletId(), "version", req.GetVersion())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleRollbackAppletChannel(ctx context.Context, req *model.RollbackAppletChannelRequest) (*model.RollbackAppletChannelResponse, error) {
	response, err := h.service.RollbackAppletChannel(req)
	if err != nil {
		logger.Error(ctx, "Failed to rollback applet channel", "error", err, "applet_id", req.GetAppletId(), "target_version", req.GetTargetVersion())
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleIngestAppletAudit(ctx context.Context, req *model.IngestAppletAuditRequest) (*model.IngestAppletAuditResponse, error) {
	response, err := h.service.IngestAppletAudit(req)
	if err != nil {
		logger.Error(ctx, "Failed to ingest applet audit", "error", err, "records", len(req.GetRecords()))
		return nil, err
	}
	return response, nil
}

func (h *AppletHandlers) HandleQueryAppletAudit(ctx context.Context, req *model.QueryAppletAuditRequest) (*model.QueryAppletAuditResponse, error) {
	response, err := h.service.QueryAppletAudit(req)
	if err != nil {
		logger.Error(ctx, "Failed to query applet audit", "error", err, "applet_id", req.GetAppletId())
		return nil, err
	}
	return response, nil
}

type appletError struct {
	message string
}

func (e *appletError) Error() string {
	return e.message
}
