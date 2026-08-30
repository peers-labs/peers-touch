package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	dbmodel "github.com/peers-labs/peers-touch/station/app/subserver/applet_store/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/storage"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type StoreService struct {
	db      *gorm.DB
	storage *storage.LocalStorage
}

func NewStoreService(db *gorm.DB, storagePath string) *StoreService {
	return &StoreService{
		db:      db,
		storage: storage.NewLocalStorage(storagePath),
	}
}

func (s *StoreService) Migrate() error {
	if err := migrateAppletStoreIdentityColumns(s.db); err != nil {
		return err
	}
	if err := s.db.AutoMigrate(dbmodel.StoreModels()...); err != nil {
		return fmt.Errorf("applet store: migrate schema: %w", err)
	}
	return nil
}

func migrateAppletStoreIdentityColumns(rds *gorm.DB) error {
	return rds.Transaction(func(tx *gorm.DB) error {
		for _, rename := range []struct {
			table string
			from  string
			to    string
		}{
			{table: "applet_install_states", from: "actor_id", to: "actor_ptid"},
			{table: "applet_audit_records", from: "actor_id", to: "actor_ptid"},
		} {
			if err := modeldb.MigrateStringIdentityColumn(tx, rename.table, rename.from, rename.to); err != nil {
				return fmt.Errorf(
					"applet store: rename legacy identity column %s.%s to %s: %w",
					rename.table,
					rename.from,
					rename.to,
					err,
				)
			}
		}
		return nil
	})
}

// ListApplets returns a list of published applets
func (s *StoreService) ListApplets(limit, offset int) ([]dbmodel.Applet, error) {
	var applets []dbmodel.Applet
	result := s.db.
		Where("status <> ?", int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_REVOKED)).
		Limit(limit).
		Offset(offset).
		Order("download_count desc").
		Find(&applets)
	for i := range applets {
		var latestVersion dbmodel.AppletVersion
		if err := s.db.Where("applet_id = ? AND status = ?", applets[i].ID, int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED)).
			Order("created_at desc").
			First(&latestVersion).Error; err == nil {
			applets[i].LatestVersionURL = bundleURL(latestVersion)
		}
	}
	return applets, result.Error
}

// GetAppletDetails returns applet info and its latest version
func (s *StoreService) GetAppletDetails(appletID string) (*dbmodel.Applet, *dbmodel.AppletVersion, error) {
	var applet dbmodel.Applet
	if err := s.db.First(&applet, "id = ?", appletID).Error; err != nil {
		return nil, nil, err
	}

	var latestVersion dbmodel.AppletVersion
	err := s.db.Where("applet_id = ? AND status = ?", appletID, int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED)).
		Order("created_at desc").
		First(&latestVersion).Error

	if err == gorm.ErrRecordNotFound {
		return &applet, nil, nil
	}

	return &applet, &latestVersion, err
}

// PublishApplet creates a new applet or updates a new version
// This legacy multipart path remains for compatibility; typed publish should use the proto fields.
func (s *StoreService) PublishApplet(
	name, description, version, developerID string,
	bundleFile multipart.File, bundleHeader *multipart.FileHeader,
) (*dbmodel.AppletVersion, error) {

	var applet dbmodel.Applet
	err := s.db.Where("name = ? AND developer_id = ?", name, developerID).First(&applet).Error
	if err == gorm.ErrRecordNotFound {
		applet = dbmodel.Applet{
			ID:          uuid.New().String(),
			Name:        name,
			Description: description,
			DeveloperID: developerID,
			Status:      int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED),
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		if err := s.db.Create(&applet).Error; err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}

	filename := fmt.Sprintf("%s_%s.js", applet.ID, version)
	savedPath, err := s.storage.SaveFile(bundleFile, filename)
	if err != nil {
		return nil, err
	}

	appletVersion := dbmodel.AppletVersion{
		ID:             uuid.New().String(),
		AppletID:       applet.ID,
		Version:        version,
		BundlePath:     savedPath,
		BundleDomain:   "",
		StorageBackend: "local",
		BundleSize:     bundleHeader.Size,
		Status:         int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED),
		Channel:        int32(model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE),
		CreatedAt:      time.Now(),
	}

	if err := s.db.Create(&appletVersion).Error; err != nil {
		return nil, err
	}

	appletVersion.BundleURL = bundleURL(appletVersion)

	return &appletVersion, nil
}

