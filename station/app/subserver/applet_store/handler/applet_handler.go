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

	applets, err := h.service.GenerateMockApplets()
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
		}
	}

	return response, nil
}

type appletError struct {
	message string
}

func (e *appletError) Error() string {
	return e.message
}
