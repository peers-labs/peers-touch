package oss

import (
	"context"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// ossOptions is the YAML schema for `peers.node.server.subserver.oss.*`.
// Each field is documented on the matching `Options` field in
// `options.go`. The S3 sub-block is loaded only when `backend: s3`.
var ossOptions struct {
	Peers struct {
		Node struct {
			Server struct {
				Subserver struct {
					Oss struct {
						Enabled                  bool   `pconf:"enabled"`
						Path                     string `pconf:"path"`
						DBName                   string `pconf:"rds-name"`
						StorePath                string `pconf:"store-path"`
						SignSecret               string `pconf:"sign-secret"`
						HostOverride             string `pconf:"host-override"`
						MaxFileSize              int64  `pconf:"max-file-size"`
						MaxFilesPerMessage       int32  `pconf:"max-files-per-message"`
						Backend                  string `pconf:"backend"`
						KeyStrategy              string `pconf:"key-strategy"`
						PresignedUploadThreshold int64  `pconf:"presigned-upload-threshold"`
						PresignedUploadTTL       int64  `pconf:"presigned-upload-ttl"`
						PresignedDownloadTTL     int64  `pconf:"presigned-download-ttl"`
						S3                       struct {
							Endpoint        string `pconf:"endpoint"`
							Region          string `pconf:"region"`
							Bucket          string `pconf:"bucket"`
							AccessKeyID     string `pconf:"access-key-id"`
							SecretAccessKey string `pconf:"secret-access-key"`
							UseSSL          bool   `pconf:"use-ssl"`
							ForcePathStyle  bool   `pconf:"force-path-style"`
							KeyPrefix       string `pconf:"key-prefix"`
						} `pconf:"s3"`
					} `pconf:"oss"`
				} `pconf:"subserver"`
			} `pconf:"server"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

type ossPlugin struct{}

func (p *ossPlugin) Name() string { return "oss" }

func (p *ossPlugin) Options() []option.Option {
	authProvider := auth.NewJWTProvider(auth.Get().Secret, auth.Get().AccessTTL)
	cfg := ossOptions.Peers.Node.Server.Subserver.Oss
	return []option.Option{
		WithPath(cfg.Path),
		WithDBName(cfg.DBName),
		WithStorePath(cfg.StorePath),
		WithSignSecret(cfg.SignSecret),
		WithHostOverride(cfg.HostOverride),
		WithMaxFileSize(cfg.MaxFileSize),
		WithMaxFilesPerMessage(cfg.MaxFilesPerMessage),
		WithBackendType(cfg.Backend),
		WithKeyStrategy(cfg.KeyStrategy),
		WithPresignedUploadThreshold(cfg.PresignedUploadThreshold),
		WithPresignedUploadTTL(cfg.PresignedUploadTTL),
		WithPresignedDownloadTTL(cfg.PresignedDownloadTTL),
		WithS3Config(S3BackendOptions{
			Endpoint:        cfg.S3.Endpoint,
			Region:          cfg.S3.Region,
			Bucket:          cfg.S3.Bucket,
			AccessKeyID:     cfg.S3.AccessKeyID,
			SecretAccessKey: cfg.S3.SecretAccessKey,
			UseSSL:          cfg.S3.UseSSL,
			ForcePathStyle:  cfg.S3.ForcePathStyle,
			KeyPrefix:       cfg.S3.KeyPrefix,
		}),
		WithAuthProvider(authProvider),
	}
}

func (p *ossPlugin) Enabled() bool { return ossOptions.Peers.Node.Server.Subserver.Oss.Enabled }

func (p *ossPlugin) New(opts ...option.Option) server.Subserver {
	opts = append(opts, p.Options()...)
	return NewOSSSubServer(opts...)
}

func init() {
	config.RegisterOptions(&ossOptions)
	// ensure our table migrates when store initializes
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		_ = rds.AutoMigrate(
			&ossmodel.FileMeta{},
			&ossmodel.Bucket{},
			&ossmodel.Audit{},
			&ossmodel.Meta{},
		)
	})
	plugin.SubserverPlugins["oss"] = &ossPlugin{}
}
