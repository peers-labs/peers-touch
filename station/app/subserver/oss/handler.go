package oss

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	authhttp "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
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
		server.NewHTTPHandler("oss-meta", base+"/meta", server.GET, server.HTTPHandlerFunc(s.handleMetaGet)),
	}
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

	if err := r.ParseMultipartForm(32 << 20); err != nil {
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

	meta, err := s.fileService.SaveFile(r.Context(), file, hdr)
	if err != nil {
		fmt.Printf("[OSS] SaveFile error: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("save_failed: %v", err)})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"key":     meta.Key,
		"url":     s.pathBase + "/file?key=" + meta.Key,
		"size":    meta.Size,
		"mime":    meta.Mime,
		"backend": meta.Backend,
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
	if mt != "" {
		w.Header().Set("Content-Type", mt)
	}
	w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	_, _ = io.Copy(w, rc)
}

func (s *ossSubServer) handleMetaGet(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	meta, err := s.fileService.GetFileMeta(r.Context(), key)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	_ = json.NewEncoder(w).Encode(meta)
}