func (s *StoreService) SaveBundleFromPath(appletID, version, sourcePath, relativePath, expectedDigest string) (*model.BundleStorage, error) {
	source, err := os.Open(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("open bundle source: %w", err)
	}
	defer source.Close()

	digest, size, err := hashReader(source)
	if err != nil {
		return nil, fmt.Errorf("hash bundle source: %w", err)
	}
	if expectedDigest != "" && expectedDigest != digest {
		return nil, fmt.Errorf("bundle integrity mismatch: expected %s got %s", expectedDigest, digest)
	}
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("rewind bundle source: %w", err)
	}

	if strings.TrimSpace(relativePath) == "" {
		relativePath = filepath.Base(sourcePath)
	}
	filename := filepath.Join(appletID, version, relativePath)
	savedPath, err := s.storage.SaveFile(source, filename)
	if err != nil {
		return nil, fmt.Errorf("save bundle: %w", err)
	}
	return &model.BundleStorage{
		BundleUri:       savedPath,
		BundleSha256:    digest,
		BundleSizeBytes: size,
		StorageBackend:  "local",
	}, nil
}

func (s *StoreService) ResolveBundlePath(bundlePath string) (string, error) {
	return s.storage.ResolvePath(bundlePath)
}

func (s *StoreService) PublishAppletVersion(req *model.PublishAppletRequest) (*model.PublishAppletResponse, error) {
	if err := validatePublishRequest(req); err != nil {
		return nil, err
	}

	now := time.Now()
	appletID := strings.TrimSpace(req.GetAppletId())
	versionValue := strings.TrimSpace(req.GetVersion())
	channel := resolveChannel(req.GetChannel())
	versionID := appletID + "-" + versionValue
	isNewApplet := false

	err := s.db.Transaction(func(tx *gorm.DB) error {
		var applet dbmodel.Applet
		err := tx.First(&applet, "id = ?", appletID).Error
		if err == gorm.ErrRecordNotFound {
			isNewApplet = true
			applet = dbmodel.Applet{
				ID:          appletID,
				Name:        strings.TrimSpace(req.GetName()),
				Description: req.GetDescription(),
				DeveloperID: strings.TrimSpace(req.GetOwnerId()),
				Status:      int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED),
				CreatedAt:   now,
				UpdatedAt:   now,
			}
			if err := tx.Create(&applet).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else {
			applet.Name = strings.TrimSpace(req.GetName())
			applet.Description = req.GetDescription()
			applet.DeveloperID = strings.TrimSpace(req.GetOwnerId())
			applet.Status = int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED)
			applet.UpdatedAt = now
			if err := tx.Save(&applet).Error; err != nil {
				return err
			}
		}

		version := dbmodel.AppletVersion{
			ID:             versionID,
			AppletID:       appletID,
			Version:        versionValue,
			BundleHash:     req.GetBundle().GetBundleSha256(),
			BundleSize:     req.GetBundle().GetBundleSizeBytes(),
			BundlePath:     req.GetBundle().GetBundleUri(),
			StorageBackend: req.GetBundle().GetStorageBackend(),
			MinSDKVersion:  req.GetMinSdkVersion(),
			Changelog:      req.GetChangelog(),
			Status:         int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED),
			Channel:        int32(channel),
			CreatedAt:      now,
		}
		if version.StorageBackend == "" {
			version.StorageBackend = "local"
		}
		if err := tx.Save(&version).Error; err != nil {
			return err
		}

		if err := replaceManifest(tx, appletID, versionID, versionValue, req.GetManifest(), now); err != nil {
			return err
		}
		if err := replaceBundleAssets(tx, versionID, req.GetBundle().GetAssets(), now); err != nil {
			return err
		}
		if err := replaceChannel(tx, appletID, channel, versionValue, now); err != nil {
			return err
		}
		return replacePolicy(tx, appletID, versionValue, req.GetPolicy(), now)
	})
	if err != nil {
		return nil, err
	}

	version, err := s.resolveVersion(appletID, versionValue, channel)
	if err != nil {
		return nil, err
	}
	return &model.PublishAppletResponse{
		AppletId:    appletID,
		VersionId:   versionID,
		IsNewApplet: isNewApplet,
		Version:     s.toProtoVersionWithDetails(version),
	}, nil
}

