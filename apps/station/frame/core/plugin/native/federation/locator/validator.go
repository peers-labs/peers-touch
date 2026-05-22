// validator.go — go-libp2p-record Validator implementation for the
// /pst-actor/<handle> namespace.
//
// kad-dht consults the validator on every PutValue / GetValue. We refuse to
// store a record whose signature does not pass Verify, so a tampered or
// unsigned record cannot pollute the routing table. Tombstones win over
// live records of the same seq (operator-controlled withdrawal beats a
// concurrent keep-alive publish).

package locator

import (
	"bytes"
	"fmt"
	"time"

	pb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	"google.golang.org/protobuf/proto"
)

// RecordValidator implements record.Validator for the locator namespace.
//
// The zero value is functional. Tests can override Now via NewValidator.
type RecordValidator struct {
	// now is the clock used for freshness comparison. Defaults to
	// time.Now when zero-valued.
	now func() time.Time
}

// NewValidator constructs a RecordValidator with a custom clock. Production
// callers pass nil and get the default time.Now.
func NewValidator(now func() time.Time) *RecordValidator {
	if now == nil {
		now = time.Now
	}
	return &RecordValidator{now: now}
}

// Validate parses the value as an ActorLocatorRecord, verifies signature
// freshness, and ensures the record's federated_handle matches the DHT key.
//
// kad-dht treats a non-nil error as "drop this record". Callers MUST be
// strict: silent acceptance of a malformed record opens us up to spoofed
// /pst-actor/<handle> redirections.
func (v *RecordValidator) Validate(key string, value []byte) error {
	handle, err := ParseKey(key)
	if err != nil {
		return fmt.Errorf("locator: validate: %w", err)
	}
	rec := &pb.ActorLocatorRecord{}
	if err := proto.Unmarshal(value, rec); err != nil {
		return fmt.Errorf("locator: validate: unmarshal: %w", err)
	}
	now := v.clock()
	return Verify(rec, VerifyOptions{ExpectedHandle: handle, Now: now})
}

// Select picks the "best" of multiple values offered for the same key.
//
// Decision order (highest priority first):
//  1. Higher seq wins. Stickiness comes from the publisher's monotonic
//     locator_seq counter, NOT from the tombstone bit — every state
//     transition (publish, tombstone, re-publish) carries seq+1, so a
//     re-display always beats a stale withdrawal.
//  2. Tombstone wins on identical seq — disambiguates an operator
//     withdrawal that races a concurrent keep-alive at the same
//     logical generation.
//  3. Newer updated_at_unix_ms wins.
//  4. Lexicographic compare on the signature bytes — final tie-breaker
//     so the choice is deterministic and every node converges on the
//     same value.
//
// All inputs are assumed to have already passed Validate; Select must not
// re-verify (kad-dht has already done that).
func (v *RecordValidator) Select(key string, vals [][]byte) (int, error) {
	if len(vals) == 0 {
		return 0, fmt.Errorf("locator: select: no values")
	}
	type parsed struct {
		idx int
		rec *pb.ActorLocatorRecord
	}
	all := make([]parsed, 0, len(vals))
	for i, raw := range vals {
		rec := &pb.ActorLocatorRecord{}
		if err := proto.Unmarshal(raw, rec); err != nil {
			continue
		}
		all = append(all, parsed{idx: i, rec: rec})
	}
	if len(all) == 0 {
		return 0, fmt.Errorf("locator: select: no parseable values")
	}

	best := all[0]
	for i := 1; i < len(all); i++ {
		if betterRecord(all[i].rec, best.rec) {
			best = all[i]
		}
	}
	return best.idx, nil
}

// betterRecord returns true iff `a` should beat `b` per the priority order
// documented on Select.
func betterRecord(a, b *pb.ActorLocatorRecord) bool {
	if a.GetSeq() != b.GetSeq() {
		return a.GetSeq() > b.GetSeq()
	}
	if a.GetTombstone() != b.GetTombstone() {
		return a.GetTombstone()
	}
	if a.GetUpdatedAtUnixMs() != b.GetUpdatedAtUnixMs() {
		return a.GetUpdatedAtUnixMs() > b.GetUpdatedAtUnixMs()
	}
	return bytes.Compare(a.GetSignature(), b.GetSignature()) > 0
}

func (v *RecordValidator) clock() time.Time {
	if v == nil || v.now == nil {
		return time.Now()
	}
	return v.now()
}
