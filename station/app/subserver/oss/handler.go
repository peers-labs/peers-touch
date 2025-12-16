package oss

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "mime"
    "net/http"
    "path/filepath"
    "strings"
    "time"

    ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
    "github.com/peers-labs/peers-touch/station/frame/core/storage"
    "github.com/peers-labs/peers-touch/station/frame/core/option"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
    "github.com/peers-labs/peers-touch/station/frame/core/store"
    touchutil "github.com/peers-labs/peers-touch/station/frame/touch/util"
)

type ossURL struct{ name, path string }

func (u ossURL) SubPath() string { return u.path }
func (u ossURL) Name() string    { return u.name }

type ossSubServer struct {
    status     server.Status
    addrs      []string
    pathBase   string
    dbName     string
    storePath  string
    token      string
    signSecret string
    backend    storage.Driver
}

func NewOSSSubServer(opts ...option.Option) server.Subserver {
    o := getOptions(opts...)
    s := &ossSubServer{status: server.StatusStopped, addrs: []string{}}
    s.pathBase = o.Path
    s.dbName = o.DBName
    s.storePath = o.StorePath
    s.token = o.Token
    s.signSecret = o.SignSecret
    if s.pathBase == "" { s.pathBase = "/sub-oss" }
    if s.storePath == "" { s.storePath = "/tmp/oss" }
    s.backend = storage.NewLocalDriver(s.storePath)
    return s
}

func (s *ossSubServer) Init(ctx context.Context, opts ...option.Option) error {
    s.status = server.StatusStarting
    if s.dbName != "" {
        if rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.dbName)); err == nil {
            _ = rds.AutoMigrate(&ossmodel.FileMeta{})
        }
    }
    return nil
}

func (s *ossSubServer) Start(ctx context.Context, opts ...option.Option) error {
    s.status = server.StatusRunning
    return nil
}

func (s *ossSubServer) Stop(ctx context.Context) error { s.status = server.StatusStopped; return nil }
func (s *ossSubServer) Status() server.Status          { return s.status }
func (s *ossSubServer) Name() string                   { return "oss" }
func (s *ossSubServer) Type() server.SubserverType     { return server.SubserverTypeHTTP }
func (s *ossSubServer) Address() server.SubserverAddress { return server.SubserverAddress{Address: s.addrs} }

func (s *ossSubServer) Handlers() []server.Handler {
    base := strings.TrimRight(s.pathBase, "/")
    return []server.Handler{
        server.NewHandler(ossURL{name: "oss-upload", path: base+"/upload"}, http.HandlerFunc(s.handleUpload), server.WithMethod(server.POST)),
        server.NewHandler(ossURL{name: "oss-file-get", path: base+"/file"}, http.HandlerFunc(s.handleFileGet), server.WithMethod(server.GET)),
        server.NewHandler(ossURL{name: "oss-meta", path: base+"/meta"}, http.HandlerFunc(s.handleMetaGet), server.WithMethod(server.GET)),
    }
}

func (s *ossSubServer) checkBearer(r *http.Request) bool {
    if s.token == "" { return true }
    auth := r.Header.Get("Authorization")
    if !strings.HasPrefix(auth, "Bearer ") { return false }
    tok := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
    return tok == s.token
}

func (s *ossSubServer) verifySignature(q urlQuery) bool {
    if s.signSecret == "" { return true }
    expStr := q.Get("exp")
    sig := q.Get("sig")
    if expStr == "" || sig == "" { return false }
    var exp int64
    _, _ = fmt.Sscan(expStr, &exp)
    if time.Now().Unix() > exp { return false }
    data := q.Get("key") + "|" + expStr
    return hmacHex(s.signSecret, data) == sig
}

func (s *ossSubServer) handleUpload(w http.ResponseWriter, r *http.Request) {
    if !s.checkBearer(r) {
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
    rnd, _ := touchutil.RandomString(16)
    ext := filepath.Ext(hdr.Filename)
    day := time.Now().Format("2006/01/02")
    key := filepath.Join(day, rnd+ext)
    full, err := s.backend.Save(r.Context(), key, file)
    if err != nil {
        w.WriteHeader(http.StatusInternalServerError)
        _ = json.NewEncoder(w).Encode(map[string]string{"error": "save_failed"})
        return
    }
    mt := mime.TypeByExtension(ext)
    meta := ossmodel.FileMeta{ID: rnd, Key: key, Name: hdr.Filename, Size: hdr.Size, Mime: mt, Backend: "local", Path: full, CreatedAt: time.Now()}
    if s.dbName != "" {
        if rds, err := store.GetRDS(r.Context(), store.WithRDSDBName(s.dbName)); err == nil {
            _ = rds.Create(&meta).Error
        }
    }
    _ = json.NewEncoder(w).Encode(map[string]any{"key": key, "url": s.pathBase+"/file?key="+key, "size": hdr.Size, "mime": mt, "backend": "local"})
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
    rc, size, mt, err := s.backend.Open(r.Context(), key)
    if err != nil {
        w.WriteHeader(http.StatusNotFound)
        return
    }
    defer rc.Close()
    if mt != "" { w.Header().Set("Content-Type", mt) }
    w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
    _, _ = io.Copy(w, rc)
}

func (s *ossSubServer) handleMetaGet(w http.ResponseWriter, r *http.Request) {
    key := r.URL.Query().Get("key")
    if key == "" {
        w.WriteHeader(http.StatusBadRequest)
        return
    }
    if s.dbName == "" {
        w.WriteHeader(http.StatusNotFound)
        return
    }
    rds, err := store.GetRDS(r.Context(), store.WithRDSDBName(s.dbName))
    if err != nil {
        w.WriteHeader(http.StatusInternalServerError)
        return
    }
    var meta ossmodel.FileMeta
    if err := rds.Where("key = ?", key).First(&meta).Error; err != nil {
        w.WriteHeader(http.StatusNotFound)
        return
    }
    _ = json.NewEncoder(w).Encode(meta)
}