func (s *StoreService) ListCatalog(req *model.ListAppletCatalogRequest) (*model.ListAppletCatalogResponse, error) {
	limit, offset := normalizeLimitOffset(req.GetLimit(), req.GetOffset())
	query := s.db.Model(&dbmodel.Applet{}).
		Where("applets.status <> ?", int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_REVOKED))
	if keyword := strings.TrimSpace(req.GetSearchKeyword()); keyword != "" {
		query = query.Where("applets.name LIKE ? OR applets.description LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var applets []dbmodel.Applet
	if err := query.Limit(limit).Offset(offset).Order("applets.download_count desc").Find(&applets).Error; err != nil {
		return nil, err
	}

	items := make([]*model.AppletCatalogItem, 0, len(applets))
	for _, applet := range applets {
		version, err := s.resolveVersion(applet.ID, "", req.GetChannel())
		if err != nil && err != gorm.ErrRecordNotFound {
			return nil, err
		}
		installState, err := s.findInstallState(req.GetActorPtid(), req.GetDeviceId(), applet.ID)
		if err != nil && err != gorm.ErrRecordNotFound {
			return nil, err
		}
		channels, err := s.listChannels(applet.ID)
		if err != nil {
			return nil, err
		}
		items = append(items, &model.AppletCatalogItem{
			Info:         toProtoAppletInfo(applet),
			Version:      s.toProtoVersionWithDetails(version),
			InstallState: toProtoInstallState(installState),
			Channels:     channels,
		})
	}

	return &model.ListAppletCatalogResponse{Items: items, TotalCount: total}, nil
}

func (s *StoreService) GetAppletVersion(req *model.GetAppletVersionRequest) (*model.GetAppletVersionResponse, error) {
	version, err := s.resolveVersion(req.GetAppletId(), req.GetVersion(), req.GetChannel())
	if err != nil {
		return nil, err
	}
	policy, err := s.loadPolicySet(version.AppletID, version.Version)
	if err != nil {
		return nil, err
	}
	return &model.GetAppletVersionResponse{Version: s.toProtoVersionWithDetails(version), Policy: policy}, nil
}

func (s *StoreService) InstallApplet(req *model.InstallAppletRequest) (*model.InstallAppletResponse, error) {
	version, err := s.resolveVersion(req.GetAppletId(), req.GetVersion(), req.GetChannel())
	if err != nil {
		return nil, err
	}
	configJSON, err := encodeStringMap(req.GetConfig())
	if err != nil {
		return nil, err
	}

	now := time.Now()
	state, err := s.findInstallState(req.GetActorPtid(), req.GetDeviceId(), req.GetAppletId())
	if err == gorm.ErrRecordNotFound {
		state = &dbmodel.AppletInstallState{
			ID:          uuid.New().String(),
			ActorPTID:   req.GetActorPtid(),
			DeviceID:    req.GetDeviceId(),
			AppletID:    req.GetAppletId(),
			InstalledAt: now,
		}
	} else if err != nil {
		return nil, err
	}

	state.Version = version.Version
	state.Channel = int32(resolveChannel(req.GetChannel()))
	state.Status = int32(model.AppletInstallStatus_APPLET_INSTALL_STATUS_INSTALLED)
	state.ConfigJSON = configJSON
	state.StatusReason = ""
	state.UpdatedAt = now

	if err := s.db.Save(state).Error; err != nil {
		return nil, err
	}
	return &model.InstallAppletResponse{State: toProtoInstallState(state)}, nil
}

func (s *StoreService) UninstallApplet(req *model.UninstallAppletRequest) (*model.UninstallAppletResponse, error) {
	state, err := s.findInstallState(req.GetActorPtid(), req.GetDeviceId(), req.GetAppletId())
	if err != nil {
		return nil, err
	}
	state.Status = int32(model.AppletInstallStatus_APPLET_INSTALL_STATUS_UNINSTALLED)
	state.StatusReason = "user_uninstalled"
	state.UpdatedAt = time.Now()
	if err := s.db.Save(state).Error; err != nil {
		return nil, err
	}
	return &model.UninstallAppletResponse{State: toProtoInstallState(state)}, nil
}

func (s *StoreService) ListInstalledApplets(req *model.ListInstalledAppletsRequest) (*model.ListInstalledAppletsResponse, error) {
	query := s.db.Where("actor_ptid = ? AND device_id = ?", req.GetActorPtid(), req.GetDeviceId())
	if !req.GetIncludeDisabled() {
		query = query.Where("status = ?", int32(model.AppletInstallStatus_APPLET_INSTALL_STATUS_INSTALLED))
	}
	var states []dbmodel.AppletInstallState
	if err := query.Order("updated_at desc").Find(&states).Error; err != nil {
		return nil, err
	}
	response := &model.ListInstalledAppletsResponse{States: make([]*model.AppletInstallState, 0, len(states))}
	for i := range states {
		response.States = append(response.States, toProtoInstallState(&states[i]))
	}
	return response, nil
}

func (s *StoreService) RevokeAppletVersion(req *model.RevokeAppletVersionRequest) (*model.RevokeAppletVersionResponse, error) {
	var version dbmodel.AppletVersion
	if err := s.db.Where("applet_id = ? AND version = ?", req.GetAppletId(), req.GetVersion()).First(&version).Error; err != nil {
		return nil, err
	}
	version.Status = int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_REVOKED)
	if err := s.db.Save(&version).Error; err != nil {
		return nil, err
	}
	if err := s.db.Model(&dbmodel.AppletInstallState{}).
		Where("applet_id = ? AND version = ?", req.GetAppletId(), req.GetVersion()).
		Updates(map[string]any{
			"status":        int32(model.AppletInstallStatus_APPLET_INSTALL_STATUS_REVOKED),
			"status_reason": req.GetReason(),
			"updated_at":    time.Now(),
		}).Error; err != nil {
		return nil, err
	}
	return &model.RevokeAppletVersionResponse{Version: toProtoVersion(&version)}, nil
}

