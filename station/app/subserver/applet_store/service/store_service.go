package service

import (
	"fmt"
	"mime/multipart"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/storage"
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

// ListApplets returns a list of published applets
func (s *StoreService) ListApplets(limit, offset int) ([]model.Applet, error) {
	var applets []model.Applet
	result := s.db.Limit(limit).Offset(offset).Order("download_count desc").Find(&applets)
	return applets, result.Error
}

// GetAppletDetails returns applet info and its latest version
func (s *StoreService) GetAppletDetails(appletID string) (*model.Applet, *model.AppletVersion, error) {
	var applet model.Applet
	if err := s.db.First(&applet, "id = ?", appletID).Error; err != nil {
		return nil, nil, err
	}

	var latestVersion model.AppletVersion
	// Simple version ordering by created_at for now
	err := s.db.Where("applet_id = ? AND status = ?", appletID, "published").
		Order("created_at desc").
		First(&latestVersion).Error

	if err == gorm.ErrRecordNotFound {
		return &applet, nil, nil
	}

	return &applet, &latestVersion, err
}

// PublishApplet creates a new applet or updates a new version
// This is a simplified implementation combining metadata creation and file upload
func (s *StoreService) PublishApplet(
	name, description, version, developerID string,
	bundleFile multipart.File, bundleHeader *multipart.FileHeader,
) (*model.AppletVersion, error) {

	// 1. Check if applet exists or create new
	var applet model.Applet
	err := s.db.Where("name = ? AND developer_id = ?", name, developerID).First(&applet).Error
	if err == gorm.ErrRecordNotFound {
		applet = model.Applet{
			ID:          uuid.New().String(),
			Name:        name,
			Description: description,
			DeveloperID: developerID,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		if err := s.db.Create(&applet).Error; err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}

	// 2. Save Bundle File
	filename := fmt.Sprintf("%s_%s.js", applet.ID, version)
	savedPath, err := s.storage.SaveFile(bundleFile, filename)
	if err != nil {
		return nil, err
	}

	// Calculate Hash (Simple placeholder, real impl should stream and calc)
	// bundleHash := calculateHash(bundleFile)

	// 3. Create Version Record
	appletVersion := model.AppletVersion{
		ID:        uuid.New().String(),
		AppletID:  applet.ID,
		Version:   version,
		BundleURL: savedPath, // In real world, this should be a public URL
		// BundleHash: bundleHash,
		BundleSize: bundleHeader.Size,
		Status:     "published",
		CreatedAt:  time.Now(),
	}

	if err := s.db.Create(&appletVersion).Error; err != nil {
		return nil, err
	}

	return &appletVersion, nil
}

// GenerateMockApplets creates mock data for demo purposes
// It returns a list of applets that point to the native templates
func (s *StoreService) GenerateMockApplets() ([]model.Applet, error) {
	// Check if mocks exist, if not create them
	var count int64
	s.db.Model(&model.Applet{}).Count(&count)
	if count > 0 {
		return s.ListApplets(10, 0)
	}

	demos := []struct {
		Name  string
		Desc  string
		Color string
	}{
		{"Demo Calculator", "A simple calculator applet", "#e3f2fd"},
		{"Demo Weather", "Check local weather", "#fff3e0"},
		{"Demo Todo", "Manage your tasks", "#e8f5e9"},
	}

	for _, d := range demos {
		// Create Applet
		applet := model.Applet{
			ID:          uuid.New().String(),
			Name:        d.Name,
			Description: d.Desc,
			DeveloperID: "system",
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		s.db.Create(&applet)

		// Create Version with special URL that indicates it's a template
		// Format: template://{color}
		ver := model.AppletVersion{
			ID:        uuid.New().String(),
			AppletID:  applet.ID,
			Version:   "1.0.0",
			BundleURL: "template://" + d.Color,
			Status:    "published",
			CreatedAt: time.Now(),
		}
		s.db.Create(&ver)
	}

	return s.ListApplets(10, 0)
}
