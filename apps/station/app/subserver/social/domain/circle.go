package domain

import (
	"fmt"
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
