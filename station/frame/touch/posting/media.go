package posting

import (
    "context"
    "path/filepath"
    "strings"
    "time"

    "github.com/cloudwego/hertz/pkg/protocol"
    "gorm.io/gorm"
)

func StoreMedia(ctx context.Context, db *gorm.DB, actor string, baseURL string, file *protocol.MultipartFormFile, alt string) (string, string, string, error) {
    name := file.Filename()
    ext := strings.ToLower(filepath.Ext(name))
    mediaType := ext
    mediaID := time.Now().Format("20060102150405.000000")
    url := baseURL + "/media/" + mediaID
    return url, mediaID, mediaType, nil
}
