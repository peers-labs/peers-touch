package posting

import (
	"context"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
)

func StoreMedia(ctx context.Context, db *gorm.DB, actor string, baseURL string, file *multipart.FileHeader, alt string) (string, string, string, error) {
	name := file.Filename
	ext := strings.ToLower(filepath.Ext(name))
	mediaType := file.Header.Get("Content-Type")
	if mediaType == "" {
		mediaType = ext
	}
	mediaID := time.Now().Format("20060102150405.000000")
	
	// Create uploads directory if it doesn't exist
	uploadDir := "uploads"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return "", "", "", err
	}

	// Save file
	filename := mediaID + ext
	dst := filepath.Join(uploadDir, filename)
	
	src, err := file.Open()
	if err != nil {
		return "", "", "", err
	}
	defer src.Close()

	out, err := os.Create(dst)
	if err != nil {
		return "", "", "", err
	}
	defer out.Close()

	if _, err = io.Copy(out, src); err != nil {
		return "", "", "", err
	}

	url := baseURL + "/media/" + filename
	return url, mediaID, mediaType, nil
}
