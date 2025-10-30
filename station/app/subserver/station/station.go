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

var (
	_ server.Subserver = (*PhotoSaveSubServer)(nil)
)

// stationRouterURL implements server.RouterURL for station endpoints
type stationRouterURL struct {
	name string
	path string
}

func (s stationRouterURL) SubPath() string {
	return s.path
}

func (s stationRouterURL) Name() string {
	return s.name
}

// PhotoSaveSubServer handles photo upload requests
type PhotoSaveSubServer struct {
	opts *Options

	addrs  []string      // Populated from configuration
	status server.Status // Track server status
}

// Name returns the subserver identifier
func (s *PhotoSaveSubServer) Name() string {
	return "photo-save"
}

// Type returns the subserver type (HTTP in this case)
func (s *PhotoSaveSubServer) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

// Address returns the listening addresses
func (s *PhotoSaveSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{
		Address: s.addrs,
	}
}

// Handlers defines the upload, list, and get endpoints
func (s *PhotoSaveSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHandler(
			stationRouterURL{name: "station", path: "/photo/sync"},
			s.handlePhotoUpload,            // Handler function
			server.WithMethod(server.POST), // HTTP method
		),
		server.NewHandler(
			stationRouterURL{name: "station", path: "/photo/list"},
			s.handlePhotoList,             // Handler function
			server.WithMethod(server.GET), // HTTP method
		),
		server.NewHandler(
			stationRouterURL{name: "station", path: "/photo/get"},
			s.handlePhotoGet,              // Handler function
			server.WithMethod(server.GET), // HTTP method
		),
		// Avatar endpoints
		server.NewHandler(
			stationRouterURL{name: "station", path: "/avatar/upload"},
			AvatarUploadHandler,            // Handler function
			server.WithMethod(server.POST), // HTTP method
		),
		server.NewHandler(
			stationRouterURL{name: "station", path: "/avatar/list/:user_id"},
			GetUserAvatarsHandler,         // Handler function
			server.WithMethod(server.GET), // HTTP method
		),
		server.NewHandler(
			stationRouterURL{name: "station", path: "/avatar/:user_id/:filename"},
			s.handleAvatarGet,             // Handler function for serving avatar images
			server.WithMethod(server.GET), // HTTP method
		),
	}
}

// Init initializes the subserver (e.g., load configuration)
func (s *PhotoSaveSubServer) Init(ctx context.Context, opts ...option.Option) error {
	// Initialize options if not already set
	if s.opts == nil {
		s.opts = &Options{
			Options:      option.GetOptions(opts...),
			photoSaveDir: "photos-directory", // Default value
		}
	}
	// Apply configuration options
	for _, opt := range opts {
		s.opts.Apply(opt)
	}
	return nil
}

// handleAvatarGet serves avatar images from the filesystem
func (s *PhotoSaveSubServer) handleAvatarGet(ctx context.Context, c *app.RequestContext) {
	// Get user ID and filename from path parameters
	userID := c.Param("user_id")
	filename := c.Param("filename")

	if userID == "" || filename == "" {
		c.String(consts.StatusBadRequest, "Missing user_id or filename")
		return
	}

	// Construct file path
	avatarPath := filepath.Join("data", "photos", AvatarDir, userID, filename)

	// Check if file exists
	if _, err := os.Stat(avatarPath); os.IsNotExist(err) {
		c.String(consts.StatusNotFound, "Avatar not found")
		return
	}

	// Determine content type based on file extension
	ext := strings.ToLower(filepath.Ext(filename))
	contentType := getImageMimeType(ext)

	// Open and serve the file
	file, err := os.Open(avatarPath)
	if err != nil {
		c.String(consts.StatusInternalServerError, "Failed to open avatar file")
		return
	}
	defer file.Close()

	// Set content type header
	c.Header("Content-Type", contentType)

	// Read file data
	fileData, err := io.ReadAll(file)
	if err != nil {
		c.String(consts.StatusInternalServerError, "Failed to read avatar file")
		return
	}

	// Write file data to response
	c.Data(consts.StatusOK, contentType, fileData)
}

// Start begins listening for requests
func (s *PhotoSaveSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	return nil // Actual server start would be handled by the main server manager
}

