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

	// Statistics
	DownloadCount int64 `gorm:"default:0" json:"download_count"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AppletVersion represents a specific version of an applet
type AppletVersion struct {
	ID       string `gorm:"primaryKey;type:varchar(64)" json:"id"`
	AppletID string `gorm:"type:varchar(64);not null;index" json:"applet_id"`
	Version  string `gorm:"type:varchar(32);not null" json:"version"` // e.g. "1.0.0"

	// Bundle information
	BundleHash   string `gorm:"type:varchar(128)" json:"bundle_hash"` // SHA256 of the JS bundle
	BundleSize   int64  `json:"bundle_size"`
	BundlePath   string `gorm:"type:varchar(255)" json:"bundle_path"`   // Relative path
	BundleDomain string `gorm:"type:varchar(255)" json:"bundle_domain"` // Domain part

	// Computed field for API response
	BundleURL string `gorm:"-" json:"bundle_url"`

	// Requirements
	MinSDKVersion string `gorm:"type:varchar(32)" json:"min_sdk_version"`

	// Changelog
	Changelog string `gorm:"type:text" json:"changelog"`

	// Status: "published", "draft", "deprecated"
	Status string `gorm:"type:varchar(20);default:'published'" json:"status"`

	CreatedAt time.Time `json:"created_at"`
}
