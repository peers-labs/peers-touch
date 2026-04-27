package oss

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	authhttp "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	ossmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/oss"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ossURL struct{ name, path string }

func (u ossURL) SubPath() string { return u.path }
func (u ossURL) Name() string    { return u.name }

func (s *ossSubServer) Handlers() []server.Handler {
	base := strings.TrimRight(s.pathBase, "/")

	// Create upload handler with optional auth wrapper
	var uploadWrappers []server.Wrapper
	if s.authProvider != nil {
		uploadWrappers = []server.Wrapper{server.HTTPWrapperAdapter(authhttp.RequireJWT(s.authProvider))}
	}

	return []server.Handler{
		server.NewHTTPHandler("oss-upload", base+"/upload", server.POST, server.HTTPHandlerFunc(s.handleUpload), uploadWrappers...),
		server.NewHTTPHandler("oss-file-get", base+"/file", server.GET, server.HTTPHandlerFunc(s.handleFileGet)),
		server.NewHTTPHandler("oss-capabilities", base+"/capabilities", server.GET, server.HTTPHandlerFunc(s.handleCapabilities)),
		server.NewTypedHandler("oss-meta", base+"/meta", server.POST, s.handleMetaGet, serverwrapper.LogID()),
	}
}

// resolveOrigin returns the externally-reachable origin advertised by this
// OSS subserver. It is the source of truth for both `cid` URIs returned by
// `/upload` and the `host` field surfaced via `/capabilities`.
//
// Resolution order:
//  1. `Options.HostOverride` — operator-supplied authoritative origin.
//  2. The request's `X-Forwarded-Proto` + `Host` (or `r.Host`) headers —
//     reflects whatever the client used to reach the station, which is
//     correct for home deployments where the station has a single URL.
//  3. `"self"` — last-resort sentinel; clients treat this as "same origin
//     as the station they are talking to".
func (s *ossSubServer) resolveOrigin(r *http.Request) string {
	if s.hostOverride != "" {
		return s.hostOverride
	}
	if r != nil && r.Host != "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
			scheme = proto
		}
		return scheme + "://" + r.Host
	}
	return "self"
}

// buildCID assembles the federated content identifier returned to the
// client. Format: `oss://{origin}/{key}` — origin is the result of
// `resolveOrigin`. Receivers parse the URI to know which station to
// pull the bytes from, enabling small-scale federation without a global
// CDN. See `docs/architecture/oss/file-storage.md`.
func (s *ossSubServer) buildCID(r *http.Request, key string) string {
	origin := s.resolveOrigin(r)
	return "oss://" + origin + "/" + key
}

func (s *ossSubServer) verifySignature(q urlQuery) bool {
	if s.signSecret == "" {
		return true
	}
	expStr := q.Get("exp")
	sig := q.Get("sig")
	if expStr == "" || sig == "" {
		return false
	}
	var exp int64
	_, _ = fmt.Sscan(expStr, &exp)
	if time.Now().Unix() > exp {
		return false
	}
	data := q.Get("key") + "|" + expStr
	return hmacHex(s.signSecret, data) == sig
}

