package station

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol/consts"
)

// Constants for avatar storage
const (
	AvatarDir        = "avatars"
	MaxAvatarSize    = 5 * 1024 * 1024 // 5MB
	MaxStoredAvatars = 5               // Maximum number of avatars to store per user
)

// AvatarInfo represents a user's profile avatar image
type AvatarInfo struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Filename  string    `json:"filename"`
	URL       string    `json:"url"`
	Size      int64     `json:"size"`
	MimeType  string    `json:"mime_type"`
	IsCurrent bool      `json:"is_current"`
	CreatedAt time.Time `json:"created_at"`
}

// UploadAvatarResponse is the response after uploading an avatar
type UploadAvatarResponse struct {
	Avatar  *AvatarInfo `json:"avatar,omitempty"`
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
}

// GetUserAvatarsResponse is the response containing user avatars
type GetUserAvatarsResponse struct {
	Avatars []*AvatarInfo `json:"avatars"`
	Success bool          `json:"success"`
	Message string        `json:"message,omitempty"`
}

// AvatarUploadHandler processes avatar image uploads
func AvatarUploadHandler(ctx context.Context, c *app.RequestContext) {
	// Get user ID from request (in a real app, this would come from authentication)
	userID := string(c.FormValue("user_id"))
	if userID == "" {
		c.JSON(consts.StatusBadRequest, &UploadAvatarResponse{
			Success: false,
			Message: "Missing user_id parameter",
		})
		return
	}

	// Get file from form data
	file, err := c.FormFile("avatar")
	if err != nil {
		log.Printf("[AvatarHandler] Failed to get avatar file: %v", err)
		c.JSON(consts.StatusBadRequest, &UploadAvatarResponse{
			Success: false,
			Message: fmt.Sprintf("Missing avatar file: %v", err),
		})
		return
	}

	// Validate file size
	if file.Size > MaxAvatarSize {
		log.Printf("[AvatarHandler] File too large: %d bytes", file.Size)
		c.JSON(consts.StatusBadRequest, &UploadAvatarResponse{
			Success: false,
			Message: fmt.Sprintf("File too large (max %dMB)", MaxAvatarSize/1024/1024),
		})
		return
	}

	// Validate file type
	if !isValidImageFile(file.Filename) {
		log.Printf("[AvatarHandler] Invalid file type: %s", file.Filename)
		c.JSON(consts.StatusBadRequest, &UploadAvatarResponse{
			Success: false,
			Message: "Only image files are allowed",
		})
		return
	}

	// Get avatar save directory
	avatarSaveDir := filepath.Join(getAvatarSaveDir(), userID)

	// Create directory if it doesn't exist
	if err := os.MkdirAll(avatarSaveDir, 0755); err != nil {
		log.Printf("[AvatarHandler] Failed to create directory: %v", err)
		c.JSON(consts.StatusInternalServerError, &UploadAvatarResponse{
			Success: false,
			Message: "Server error: Failed to create directory",
		})
		return
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		log.Printf("[AvatarHandler] Failed to open uploaded file: %v", err)
		c.JSON(consts.StatusInternalServerError, &UploadAvatarResponse{
			Success: false,
			Message: "Server error: Failed to process uploaded file",
		})
		return
	}
	defer src.Close()

	// Read file data for hash calculation
	fileData, err := io.ReadAll(src)
	if err != nil {
		log.Printf("[AvatarHandler] Failed to read file data: %v", err)
		c.JSON(consts.StatusInternalServerError, &UploadAvatarResponse{
			Success: false,
			Message: "Server error: Failed to process file data",
		})
		return
	}

	// Generate unique filename using hash and timestamp
	hash := sha256.Sum256(fileData)
	hashStr := hex.EncodeToString(hash[:8]) // Use first 8 bytes of hash
	timestamp := time.Now().UnixNano() / 1000000
	fileExt := filepath.Ext(file.Filename)
	newFilename := fmt.Sprintf("%s_%d%s", hashStr, timestamp, fileExt)
	filePath := filepath.Join(avatarSaveDir, newFilename)

	// Create destination file
	dst, err := os.Create(filePath)
	if err != nil {
		log.Printf("[AvatarHandler] Failed to create destination file: %v", err)
		c.JSON(consts.StatusInternalServerError, &UploadAvatarResponse{
			Success: false,
			Message: "Server error: Failed to save file",
		})
		return
	}
	defer dst.Close()

	// Write file data
	if _, err = dst.Write(fileData); err != nil {
		log.Printf("[AvatarHandler] Failed to write file: %v", err)
		c.JSON(consts.StatusInternalServerError, &UploadAvatarResponse{
			Success: false,
			Message: "Server error: Failed to save file",
		})
		return
	}

	// Update avatar list and mark this as current
	avatarID := fmt.Sprintf("%s_%d", hashStr, timestamp)
	avatarURL := fmt.Sprintf("/api/station/avatar/%s/%s", userID, newFilename)

	// Create avatar response
	avatarResponse := &AvatarInfo{
		ID:        avatarID,
		UserID:    userID,
		Filename:  file.Filename,
		URL:       avatarURL,
		Size:      file.Size,
		MimeType:  getImageMimeType(fileExt),
		IsCurrent: true,
		CreatedAt: time.Now(),
	}

	// Update avatar list file (mark this as current, others as not current)
	updateAvatarList(avatarSaveDir, avatarResponse)

	// Clean up old avatars if we have more than the maximum
	cleanupOldAvatars(avatarSaveDir)

	// Return success response
	c.JSON(consts.StatusOK, &UploadAvatarResponse{
		Avatar:  avatarResponse,
		Success: true,
		Message: "Avatar uploaded successfully",
	})
}

