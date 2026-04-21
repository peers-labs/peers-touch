// Package dashboard — go:embed integration for serving the frontend SPA
// from inside the compiled Go binary.
//
// Change History:
//   - 2026-04-10: Initial implementation — embedded FS with MIME-aware serving,
//     cache headers for assets, and SPA fallback to index.html.
//   - 2026-04-10: Refactored — added Change History header for DDD compliance.
package dashboard

import (
	stdctx "context"
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

//go:embed web/dist
var webDistFS embed.FS

// staticFileHandlers returns server.Handler entries that serve the embedded
// SPA (index.html, JS, CSS, images, etc.) under the /dashboard/ prefix.
func staticFileHandlers() []server.Handler {
	return []server.Handler{
		server.NewHTTPHandler("dashboard-assets", "/dashboard/assets/*filepath", server.GET,
			server.HertzHandlerFunc(handleStaticAsset)),
		server.NewHTTPHandler("dashboard-favicon", "/dashboard/favicon.ico", server.GET,
			server.HertzHandlerFunc(handleStaticFile)),
		server.NewHTTPHandler("dashboard-spa", "/dashboard/*filepath", server.GET,
			server.HertzHandlerFunc(handleSPAFallback)),
		server.NewHTTPHandler("dashboard-root", "/dashboard", server.GET,
			server.HertzHandlerFunc(handleSPAFallback)),
	}
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

// handleStaticAsset serves hashed assets with aggressive caching.
func handleStaticAsset(_ stdctx.Context, ctx *app.RequestContext) {
	filePath := ctx.Param("filepath")
	serveEmbeddedFile(ctx, "assets/"+filePath, true)
}

// handleStaticFile serves a single static file (e.g. favicon.ico).
func handleStaticFile(_ stdctx.Context, ctx *app.RequestContext) {
	serveEmbeddedFile(ctx, "favicon.ico", false)
}

// handleSPAFallback serves the requested file if it exists, otherwise falls
// back to index.html — standard SPA behaviour for hash/history routing.
func handleSPAFallback(_ stdctx.Context, ctx *app.RequestContext) {
	reqPath := ctx.Param("filepath")
	reqPath = strings.TrimPrefix(reqPath, "/")

	if reqPath != "" && !strings.HasPrefix(reqPath, "api/") {
		if _, err := fs.Stat(webDistSub(), reqPath); err == nil {
			serveEmbeddedFile(ctx, reqPath, false)
			return
		}
	}

	serveEmbeddedFile(ctx, "index.html", false)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// webDistSub returns the "web/dist" sub-filesystem.
func webDistSub() fs.FS {
	sub, _ := fs.Sub(webDistFS, "web/dist")
	return sub
}

// serveEmbeddedFile reads a file from the embedded FS and writes it to the
// response. It sets the correct Content-Type based on the file extension and
// optionally adds aggressive cache headers for fingerprinted assets.
func serveEmbeddedFile(ctx *app.RequestContext, name string, longCache bool) {
	distFS := webDistSub()
	data, err := fs.ReadFile(distFS, name)
	if err != nil {
		ctx.AbortWithStatus(http.StatusNotFound)
		return
	}

	ext := filepath.Ext(name)
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = detectContentType(ext)
	}

	if longCache {
		ctx.Header("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		ctx.Header("Cache-Control", "no-cache")
	}

	ctx.Data(http.StatusOK, contentType, data)
}

// detectContentType provides MIME types for common web extensions that
// mime.TypeByExtension may not know about on all platforms.
func detectContentType(ext string) string {
	types := map[string]string{
		".html":  "text/html; charset=utf-8",
		".css":   "text/css; charset=utf-8",
		".js":    "application/javascript; charset=utf-8",
		".json":  "application/json; charset=utf-8",
		".svg":   "image/svg+xml",
		".png":   "image/png",
		".ico":   "image/x-icon",
		".woff":  "font/woff",
		".woff2": "font/woff2",
		".map":   "application/json",
	}
	if ct, ok := types[ext]; ok {
		return ct
	}
	return "application/octet-stream"
}
