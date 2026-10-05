package domain

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
)

// Cursor encodes a single-source pagination position. Repositories and
// application services pass it around as the canonical "where I left off"
// token; the wire format (the base64-encoded JSON below) is opaque to
// clients, who treat it as a string.
//
// The two fields together resolve ties for posts created in the same
// millisecond (`CreatedAt` falls back to `LastID` for stable ordering).
// Both zero == "start from the most recent post".
type Cursor struct {
	LastID    uint64    `json:"id,omitempty"`
	CreatedAt time.Time `json:"ts,omitempty"`
}

// IsZero reports whether the cursor represents "start from the beginning"
// (the most recent post). A zero cursor is the natural state on first page.
func (c Cursor) IsZero() bool {
	return c.LastID == 0 && c.CreatedAt.IsZero()
}

// Encode serializes the cursor to a base64url-encoded JSON string suitable
// for round-tripping through HTTP query params and JSON bodies. Returns an
// empty string for a zero cursor so handlers can omit `next_cursor` cleanly.
func (c Cursor) Encode() string {
	if c.IsZero() {
		return ""
	}
	b, err := json.Marshal(c)
	if err != nil {
		// Marshaling a struct of a uint64 + time.Time can never fail at
		// runtime; treat any error as programmer mistake.
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeCursor parses a cursor produced by Cursor.Encode. An empty input
// yields a zero cursor (start from beginning). Garbage input returns an
// error; callers SHOULD treat that as a 400-class request error rather
// than silently fall back to "start from beginning" — the latter would
// silently produce duplicate results across pages.
func DecodeCursor(s string) (Cursor, error) {
	if s == "" {
		return Cursor{}, nil
	}
	if s != strings.TrimSpace(s) {
		return Cursor{}, fmt.Errorf("decode cursor: non-canonical encoding")
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return Cursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	if base64.RawURLEncoding.EncodeToString(b) != s {
		return Cursor{}, fmt.Errorf("decode cursor: non-canonical encoding")
	}
	var c Cursor
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&c); err != nil {
		return Cursor{}, fmt.Errorf("unmarshal cursor: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return Cursor{}, fmt.Errorf("unmarshal cursor: trailing data")
	}
	if c.LastID == 0 || c.CreatedAt.IsZero() {
		return Cursor{}, fmt.Errorf("unmarshal cursor: incomplete anchor")
	}
	canonical, err := json.Marshal(c)
	if err != nil || !bytes.Equal(canonical, b) {
		return Cursor{}, fmt.Errorf("unmarshal cursor: non-canonical encoding")
	}
	return c, nil
}

// MultiSourceCursor encodes the "where I left off" token for each of the
// independent sources merged by the HOME timeline (see
// `docs/architecture/domains/social/core/moments.md §6.4`). Each named source can be
// at a different position because the merge is a heap-style interleave by
// `CreatedAt` rather than a SQL UNION.
//
// A nil entry means "this source is exhausted"; the merger simply skips
// querying it on the next page.
type MultiSourceCursor struct {
	Sources map[string]*Cursor `json:"src,omitempty"`
}

// Source returns the cursor for the named source, or a zero cursor (start
// from beginning) if the source is not present in the map.
func (m MultiSourceCursor) Source(name string) Cursor {
	if c, ok := m.Sources[name]; ok && c != nil {
		return *c
	}
	return Cursor{}
}

// SetSource records the cursor for a named source. A nil cursor marks the
// source as exhausted.
func (m *MultiSourceCursor) SetSource(name string, c *Cursor) {
	if m.Sources == nil {
		m.Sources = make(map[string]*Cursor)
	}
	m.Sources[name] = c
}

// Encode / DecodeMultiSourceCursor mirror the single-source helpers.
func (m MultiSourceCursor) Encode() string {
	if len(m.Sources) == 0 {
		return ""
	}
	b, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// HotCursor encodes a pagination position for a HOT-sorted timeline.
// HOT pages must order by (score DESC, created_at DESC, id DESC) so we
// pin all three values; the `(score, created_at, id) < (?, ?, ?)`
// row-value comparison gives stable, gap-free pagination on every
// engine that supports row-value compare (postgres + sqlite ≥ 3.15).
//
// Score is intentionally encoded as float64 — the SQL formula is a
// real number, and the cursor must round-trip the exact value the
// previous page emitted to avoid skipping rows that share the same
// integer floor.
type HotCursor struct {
	Score     float64   `json:"s,omitempty"`
	CreatedAt time.Time `json:"ts,omitempty"`
	LastID    uint64    `json:"id,omitempty"`
}

func (c HotCursor) IsZero() bool {
	return c.Score == 0 && c.LastID == 0 && c.CreatedAt.IsZero()
}

func (c HotCursor) Encode() string {
	if c.IsZero() {
		return ""
	}
	b, err := json.Marshal(c)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func DecodeHotCursor(s string) (HotCursor, error) {
	if s == "" {
		return HotCursor{}, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return HotCursor{}, fmt.Errorf("decode hot cursor: %w", err)
	}
	var c HotCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return HotCursor{}, fmt.Errorf("unmarshal hot cursor: %w", err)
	}
	return c, nil
}

func DecodeMultiSourceCursor(s string) (MultiSourceCursor, error) {
	if s == "" {
		return MultiSourceCursor{}, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return MultiSourceCursor{}, fmt.Errorf("decode multi-source cursor: %w", err)
	}
	var m MultiSourceCursor
	if err := json.Unmarshal(b, &m); err != nil {
		return MultiSourceCursor{}, fmt.Errorf("unmarshal multi-source cursor: %w", err)
	}
	return m, nil
}
