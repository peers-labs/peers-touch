package relay

import (
	_ "embed"
	"net/http"
)

var (
	//go:embed console/index.html
	relayConsoleIndex []byte

	//go:embed console/app.js
	relayConsoleScript []byte

	//go:embed console/style.css
	relayConsoleStyle []byte
)

func (h *relayHandler) handleConsoleIndex(
	w http.ResponseWriter,
	_ *http.Request,
) {
	w.Header().Set(
		"Content-Security-Policy",
		"default-src 'self'; connect-src 'self'; script-src 'self'; "+
			"style-src 'self'; img-src 'none'; base-uri 'none'; "+
			"frame-ancestors 'none'; form-action 'none'",
	)
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(relayConsoleIndex)
}

func (h *relayHandler) handleConsoleScript(
	w http.ResponseWriter,
	_ *http.Request,
) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(relayConsoleScript)
}

func (h *relayHandler) handleConsoleStyle(
	w http.ResponseWriter,
	_ *http.Request,
) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(relayConsoleStyle)
}