func (s *StoreService) RollbackAppletChannel(req *model.RollbackAppletChannelRequest) (*model.RollbackAppletChannelResponse, error) {
	if _, err := s.resolveVersion(req.GetAppletId(), req.GetTargetVersion(), req.GetChannel()); err != nil {
		return nil, err
	}
	channel := int32(resolveChannel(req.GetChannel()))
	var row dbmodel.AppletVersionChannel
	err := s.db.Where("applet_id = ? AND channel = ?", req.GetAppletId(), channel).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		row = dbmodel.AppletVersionChannel{
			ID:       uuid.New().String(),
			AppletID: req.GetAppletId(),
			Channel:  channel,
		}
	} else if err != nil {
		return nil, err
	}
	row.RollbackVersion = row.Version
	row.Version = req.GetTargetVersion()
	row.Enabled = true
	row.RolloutPercent = 100
	row.UpdatedAt = time.Now()
	if err := s.db.Save(&row).Error; err != nil {
		return nil, err
	}
	return &model.RollbackAppletChannelResponse{Channel: toProtoChannel(row)}, nil
}

func (s *StoreService) IngestAppletAudit(req *model.IngestAppletAuditRequest) (*model.IngestAppletAuditResponse, error) {
	accepted := int32(0)
	rejected := make([]string, 0)
	for _, record := range req.GetRecords() {
		auditID := strings.TrimSpace(record.GetAuditId())
		if auditID == "" {
			auditID = uuid.New().String()
		}
		metadataJSON, err := encodeStringMap(record.GetMetadata())
		if err != nil {
			rejected = append(rejected, auditID)
			continue
		}
		row := dbmodel.AppletAuditRecord{
			ID:           uuid.New().String(),
			AuditID:      auditID,
			ActorPTID:    record.GetActorPtid(),
			DeviceID:     record.GetDeviceId(),
			AppletID:     record.GetAppletId(),
			Version:      record.GetVersion(),
			SessionID:    record.GetSessionId(),
			Capability:   record.GetCapability(),
			Method:       record.GetMethod(),
			Decision:     int32(record.GetDecision()),
			Reason:       record.GetReason(),
			MetadataJSON: metadataJSON,
			RecordedAt:   unixTime(record.GetRecordedAt()),
			CreatedAt:    time.Now(),
		}
		if err := s.db.Create(&row).Error; err != nil {
			rejected = append(rejected, auditID)
			continue
		}
		accepted++
	}
	return &model.IngestAppletAuditResponse{AcceptedCount: accepted, RejectedAuditIds: rejected}, nil
}

