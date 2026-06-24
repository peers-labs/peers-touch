package model

import (
	"time"
)

// Applet represents the metadata of an application extension
type Applet struct {
	ID          string `gorm:"primaryKey;type:varchar(64)" json:"id"`
	Name        string `gorm:"type:varchar(128);not null" json:"name"`
	Description string `gorm:"type:text" json:"description"`
	Icon        string `gorm:"type:varchar(255)" json:"icon"`
	DeveloperID string `gorm:"type:varchar(64);index" json:"developer_id"`
	Status      int32  `gorm:"default:2;index" json:"status"`

	// Statistics
	DownloadCount int64 `gorm:"default:0" json:"download_count"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Computed fields
	LatestVersionURL string `gorm:"-" json:"latest_version_url,omitempty"`
}

// AppletVersion represents a specific version of an applet
type AppletVersion struct {
	ID       string `gorm:"primaryKey;type:varchar(64)" json:"id"`
	AppletID string `gorm:"type:varchar(64);not null;index" json:"applet_id"`
	Version  string `gorm:"type:varchar(32);not null" json:"version"` // e.g. "1.0.0"

	// Bundle information
	BundleHash     string `gorm:"type:varchar(128)" json:"bundle_hash"` // SHA256 of the JS bundle
	BundleSize     int64  `json:"bundle_size"`
	BundlePath     string `gorm:"type:varchar(255)" json:"bundle_path"`   // Relative path
	BundleDomain   string `gorm:"type:varchar(255)" json:"bundle_domain"` // Domain part
	StorageBackend string `gorm:"type:varchar(64)" json:"storage_backend"`

	// Computed field for API response
	BundleURL string `gorm:"-" json:"bundle_url"`

	// Requirements
	MinSDKVersion string `gorm:"type:varchar(32)" json:"min_sdk_version"`

	// Changelog
	Changelog string `gorm:"type:text" json:"changelog"`

	// Status: "published", "draft", "deprecated"
	Status  int32 `gorm:"default:2;index" json:"status"`
	Channel int32 `gorm:"default:1;index" json:"channel"`

	CreatedAt time.Time `json:"created_at"`
}

type AppletManifest struct {
	ID              string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	AppletID        string    `gorm:"type:varchar(64);not null;index" json:"applet_id"`
	VersionID       string    `gorm:"type:varchar(64);not null;uniqueIndex" json:"version_id"`
	Version         string    `gorm:"type:varchar(32);not null;index" json:"version"`
	ManifestJSON    string    `gorm:"type:text;not null" json:"manifest_json"`
	TargetPlatforms string    `gorm:"type:text" json:"target_platforms"`
	Permissions     string    `gorm:"type:text" json:"permissions"`
	Capabilities    string    `gorm:"type:text" json:"capabilities"`
	IntegrityJSON   string    `gorm:"type:text" json:"integrity_json"`
	BridgeProtocol  string    `gorm:"type:varchar(64)" json:"bridge_protocol"`
	RuntimeType     string    `gorm:"type:varchar(32)" json:"runtime_type"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type AppletBundleAsset struct {
	ID          string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	VersionID   string    `gorm:"type:varchar(64);not null;index" json:"version_id"`
	Path        string    `gorm:"type:varchar(255);not null" json:"path"`
	SHA256      string    `gorm:"type:varchar(128);not null" json:"sha256"`
	SizeBytes   int64     `json:"size_bytes"`
	ContentType string    `gorm:"type:varchar(128)" json:"content_type"`
	CreatedAt   time.Time `json:"created_at"`
}

type AppletVersionChannel struct {
	ID              string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	AppletID        string    `gorm:"type:varchar(64);not null;index" json:"applet_id"`
	Channel         int32     `gorm:"not null;index" json:"channel"`
	Version         string    `gorm:"type:varchar(32);not null" json:"version"`
	RolloutPercent  int32     `gorm:"default:100" json:"rollout_percent"`
	Enabled         bool      `gorm:"default:true" json:"enabled"`
	RollbackVersion string    `gorm:"type:varchar(32)" json:"rollback_version"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type AppletInstallState struct {
	ID           string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	ActorID      string    `gorm:"type:varchar(64);not null;index:idx_applet_install_actor_device" json:"actor_id"`
	DeviceID     string    `gorm:"type:varchar(128);index:idx_applet_install_actor_device" json:"device_id"`
	AppletID     string    `gorm:"type:varchar(64);not null;index:idx_applet_install_identity,unique" json:"applet_id"`
	Version      string    `gorm:"type:varchar(32);not null" json:"version"`
	Channel      int32     `gorm:"default:1" json:"channel"`
	Status       int32     `gorm:"default:1;index" json:"status"`
	ConfigJSON   string    `gorm:"type:text" json:"config_json"`
	StatusReason string    `gorm:"type:text" json:"status_reason"`
	InstalledAt  time.Time `json:"installed_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type AppletCapabilityPolicy struct {
	ID              string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	PolicyID        string    `gorm:"type:varchar(64);not null;index" json:"policy_id"`
	AppletID        string    `gorm:"type:varchar(64);not null;index" json:"applet_id"`
	Version         string    `gorm:"type:varchar(32);not null;index" json:"version"`
	Capability      string    `gorm:"type:varchar(128);not null" json:"capability"`
	MethodsJSON     string    `gorm:"type:text" json:"methods_json"`
	Decision        int32     `gorm:"not null" json:"decision"`
	Reason          string    `gorm:"type:text" json:"reason"`
	MaxPayloadBytes int64     `json:"max_payload_bytes"`
	TimeoutMs       int32     `json:"timeout_ms"`
	QuotaPerMinute  int32     `json:"quota_per_minute"`
	CreatedAt       time.Time `json:"created_at"`
}

type AppletServicePolicy struct {
	ID                 string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	PolicyID           string    `gorm:"type:varchar(64);not null;index" json:"policy_id"`
	AppletID           string    `gorm:"type:varchar(64);not null;index" json:"applet_id"`
	Version            string    `gorm:"type:varchar(32);not null;index" json:"version"`
	ServiceID          string    `gorm:"type:varchar(128);not null" json:"service_id"`
	Kind               string    `gorm:"type:varchar(64)" json:"kind"`
	AllowedMethodsJSON string    `gorm:"type:text" json:"allowed_methods_json"`
	AllowedPathsJSON   string    `gorm:"type:text" json:"allowed_paths_json"`
	Streaming          bool      `json:"streaming"`
	StationPathPrefix  string    `gorm:"type:varchar(255)" json:"station_path_prefix"`
	Decision           int32     `gorm:"not null" json:"decision"`
	CreatedAt          time.Time `json:"created_at"`
}

type AppletAuditRecord struct {
	ID           string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	AuditID      string    `gorm:"type:varchar(128);not null;uniqueIndex" json:"audit_id"`
	ActorID      string    `gorm:"type:varchar(64);index" json:"actor_id"`
	DeviceID     string    `gorm:"type:varchar(128);index" json:"device_id"`
	AppletID     string    `gorm:"type:varchar(64);index" json:"applet_id"`
	Version      string    `gorm:"type:varchar(32)" json:"version"`
	SessionID    string    `gorm:"type:varchar(128);index" json:"session_id"`
	Capability   string    `gorm:"type:varchar(128)" json:"capability"`
	Method       string    `gorm:"type:varchar(128)" json:"method"`
	Decision     int32     `gorm:"index" json:"decision"`
	Reason       string    `gorm:"type:text" json:"reason"`
	MetadataJSON string    `gorm:"type:text" json:"metadata_json"`
	RecordedAt   time.Time `gorm:"index" json:"recorded_at"`
	CreatedAt    time.Time `json:"created_at"`
}

func StoreModels() []any {
	return []any{
		&Applet{},
		&AppletVersion{},
		&AppletManifest{},
		&AppletBundleAsset{},
		&AppletVersionChannel{},
		&AppletInstallState{},
		&AppletCapabilityPolicy{},
		&AppletServicePolicy{},
		&AppletAuditRecord{},
	}
}
