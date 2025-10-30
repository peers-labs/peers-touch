package station

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol/consts"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-station/subserver/station/model"
)

// StationHandlerInfo represents a single handler's information
type StationHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// getPhotoSaveDir gets the photo save directory from options
func getPhotoSaveDir() string {
	opts := option.GetOptions()
	if opts == nil {
		return "photos-directory" // Default value
	}

	stationOpts := opts.Ctx().Value(serverOptionsKey{}).(*Options)
	if stationOpts == nil || stationOpts.photoSaveDir == "" {
		return "photos-directory" // Default value
	}

	return stationOpts.photoSaveDir
}

// GetStationHandlers returns all station handler configurations
func GetStationHandlers() []StationHandlerInfo {
	return []StationHandlerInfo{
		{
			RouterURL: RouterURLStationPhotoSync,
			Handler:   PhotoUploadHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{},
		},
		{
			RouterURL: RouterURLStationPhotoList,
			Handler:   PhotoListHandler,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{},
		},
		{
			RouterURL: RouterURLStationPhotoGet,
			Handler:   PhotoGetHandler,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{},
		},
	}
}

// Handler implementations

// PhotoUploadHandler processes multipart file uploads and saves to photos-directory/[album]
func PhotoUploadHandler(ctx context.Context, c *app.RequestContext) {
	// Get album parameter from form data (convert []byte to string)
	album := string(c.FormValue("album"))
	if album == "" {
		c.String(consts.StatusBadRequest, "Missing 'album' parameter")
		return
	}

	file, err := c.FormFile("photo")
	if err != nil {
		log.Printf("[StationHandler] Failed to get photo file: %v", err)
		c.String(consts.StatusBadRequest, "Missing photo file: %v", err)
		return
	}

	// Validate file size (e.g., max 50MB)
	if file.Size > 50*1024*1024 {
		log.Printf("[StationHandler] File too large: %d bytes", file.Size)
		c.String(consts.StatusBadRequest, "File too large (max 50MB)")
		return
	}

	// Validate file type
	if !isImageFile(file.Filename) {
		log.Printf("[StationHandler] Invalid file type: %s", file.Filename)
		c.String(consts.StatusBadRequest, "Only image files are allowed")
		return
	}

	// Get photo save directory from options
	photoSaveDir := getPhotoSaveDir()

	// Create photoSaveDir/[album] if it doesn't exist
	uploadDir := filepath.Join(photoSaveDir, album)
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Printf("[StationHandler] Failed to create upload directory %s: %v", uploadDir, err)
		c.String(consts.StatusInternalServerError, "Failed to create upload directory: %v", err)
		return
	}

	// Construct full save path within album subdirectory
	savePath := filepath.Join(uploadDir, file.Filename)

	// Save the uploaded file
	if err := c.SaveUploadedFile(file, savePath); err != nil {
		log.Printf("[StationHandler] Failed to save photo %s: %v", savePath, err)
		c.String(consts.StatusInternalServerError, "Failed to save photo: %v", err)
		return
	}

	log.Printf("[StationHandler] Photo saved successfully: %s (size: %d bytes) in album: %s", file.Filename, file.Size, album)
	c.String(consts.StatusOK, "Photo received: %s (size: %d bytes) in album: %s", file.Filename, file.Size, album)
}

// PhotoListHandler scans photos-directory and returns album/photo metadata
func PhotoListHandler(ctx context.Context, c *app.RequestContext) {
	albumFilter := string(c.Query("album"))

	// Get photo save directory from options
	photoSaveDir := getPhotoSaveDir()

	if _, err := os.Stat(photoSaveDir); os.IsNotExist(err) {
		// Return empty response if photos directory doesn't exist
		response := model.PhotoListResponse{
			Albums: []model.AlbumInfo{},
			Total:  0,
		}
		c.JSON(consts.StatusOK, response)
		return
	}

	albums := []model.AlbumInfo{}
	totalPhotos := 0

	// Read all album directories
	albumDirs, err := os.ReadDir(photoSaveDir)
	if err != nil {
		log.Printf("[StationHandler] Failed to read photos directory %s: %v", photoSaveDir, err)
		c.String(consts.StatusInternalServerError, "Failed to read photos directory: %v", err)
		return
	}

	for _, albumDir := range albumDirs {
		if !albumDir.IsDir() {
			continue
		}

		albumName := albumDir.Name()
		// Apply album filter if specified
		if albumFilter != "" && albumName != albumFilter {
			continue
		}

		albumPath := filepath.Join(photoSaveDir, albumName)
		photoFiles, err := os.ReadDir(albumPath)
		if err != nil {
			log.Printf("[StationHandler] Failed to read album directory %s: %v", albumPath, err)
			continue // Skip albums that can't be read
		}

		photos := []model.PhotoInfo{}
		for _, photoFile := range photoFiles {
			if photoFile.IsDir() {
				continue
			}

			filename := photoFile.Name()
			// Only include image files
			if !isImageFile(filename) {
				continue
			}

			photoPath := filepath.Join(albumPath, filename)
			fileInfo, err := os.Stat(photoPath)
			if err != nil {
				continue
			}

			photo := model.PhotoInfo{
				ID:       fmt.Sprintf("%s_%s", albumName, filename),
				Filename: filename,
				Album:    albumName,
				Size:     fileInfo.Size(),
				ModTime:  fileInfo.ModTime(),
				Path:     photoPath,
			}
			photos = append(photos, photo)
		}

		if len(photos) > 0 {
			album := model.AlbumInfo{
				Name:   albumName,
				Photos: photos,
				Count:  len(photos),
			}
			albums = append(albums, album)
			totalPhotos += len(photos)
		}
	}

	response := model.PhotoListResponse{
		Albums: albums,
		Total:  totalPhotos,
	}

	c.JSON(consts.StatusOK, response)
}

// PhotoGetHandler serves individual photo files
func PhotoGetHandler(ctx context.Context, c *app.RequestContext) {
	album := string(c.Query("album"))
	filename := string(c.Query("filename"))

	if album == "" || filename == "" {
		c.String(consts.StatusBadRequest, "Missing 'album' or 'filename' parameter")
		return
	}

	// Validate filename to prevent directory traversal
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		c.String(consts.StatusBadRequest, "Invalid filename")
		return
	}

	// Get photo save directory from options
	photoSaveDir := getPhotoSaveDir()

	photoPath := filepath.Join(photoSaveDir, album, filename)

	// Check if file exists
	if _, err := os.Stat(photoPath); os.IsNotExist(err) {
		log.Printf("[StationHandler] Photo not found: %s", photoPath)
		c.String(consts.StatusNotFound, "Photo not found")
		return
	}

	// Open and serve the file
	file, err := os.Open(photoPath)
	if err != nil {
		log.Printf("[StationHandler] Failed to open photo %s: %v", photoPath, err)
		c.String(consts.StatusInternalServerError, "Failed to open photo: %v", err)
		return
	}
	defer file.Close()

	// Set appropriate content type based on file extension
	contentType := getContentType(filename)
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "public, max-age=31536000") // Cache for 1 year

	// Copy file content to response
	if _, err := io.Copy(c.Response.BodyWriter(), file); err != nil {
		log.Printf("[StationHandler] Failed to serve photo %s: %v", photoPath, err)
		c.String(consts.StatusInternalServerError, "Failed to serve photo: %v", err)
		return
	}

	log.Printf("[StationHandler] Photo served successfully: %s", photoPath)
}