func (s *StoreService) QueryAppletAudit(req *model.QueryAppletAuditRequest) (*model.QueryAppletAuditResponse, error) {
	limit, offset := normalizeLimitOffset(req.GetLimit(), req.GetOffset())
	query := s.db.Model(&dbmodel.AppletAuditRecord{})
	if req.GetActorPtid() != "" {
		query = query.Where("actor_ptid = ?", req.GetActorPtid())
	}
	if req.GetDeviceId() != "" {
		query = query.Where("device_id = ?", req.GetDeviceId())
	}
	if req.GetAppletId() != "" {
		query = query.Where("applet_id = ?", req.GetAppletId())
	}
	if req.GetSessionId() != "" {
		query = query.Where("session_id = ?", req.GetSessionId())
	}
	if req.GetStartTime() > 0 {
		query = query.Where("recorded_at >= ?", unixTime(req.GetStartTime()))
	}
	if req.GetEndTime() > 0 {
		query = query.Where("recorded_at <= ?", unixTime(req.GetEndTime()))
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var rows []dbmodel.AppletAuditRecord
	if err := query.Order("recorded_at desc").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, err
	}
	records := make([]*model.AppletAuditRecord, 0, len(rows))
	for i := range rows {
		records = append(records, toProtoAudit(&rows[i]))
	}
	return &model.QueryAppletAuditResponse{Records: records, TotalCount: total}, nil
}

func (s *StoreService) resolveVersion(appletID, version string, channel model.AppletReleaseChannel) (*dbmodel.AppletVersion, error) {
	resolvedVersion := strings.TrimSpace(version)
	if resolvedVersion == "" {
		var channelRow dbmodel.AppletVersionChannel
		err := s.db.Where("applet_id = ? AND channel = ? AND enabled = ?", appletID, int32(resolveChannel(channel)), true).First(&channelRow).Error
		if err == nil {
			resolvedVersion = channelRow.Version
		} else if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}

	query := s.db.Where("applet_id = ? AND status = ?", appletID, int32(model.AppletPackageStatus_APPLET_PACKAGE_STATUS_PUBLISHED))
	if resolvedVersion != "" {
		query = query.Where("version = ?", resolvedVersion)
	} else {
		query = query.Where("channel = ?", int32(resolveChannel(channel))).Order("created_at desc")
	}
	var row dbmodel.AppletVersion
	if err := query.First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *StoreService) findInstallState(actorPTID, deviceID, appletID string) (*dbmodel.AppletInstallState, error) {
	var state dbmodel.AppletInstallState
	err := s.db.Where("actor_ptid = ? AND device_id = ? AND applet_id = ?", actorPTID, deviceID, appletID).First(&state).Error
	return &state, err
}