// Stop shuts down the subserver
func (s *PhotoSaveSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

// Status returns current server status
func (s *PhotoSaveSubServer) Status() server.Status {
	return s.status
}

// handlePhotoUpload processes multipart file uploads and saves to photos-directory/[album]
func (s *PhotoSaveSubServer) handlePhotoUpload(ctx context.Context, c *app.RequestContext) {
	// Get album parameter from form data (convert []byte to string)
	album := string(c.FormValue("album")) // Fix: Convert byte slice to string
	if album == "" {
		c.String(consts.StatusBadRequest, "Missing 'album' parameter")
		return
	}

	file, err := c.FormFile("photo")
	if err != nil {
		log.Printf("[PhotoSaveSubServer] Failed to get photo file: %v", err)
		c.String(consts.StatusBadRequest, "Missing photo file: %v", err)
		return
	}

	// Validate file size (e.g., max 50MB)
	if file.Size > 50*1024*1024 {
		log.Printf("[PhotoSaveSubServer] File too large: %d bytes", file.Size)
		c.String(consts.StatusBadRequest, "File too large (max 50MB)")
		return
	}

	// Validate file type
	if !isImageFile(file.Filename) {
		log.Printf("[PhotoSaveSubServer] Invalid file type: %s", file.Filename)
		c.String(consts.StatusBadRequest, "Only image files are allowed")
		return
	}

	// Create photoSaveDir/[album] if it doesn't exist
	uploadDir := filepath.Join(s.opts.photoSaveDir, string(album))
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Printf("[PhotoSaveSubServer] Failed to create upload directory %s: %v", uploadDir, err)
		c.String(consts.StatusInternalServerError, "Failed to create upload directory: %v", err)
		return
	}
	// Construct full save path within album subdirectory
	savePath := filepath.Join(uploadDir, file.Filename)

	// Save the uploaded file
	if err := c.SaveUploadedFile(file, savePath); err != nil {
		log.Printf("[PhotoSaveSubServer] Failed to save photo %s: %v", savePath, err)
		c.String(consts.StatusInternalServerError, "Failed to save photo: %v", err)
		return
	}

	log.Printf("[PhotoSaveSubServer] Photo saved successfully: %s (size: %d bytes) in album: %s", file.Filename, file.Size, album)
	c.String(consts.StatusOK, "Photo received: %s (size: %d bytes) in album: %s", file.Filename, file.Size, album)
}

// handlePhotoList scans photos-directory and returns album/photo metadata
func (s *PhotoSaveSubServer) handlePhotoList(ctx context.Context, c *app.RequestContext) {
	albumFilter := string(c.Query("album"))

	photosDir := s.opts.photoSaveDir
	if _, err := os.Stat(photosDir); os.IsNotExist(err) {
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
	albumDirs, err := os.ReadDir(photosDir)
	if err != nil {
		log.Printf("[PhotoSaveSubServer] Failed to read photos directory %s: %v", photosDir, err)
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

		albumPath := filepath.Join(photosDir, albumName)
		photoFiles, err := os.ReadDir(albumPath)
		if err != nil {
			log.Printf("[PhotoSaveSubServer] Failed to read album directory %s: %v", albumPath, err)
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

// handlePhotoGet serves individual photo files
func (s *PhotoSaveSubServer) handlePhotoGet(ctx context.Context, c *app.RequestContext) {
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

	photoPath := filepath.Join(s.opts.photoSaveDir, album, filename)

	// Check if file exists
	if _, err := os.Stat(photoPath); os.IsNotExist(err) {
		log.Printf("[PhotoSaveSubServer] Photo not found: %s", photoPath)
		c.String(consts.StatusNotFound, "Photo not found")
		return
	}

	// Open and serve the file
	file, err := os.Open(photoPath)
	if err != nil {
		log.Printf("[PhotoSaveSubServer] Failed to open photo %s: %v", photoPath, err)
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
		log.Printf("[PhotoSaveSubServer] Failed to serve photo %s: %v", photoPath, err)
		c.String(consts.StatusInternalServerError, "Failed to serve photo: %v", err)
		return
	}

	log.Printf("[PhotoSaveSubServer] Photo served successfully: %s", photoPath)
}

// isImageFile checks if the filename has an image extension
func isImageFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	imageExts := []string{".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif"}
	for _, imgExt := range imageExts {
		if ext == imgExt {
			return true
		}
	}
	return false
}

// getContentType returns the appropriate MIME type for image files
func getContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	case ".webp":
		return "image/webp"
	case ".tiff", ".tif":
		return "image/tiff"
	default:
		return "application/octet-stream"
	}
}

func NewPhotoSaveSubServer(opts ...option.Option) server.Subserver {
	s := &PhotoSaveSubServer{
		opts: &Options{
			Options:      option.GetOptions(opts...),
			photoSaveDir: "photos-directory", // Default value
		},
		status: server.StatusStopped,
	}
	// Apply any provided options
	for _, opt := range opts {
		s.opts.Apply(opt)
	}
	return s
}
