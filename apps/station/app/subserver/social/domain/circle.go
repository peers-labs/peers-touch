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

// Circle is a publisher-private audience label — a NAMED LIST of actor
// PTIDs owned by a single actor. Members do not know they are in a circle
// (no notification on add/remove). Compare with chat.Group, which is a
// shared bidirectional space.
//
// This is the pure-Go counterpart of the `Circle` proto message used by
// the application service. It MUST be persisted in the `social_private`
// schema (see `docs/architecture/domains/social/core/moments.md` §"Storage invariants")
// and MUST NOT federate over ActivityPub.
type Circle struct {
	ID          uint64
	OwnerPTID   string
	Name        string
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	MemberCount int64
}

// CircleMember is a (Circle x ActorPTID) tuple. Membership uses PTID rather
// than internal uint64 so future cross-Station members can be added
// (still local-only for v1).
type CircleMember struct {
	CircleID  uint64
	ActorPTID string
	AddedAt   time.Time
}

// CircleMemberCursor binds the temporal anchor to its owning circle.
// PTID resolves equal timestamps, including an entire bulk insertion.
type CircleMemberCursor struct {
	CircleID  uint64    `json:"circle"`
	AddedAt   time.Time `json:"ts"`
	ActorPTID string    `json:"ptid"`
}

func (c CircleMemberCursor) IsZero() bool {
	return c.CircleID == 0 && c.AddedAt.IsZero() && c.ActorPTID == ""
}

func (c CircleMemberCursor) Encode() string {
	if c.IsZero() {
		return ""
	}
	b, err := json.Marshal(c)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func DecodeCircleMemberCursor(s string, circleID uint64) (CircleMemberCursor, error) {
	if s == "" {
		return CircleMemberCursor{}, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || base64.RawURLEncoding.EncodeToString(b) != s {
		return CircleMemberCursor{}, fmt.Errorf("non-canonical member cursor")
	}
	var c CircleMemberCursor
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&c); err != nil {
		return CircleMemberCursor{}, fmt.Errorf("invalid member cursor: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return CircleMemberCursor{}, fmt.Errorf("trailing member cursor data")
	}
	if c.CircleID == 0 || c.CircleID != circleID || c.AddedAt.IsZero() ||
		c.ActorPTID == "" || c.ActorPTID != strings.TrimSpace(c.ActorPTID) ||
		strings.ContainsRune(c.ActorPTID, '\x00') {
		return CircleMemberCursor{}, fmt.Errorf("invalid member cursor anchor")
	}
	canonical, err := json.Marshal(c)
	if err != nil || !bytes.Equal(canonical, b) {
		return CircleMemberCursor{}, fmt.Errorf("non-canonical member cursor")
	}
	return c, nil
}

// Length bounds for Circle invariants. UTF-8 rune counts (not bytes) so
// CJK names are not unfairly penalised.
const (
	CircleNameMin = 1
	CircleNameMax = 32
	CircleDescMax = 200
)

// ValidateCircle enforces invariants on a Circle before it is persisted
// or returned to clients. The owner is REQUIRED — circles cannot be
// orphans.
func ValidateCircle(c *Circle) error {
	if c == nil {
		return fmt.Errorf("circle is nil")
	}
	if c.OwnerPTID == "" {
		return fmt.Errorf("circle owner_ptid must be set")
	}
	name := strings.TrimSpace(c.Name)
	if name == "" {
		return fmt.Errorf("circle name must not be blank")
	}
	if n := len([]rune(name)); n < CircleNameMin || n > CircleNameMax {
		return fmt.Errorf("circle name length must be in [%d, %d] runes", CircleNameMin, CircleNameMax)
	}
	if len([]rune(c.Description)) > CircleDescMax {
		return fmt.Errorf("circle description must not exceed %d runes", CircleDescMax)
	}
	return nil
}
