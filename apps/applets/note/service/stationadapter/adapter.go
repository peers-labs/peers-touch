package stationadapter

import (
	"context"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/apps/applets/note/service/application"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/infrastructure"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/transport"
	"gorm.io/gorm"
)

type Bundle struct {
	Repository *infrastructure.GormRepository
	Service    *application.Service
	Handler    http.Handler
}

func NewBundle(ctx context.Context, db *gorm.DB) (*Bundle, error) {
	repository := infrastructure.NewGormRepository(db)
	if err := repository.AutoMigrate(ctx); err != nil {
		return nil, err
	}
	service := application.NewService(repository)
	return &Bundle{
		Repository: repository,
		Service:    service,
		Handler:    transport.NewHandler(service),
	}, nil
}

func (b *Bundle) Mount(pathPrefix string) http.Handler {
	prefix := "/" + strings.Trim(strings.TrimSpace(pathPrefix), "/")
	if prefix == "/" {
		return b.Handler
	}
	return http.StripPrefix(prefix, b.Handler)
}
