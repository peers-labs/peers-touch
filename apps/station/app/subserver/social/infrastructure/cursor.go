package infrastructure

import domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"

// Cursor is the infrastructure-layer alias of the domain cursor type.
// It exists only so service packages that already imported
// `infrastructure.Cursor` (notably RelationshipService, which predates
// the C2 cursor refactor) keep compiling without an "import the
// domain package directly" churn cascade.
//
// New code SHOULD prefer `domain.Cursor` directly. This alias may be
// retired in the P4 cleanup wave.
type Cursor = domain.Cursor

// EncodeCursor / DecodeCursor wrap the domain helpers with the legacy
// signature used by RelationshipService. The semantics differ only in
// presentation: the domain helpers expose `Cursor.IsZero` ("did caller
// supply one") whereas the legacy contract uses a `*Cursor` pointer
// for the same check. Both contracts here resolve to the same
// base64url-encoded JSON wire format.
func EncodeCursor(c *Cursor) string {
	if c == nil {
		return ""
	}
	return c.Encode()
}

// DecodeCursor populates `out` from the encoded string. Empty input
// leaves `out` unchanged (callers treated nil/empty interchangeably).
// Returns an error for malformed input — RelationshipService will
// propagate that to the client as a 400.
func DecodeCursor(s string, out *Cursor) error {
	if s == "" || out == nil {
		return nil
	}
	parsed, err := domain.DecodeCursor(s)
	if err != nil {
		return err
	}
	*out = parsed
	return nil
}
