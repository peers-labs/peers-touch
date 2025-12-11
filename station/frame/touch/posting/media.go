package posting

import (
	"context"
	"mime/multipart"
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
	url := baseURL + "/media/" + mediaID
	return url, mediaID, mediaType, nil
}