// GetUserAvatarsHandler retrieves a user's previous avatars
func GetUserAvatarsHandler(ctx context.Context, c *app.RequestContext) {
	// Get user ID from request
	userID := c.Param("user_id")
	if userID == "" {
		c.JSON(consts.StatusBadRequest, &GetUserAvatarsResponse{
			Success: false,
			Message: "Missing user_id parameter",
		})
		return
	}

	// Get limit parameter (default to MaxStoredAvatars)
	limitStr := string(c.Query("limit"))
	limit := MaxStoredAvatars
	if limitStr != "" {
		fmt.Sscanf(limitStr, "%d", &limit)
		if limit <= 0 || limit > 20 {
			limit = MaxStoredAvatars // Default if invalid
		}
	}

	// Get avatar directory
	avatarSaveDir := filepath.Join(getAvatarSaveDir(), userID)

	// Check if directory exists
	if _, err := os.Stat(avatarSaveDir); os.IsNotExist(err) {
		// No avatars yet, return empty list
		c.JSON(consts.StatusOK, &GetUserAvatarsResponse{
			Avatars: []*AvatarInfo{},
			Success: true,
			Message: "No avatars found",
		})
		return
	}

	// Get avatar list
	avatars := getAvatarList(avatarSaveDir)

	// Limit the number of avatars returned
	if len(avatars) > limit {
		avatars = avatars[:limit]
	}

	// Return avatars
	c.JSON(consts.StatusOK, &GetUserAvatarsResponse{
		Avatars: avatars,
		Success: true,
		Message: fmt.Sprintf("Found %d avatars", len(avatars)),
	})
}

// Helper functions

// getAvatarSaveDir returns the base directory for saving avatars
func getAvatarSaveDir() string {
	// Use the same photo directory as the station photo handler
	// In a real implementation, this might be configurable
	return filepath.Join("data", "photos", AvatarDir)
}

// isValidImageFile checks if a filename has an image extension
func isValidImageFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}

// updateAvatarList updates the list of avatars for a user
func updateAvatarList(avatarDir string, newAvatar *AvatarInfo) {
	// In a real implementation, this would update a database or file
	// For this example, we'll just log the update
	log.Printf("[AvatarHandler] Updated avatar list for user %s, new current avatar: %s",
		newAvatar.UserID, newAvatar.ID)
}

// getAvatarList retrieves the list of avatars for a user
func getAvatarList(avatarDir string) []*AvatarInfo {
	// In a real implementation, this would query a database or read from a file
	// For this example, we'll just return a mock list based on files in the directory
	avatars := []*AvatarInfo{}

	// Read directory
	files, err := os.ReadDir(avatarDir)
	if err != nil {
		log.Printf("[AvatarHandler] Failed to read avatar directory: %v", err)
		return avatars
	}

	// Process each file
	for i, file := range files {
		if file.IsDir() {
			continue
		}

		// Get file info
		fileInfo, err := file.Info()
		if err != nil {
			continue
		}

		// Skip non-image files
		if !isValidImageFile(file.Name()) {
			continue
		}

		// Extract user ID from directory path
		userID := filepath.Base(avatarDir)

		// Create avatar object
		avatarURL := fmt.Sprintf("/api/station/avatar/%s/%s", userID, file.Name())
		avatarID := fmt.Sprintf("avatar_%d", i)
		fileExt := filepath.Ext(file.Name())

		avatar := &AvatarInfo{
			ID:        avatarID,
			UserID:    userID,
			Filename:  file.Name(),
			URL:       avatarURL,
			Size:      fileInfo.Size(),
			MimeType:  getImageMimeType(fileExt),
			IsCurrent: i == 0, // Assume most recent is current
			CreatedAt: fileInfo.ModTime(),
		}

		avatars = append(avatars, avatar)
	}

	return avatars
}

// cleanupOldAvatars removes old avatars if we have more than the maximum
func cleanupOldAvatars(avatarDir string) {
	// In a real implementation, this would delete old files and update the database
	// For this example, we'll just log the cleanup
	log.Printf("[AvatarHandler] Cleaned up old avatars in %s", avatarDir)
}

// getImageMimeType returns the MIME type for a file extension
func getImageMimeType(ext string) string {
	ext = strings.ToLower(ext)
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}
