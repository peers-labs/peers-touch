package httpinterface

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
)

type PublicHandler struct {
	Repository catalog.Repository
}

func (h *PublicHandler) Snapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	channel, sequence, ok := publicSnapshotIdentity(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_snapshot_identity")
		return
	}
	value, err := h.Repository.LoadPublishedSnapshot(
		r.Context(),
		channel,
		sequence,
	)
	if err != nil {
		switch {
		case errors.Is(err, catalog.ErrPublicationNotFound):
			writeError(w, http.StatusNotFound, "snapshot_not_found")
		case errors.Is(err, catalog.ErrValidationFailed):
			writeError(w, http.StatusBadRequest, "invalid_snapshot_identity")
		default:
			writeError(w, http.StatusServiceUnavailable, "snapshot_unavailable")
		}
		return
	}
	cacheControl := "public, max-age=300, must-revalidate"
	if sequence != 0 {
		cacheControl = "public, max-age=31536000, immutable"
	}
	etag := `"` + value.EnvelopeSHA256 + `"`
	header := w.Header()
	header.Set("Cache-Control", cacheControl)
	header.Set("Content-Type", "application/protobuf")
	header.Set("ETag", etag)
	header.Set("X-Content-Type-Options", "nosniff")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	header.Set("Content-Length", strconv.Itoa(len(value.EnvelopeBytes)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(value.EnvelopeBytes)
	}
}

func publicSnapshotIdentity(r *http.Request) (string, uint64, bool) {
	channel := strings.TrimSpace(r.URL.Query().Get("channel"))
	sequenceRaw := strings.TrimSpace(r.URL.Query().Get("sequence"))
	if channel != "" {
		if sequenceRaw == "" {
			return channel, 0, true
		}
		sequence, err := strconv.ParseUint(sequenceRaw, 10, 64)
		return channel, sequence, err == nil && sequence > 0
	}
	const channelPrefix = "/channels/"
	const latestSuffix = "/latest.pb"
	if strings.HasPrefix(r.URL.Path, channelPrefix) &&
		strings.HasSuffix(r.URL.Path, latestSuffix) {
		channel = strings.TrimSuffix(
			strings.TrimPrefix(r.URL.Path, channelPrefix),
			latestSuffix,
		)
		return channel, 0, channel != ""
	}
	const snapshotPrefix = "/snapshots/"
	const snapshotSuffix = ".pb"
	if !strings.HasPrefix(r.URL.Path, snapshotPrefix) ||
		!strings.HasSuffix(r.URL.Path, snapshotSuffix) {
		return "", 0, false
	}
	stem := strings.TrimSuffix(
		strings.TrimPrefix(r.URL.Path, snapshotPrefix),
		snapshotSuffix,
	)
	if len(stem) < 22 || stem[len(stem)-21] != '-' {
		return "", 0, false
	}
	channel = stem[:len(stem)-21]
	sequence, err := strconv.ParseUint(stem[len(stem)-20:], 10, 64)
	return channel, sequence, err == nil && sequence > 0
}