func (s *StoreService) listChannels(appletID string) ([]*model.AppletVersionChannel, error) {
	var rows []dbmodel.AppletVersionChannel
	if err := s.db.Where("applet_id = ?", appletID).Order("channel asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	channels := make([]*model.AppletVersionChannel, 0, len(rows))
	for _, row := range rows {
		channels = append(channels, toProtoChannel(row))
	}
	return channels, nil
}

func (s *StoreService) loadPolicySet(appletID, version string) (*model.AppletPolicySet, error) {
	var capabilities []dbmodel.AppletCapabilityPolicy
	if err := s.db.Where("applet_id = ? AND version = ?", appletID, version).Find(&capabilities).Error; err != nil {
		return nil, err
	}
	var services []dbmodel.AppletServicePolicy
	if err := s.db.Where("applet_id = ? AND version = ?", appletID, version).Find(&services).Error; err != nil {
		return nil, err
	}
	policy := &model.AppletPolicySet{
		AppletId: appletID,
		Version:  version,
	}
	for _, row := range capabilities {
		policy.PolicyId = row.PolicyID
		policy.CreatedAt = row.CreatedAt.Unix()
		policy.CapabilityPolicies = append(policy.CapabilityPolicies, &model.AppletCapabilityPolicy{
			Capability:      row.Capability,
			Methods:         decodeStringSlice(row.MethodsJSON),
			Decision:        model.AppletPolicyDecision(row.Decision),
			Reason:          row.Reason,
			MaxPayloadBytes: row.MaxPayloadBytes,
			TimeoutMs:       row.TimeoutMs,
			QuotaPerMinute:  row.QuotaPerMinute,
		})
	}
	for _, row := range services {
		policy.PolicyId = row.PolicyID
		policy.CreatedAt = row.CreatedAt.Unix()
		policy.ServicePolicies = append(policy.ServicePolicies, &model.AppletServicePolicy{
			ServiceId:         row.ServiceID,
			Kind:              row.Kind,
			AllowedMethods:    decodeStringSlice(row.AllowedMethodsJSON),
			AllowedPaths:      decodeStringSlice(row.AllowedPathsJSON),
			Streaming:         row.Streaming,
			StationPathPrefix: row.StationPathPrefix,
			Decision:          model.AppletPolicyDecision(row.Decision),
		})
	}
	return policy, nil
}

func toProtoAppletInfo(row dbmodel.Applet) *model.AppletInfo {
	return &model.AppletInfo{
		Id:            row.ID,
		Name:          row.Name,
		Description:   row.Description,
		IconUrl:       row.Icon,
		DeveloperId:   row.DeveloperID,
		DownloadCount: row.DownloadCount,
		LatestVersion: row.LatestVersionURL,
		UpdatedAt:     row.UpdatedAt.Unix(),
		Status:        model.AppletPackageStatus(row.Status),
	}
}

func toProtoVersion(row *dbmodel.AppletVersion) *model.AppletVersionInfo {
	if row == nil || row.ID == "" {
		return nil
	}
	return &model.AppletVersionInfo{
		Id:            row.ID,
		AppletId:      row.AppletID,
		Version:       row.Version,
		BundleUrl:     bundleURL(*row),
		BundleHash:    row.BundleHash,
		BundleSize:    row.BundleSize,
		MinSdkVersion: row.MinSDKVersion,
		Changelog:     row.Changelog,
		CreatedAt:     row.CreatedAt.Unix(),
		Status:        model.AppletPackageStatus(row.Status),
		Channel:       model.AppletReleaseChannel(row.Channel),
		Bundle: &model.BundleStorage{
			BundleUri:       row.BundlePath,
			BundleSha256:    row.BundleHash,
			BundleSizeBytes: row.BundleSize,
			StorageBackend:  row.StorageBackend,
		},
	}
}

func (s *StoreService) toProtoVersionWithDetails(row *dbmodel.AppletVersion) *model.AppletVersionInfo {
	info := toProtoVersion(row)
	if info == nil {
		return nil
	}

	var manifest dbmodel.AppletManifest
	if err := s.db.Where("version_id = ?", row.ID).First(&manifest).Error; err == nil {
		info.Manifest = &model.ManifestSnapshot{
			ManifestJson:    manifest.ManifestJSON,
			TargetPlatforms: decodeStringSlice(manifest.TargetPlatforms),
			Permissions:     decodeStringSlice(manifest.Permissions),
			Capabilities:    decodeStringSlice(manifest.Capabilities),
			Integrity:       decodeStringMap(manifest.IntegrityJSON),
			BridgeProtocol:  manifest.BridgeProtocol,
			RuntimeType:     manifest.RuntimeType,
		}
	}

	var assets []dbmodel.AppletBundleAsset
	if err := s.db.Where("version_id = ?", row.ID).Find(&assets).Error; err == nil {
		info.Bundle.Assets = make([]*model.BundleAssetIntegrity, 0, len(assets))
		for _, asset := range assets {
			info.Bundle.Assets = append(info.Bundle.Assets, &model.BundleAssetIntegrity{
				Path:        asset.Path,
				Sha256:      asset.SHA256,
				SizeBytes:   asset.SizeBytes,
				ContentType: asset.ContentType,
			})
		}
	}

	return info
}

func toProtoInstallState(row *dbmodel.AppletInstallState) *model.AppletInstallState {
	if row == nil || row.ID == "" {
		return nil
	}
	return &model.AppletInstallState{
		ActorPtid:    row.ActorPTID,
		DeviceId:     row.DeviceID,
		AppletId:     row.AppletID,
		Version:      row.Version,
		Channel:      model.AppletReleaseChannel(row.Channel),
		Status:       model.AppletInstallStatus(row.Status),
		Config:       decodeStringMap(row.ConfigJSON),
		InstalledAt:  row.InstalledAt.Unix(),
		UpdatedAt:    row.UpdatedAt.Unix(),
		StatusReason: row.StatusReason,
	}
}

func toProtoChannel(row dbmodel.AppletVersionChannel) *model.AppletVersionChannel {
	return &model.AppletVersionChannel{
		Channel:         model.AppletReleaseChannel(row.Channel),
		Version:         row.Version,
		RolloutPercent:  row.RolloutPercent,
		Enabled:         row.Enabled,
		RollbackVersion: row.RollbackVersion,
		UpdatedAt:       row.UpdatedAt.Unix(),
	}
}

func toProtoAudit(row *dbmodel.AppletAuditRecord) *model.AppletAuditRecord {
	return &model.AppletAuditRecord{
		AuditId:    row.AuditID,
		ActorPtid:  row.ActorPTID,
		DeviceId:   row.DeviceID,
		AppletId:   row.AppletID,
		Version:    row.Version,
		SessionId:  row.SessionID,
		Capability: row.Capability,
		Method:     row.Method,
		Decision:   model.AppletAuditDecision(row.Decision),
		Reason:     row.Reason,
		Metadata:   decodeStringMap(row.MetadataJSON),
		RecordedAt: row.RecordedAt.Unix(),
	}
}

func normalizeLimitOffset(limitValue int32, offsetValue int32) (int, int) {
	limit := int(limitValue)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := int(offsetValue)
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func resolveChannel(channel model.AppletReleaseChannel) model.AppletReleaseChannel {
	if channel == model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_UNSPECIFIED {
		return model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE
	}
	return channel
}

func bundleURL(version dbmodel.AppletVersion) string {
	if version.BundlePath == "" {
		return ""
	}
	if version.BundleDomain == "" {
		return "/api/v1/applets/bundle?path=" + version.BundlePath
	}
	return strings.TrimRight(version.BundleDomain, "/") + "/api/v1/applets/bundle?path=" + version.BundlePath
}

func encodeStringMap(value map[string]string) (string, error) {
	if len(value) == 0 {
		return "", nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeStringMap(raw string) map[string]string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var value map[string]string
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return value
}

func decodeStringSlice(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var value []string
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return value
}

func encodeStringSlice(value []string) (string, error) {
	if len(value) == 0 {
		return "", nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func hashReader(reader io.Reader) (string, int64, error) {
	hasher := sha256.New()
	size, err := io.Copy(hasher, reader)
	if err != nil {
		return "", 0, err
	}
	return "sha256:" + hex.EncodeToString(hasher.Sum(nil)), size, nil
}

func validatePublishRequest(req *model.PublishAppletRequest) error {
	if req == nil {
		return fmt.Errorf("publish request is required")
	}
	if strings.TrimSpace(req.GetAppletId()) == "" {
		return fmt.Errorf("applet_id is required")
	}
	if strings.TrimSpace(req.GetName()) == "" {
		return fmt.Errorf("name is required")
	}
	if strings.TrimSpace(req.GetVersion()) == "" {
		return fmt.Errorf("version is required")
	}
	if strings.TrimSpace(req.GetOwnerId()) == "" {
		return fmt.Errorf("owner_id is required")
	}
	if req.GetManifest() == nil || strings.TrimSpace(req.GetManifest().GetManifestJson()) == "" {
		return fmt.Errorf("manifest_json is required")
	}
	if req.GetBundle() == nil || strings.TrimSpace(req.GetBundle().GetBundleUri()) == "" {
		return fmt.Errorf("bundle_uri is required")
	}
	if strings.TrimSpace(req.GetBundle().GetBundleSha256()) == "" {
		return fmt.Errorf("bundle_sha256 is required")
	}
	return nil
}

func replaceManifest(tx *gorm.DB, appletID, versionID, version string, manifest *model.ManifestSnapshot, now time.Time) error {
	targetPlatforms, err := encodeStringSlice(manifest.GetTargetPlatforms())
	if err != nil {
		return err
	}
	permissions, err := encodeStringSlice(manifest.GetPermissions())
	if err != nil {
		return err
	}
	capabilities, err := encodeStringSlice(manifest.GetCapabilities())
	if err != nil {
		return err
	}
	integrityJSON, err := encodeStringMap(manifest.GetIntegrity())
	if err != nil {
		return err
	}
	if err := tx.Where("version_id = ?", versionID).Delete(&dbmodel.AppletManifest{}).Error; err != nil {
		return err
	}
	return tx.Create(&dbmodel.AppletManifest{
		ID:              uuid.New().String(),
		AppletID:        appletID,
		VersionID:       versionID,
		Version:         version,
		ManifestJSON:    manifest.GetManifestJson(),
		TargetPlatforms: targetPlatforms,
		Permissions:     permissions,
		Capabilities:    capabilities,
		IntegrityJSON:   integrityJSON,
		BridgeProtocol:  manifest.GetBridgeProtocol(),
		RuntimeType:     manifest.GetRuntimeType(),
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Error
}

func replaceBundleAssets(tx *gorm.DB, versionID string, assets []*model.BundleAssetIntegrity, now time.Time) error {
	if err := tx.Where("version_id = ?", versionID).Delete(&dbmodel.AppletBundleAsset{}).Error; err != nil {
		return err
	}
	for _, asset := range assets {
		if err := tx.Create(&dbmodel.AppletBundleAsset{
			ID:          uuid.New().String(),
			VersionID:   versionID,
			Path:        asset.GetPath(),
			SHA256:      asset.GetSha256(),
			SizeBytes:   asset.GetSizeBytes(),
			ContentType: asset.GetContentType(),
			CreatedAt:   now,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func replaceChannel(tx *gorm.DB, appletID string, channel model.AppletReleaseChannel, version string, now time.Time) error {
	var row dbmodel.AppletVersionChannel
	err := tx.Where("applet_id = ? AND channel = ?", appletID, int32(channel)).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		row = dbmodel.AppletVersionChannel{
			ID:       uuid.New().String(),
			AppletID: appletID,
			Channel:  int32(channel),
		}
	} else if err != nil {
		return err
	}
	row.Version = version
	row.RolloutPercent = 100
	row.Enabled = true
	row.UpdatedAt = now
	return tx.Save(&row).Error
}

func replacePolicy(tx *gorm.DB, appletID, version string, policy *model.AppletPolicySet, now time.Time) error {
	if err := tx.Where("applet_id = ? AND version = ?", appletID, version).Delete(&dbmodel.AppletCapabilityPolicy{}).Error; err != nil {
		return err
	}
	if err := tx.Where("applet_id = ? AND version = ?", appletID, version).Delete(&dbmodel.AppletServicePolicy{}).Error; err != nil {
		return err
	}
	if policy == nil {
		return nil
	}
	policyID := strings.TrimSpace(policy.GetPolicyId())
	if policyID == "" {
		policyID = appletID + "-" + version
	}
	for _, capability := range policy.GetCapabilityPolicies() {
		methodsJSON, err := encodeStringSlice(capability.GetMethods())
		if err != nil {
			return err
		}
		if err := tx.Create(&dbmodel.AppletCapabilityPolicy{
			ID:              uuid.New().String(),
			PolicyID:        policyID,
			AppletID:        appletID,
			Version:         version,
			Capability:      capability.GetCapability(),
			MethodsJSON:     methodsJSON,
			Decision:        int32(capability.GetDecision()),
			Reason:          capability.GetReason(),
			MaxPayloadBytes: capability.GetMaxPayloadBytes(),
			TimeoutMs:       capability.GetTimeoutMs(),
			QuotaPerMinute:  capability.GetQuotaPerMinute(),
			CreatedAt:       now,
		}).Error; err != nil {
			return err
		}
	}
	for _, servicePolicy := range policy.GetServicePolicies() {
		allowedMethodsJSON, err := encodeStringSlice(servicePolicy.GetAllowedMethods())
		if err != nil {
			return err
		}
		allowedPathsJSON, err := encodeStringSlice(servicePolicy.GetAllowedPaths())
		if err != nil {
			return err
		}
		if err := tx.Create(&dbmodel.AppletServicePolicy{
			ID:                 uuid.New().String(),
			PolicyID:           policyID,
			AppletID:           appletID,
			Version:            version,
			ServiceID:          servicePolicy.GetServiceId(),
			Kind:               servicePolicy.GetKind(),
			AllowedMethodsJSON: allowedMethodsJSON,
			AllowedPathsJSON:   allowedPathsJSON,
			Streaming:          servicePolicy.GetStreaming(),
			StationPathPrefix:  servicePolicy.GetStationPathPrefix(),
			Decision:           int32(servicePolicy.GetDecision()),
			CreatedAt:          now,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func unixTime(value int64) time.Time {
	if value <= 0 {
		return time.Now()
	}
	return time.Unix(value, 0)
}
