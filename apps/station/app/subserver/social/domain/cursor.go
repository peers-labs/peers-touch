package domain

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return Cursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var c Cursor
	if err := json.Unmarshal(b, &c); err != nil {
		return Cursor{}, fmt.Errorf("unmarshal cursor: %w", err)
	}
	return c, nil
}

// MultiSourceCursor encodes the "where I left off" token for each of the
// independent sources merged by the HOME timeline (see
// `docs/architecture/social/moments.md §6.4`). Each named source can be
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