func (s *ossSubServer) handleUpload(w http.ResponseWriter, r *http.Request) {
	// Auth middleware (RequireJWT) is applied in Handlers() if authProvider is set.
	// If no authProvider is set, we deny access by default for safety in this new strict mode,
	// unless we want to allow public upload (unlikely).
	if s.authProvider == nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	// 2026-04-26: Honor `Options.MaxFileSize` for both the multipart parse
	// budget and a hard pre-save check. We trust `hdr.Size` because it
	// comes from the parsed multipart frame, not the raw client claim.
	maxSize := s.maxFileSize
	if maxSize <= 0 {
		maxSize = defaultMaxFileSize
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSize+(1<<20))
	if err := r.ParseMultipartForm(maxSize); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_multipart"})
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "file_required"})
		return
	}
	defer file.Close()
	if hdr.Size > maxSize {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":    "file_too_large",
			"max_size": maxSize,
		})
		return
	}

	meta, err := s.fileService.SaveFile(r.Context(), file, hdr)
	if err != nil {
		// Log error through the project's unified logger instead of fmt.Printf
		logger.Errorf(r.Context(), "[handleUpload] SaveFile failed: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("save_failed: %v", err)})
		return
	}

	cid := s.buildCID(r, meta.Key)
	// `url` remains a *relative* path so legacy callers (avatar / header
	// upload) keep working unchanged. `cid` is the new federated URI
	// chat clients should embed in `MessageAttachment.cid`.
	_ = json.NewEncoder(w).Encode(map[string]any{
		"key":      meta.Key,
		"cid":      cid,
		"url":      s.pathBase + "/file?key=" + meta.Key,
		"size":     meta.Size,
		"mime":     meta.Mime,
		"filename": meta.Name,
		"backend":  meta.Backend,
		"host":     s.resolveOrigin(r),
	})
}

// handleCapabilities advertises this OSS endpoint's runtime parameters so
// that clients (and peer stations, in federated deployments) can:
//
//   - Pre-validate uploads against `max_file_size` / `max_files_per_message`.
//   - Discover the externally-reachable `host` to use when resolving
//     `oss://{host}/{key}` URIs back to bytes.
//   - Decide which features to enable based on `backend` (local vs s3 vs
//     proxy) and `signed_url` flag.
//
// Public on purpose — the response carries no secrets, and clients need to
// be able to query it before they have a JWT (e.g. on first login).
func (s *ossSubServer) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"version":               1,
		"host":                  s.resolveOrigin(r),
		"path_base":             s.pathBase,
		"backend":               s.backendType,
		"max_file_size":         s.maxFileSize,
		"max_files_per_message": s.maxFilesPerMessage,
		"signed_url":            s.signSecret != "",
		"upload_endpoint":       s.pathBase + "/upload",
		"file_endpoint":         s.pathBase + "/file",
		"meta_endpoint":         s.pathBase + "/meta",
	})
}

func (s *ossSubServer) handleFileGet(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !s.verifySignature(q) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	key := q.Get("key")
	if key == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// Use backend directly for file content serving for performance
	rc, size, mt, err := s.backend.Open(r.Context(), key)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	defer rc.Close()

	// Ensure Content-Type is set, fallback to extension-based detection
	if mt == "" {
		mt = getMimeTypeByExtension(key)
	}
	if mt != "" {
		w.Header().Set("Content-Type", mt)
	}
	w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	_, _ = io.Copy(w, rc)
}

// getMimeTypeByExtension returns MIME type based on file extension
func getMimeTypeByExtension(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".bmp":
		return "image/bmp"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".pdf":
		return "application/pdf"
	case ".json":
		return "application/json"
	case ".xml":
		return "application/xml"
	case ".txt":
		return "text/plain"
	case ".html", ".htm":
		return "text/html"
	case ".css":
		return "text/css"
	case ".js":
		return "application/javascript"
	default:
		return "application/octet-stream"
	}
}

func (s *ossSubServer) handleMetaGet(ctx context.Context, req *ossmodel.GetFileMetaRequest) (*ossmodel.GetFileMetaResponse, error) {
	if req.Key == "" {
		return nil, server.BadRequest("key is required")
	}

	meta, err := s.fileService.GetFileMeta(ctx, req.Key)
	if err != nil {
		return nil, server.NotFound("file not found")
	}

	return &ossmodel.GetFileMetaResponse{
		Meta: &ossmodel.FileMeta{
			Key:         meta.Key,
			Filename:    meta.Name,
			MimeType:    meta.Mime,
			Size:        meta.Size,
			UploaderDid: "",
			UploadedAt:  timestamppb.New(meta.CreatedAt),
		},
	}, nil
}
