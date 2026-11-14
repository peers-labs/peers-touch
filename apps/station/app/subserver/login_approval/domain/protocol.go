// Package domain defines the immutable bindings of a claimant-first login
// approval transaction. It owns protocol constants, typed errors, deterministic
// encoding, possession-secret hashing and the comparison-code derivation.
package domain

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"strings"
	"time"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/loginapproval"
	"google.golang.org/protobuf/proto"
)

const (
	// ApprovalDomain separates the login-approval transcript purpose from the
	// device-link one; the two transcripts must never be interchangeable.
	ApprovalDomain   = "peers-touch/login-approval/approval/v1\x00"
	CapabilityDomain = "peers-touch/login-approval/capability/v1\x00"
	MaxProtocolBytes = 32 * 1024
	// MaxPendingPerActor bounds concurrent uncommitted requests per Actor.
	MaxPendingPerActor = 3
	// MaxPendingList caps what one approver read returns.
	MaxPendingList = 10
	// TTL is the lifetime of an uncommitted approval transaction.
	TTL = 10 * time.Minute
)

// Error projects a typed failure code and an optional secret-free status.
type Error struct {
	Code   pb.LoginApprovalErrorCode
	Status *pb.LoginApprovalProjection
}

func (e *Error) Error() string                    { return "login_approval: " + e.Code.String() }
func Reject(code pb.LoginApprovalErrorCode) error { return &Error{Code: code} }

func Encode(message proto.Message) ([]byte, error) {
	return proto.MarshalOptions{Deterministic: true}.Marshal(message)
}

func Decode(raw []byte, message proto.Message) error {
	if len(raw) == 0 || len(raw) > MaxProtocolBytes {
		return Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	if err := proto.Unmarshal(raw, message); err != nil {
		return Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	canonical, err := Encode(message)
	if err != nil || !bytes.Equal(canonical, raw) || hasUnknown(message.ProtoReflect()) {
		return Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	return nil
}

func Digest(raw []byte) []byte {
	hash := sha256.Sum256(raw)
	return hash[:]
}

func Random(size int) ([]byte, error) {
	raw := make([]byte, size)
	_, err := rand.Read(raw)
	return raw, err
}

// SameSecret constant-time compares a 32-byte possession secret against its
// stored SHA-256 hash. Capabilities are never persisted in clear form.
func SameSecret(secret, hash []byte) bool {
	return len(secret) == 32 && subtle.ConstantTimeCompare(Digest(secret), hash) == 1
}

func Identifier(value string, limit int) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= limit &&
		!strings.ContainsRune(value, '\x00')
}

func ValidPlatform(value string) bool {
	return value == "desktop" || value == "android" || value == "ios"
}

// Terminal reports whether a state can no longer transition.
func Terminal(state pb.LoginApprovalState) bool {
	switch state {
	case pb.LoginApprovalState_LOGIN_APPROVAL_STATE_COMMITTED,
		pb.LoginApprovalState_LOGIN_APPROVAL_STATE_DENIED,
		pb.LoginApprovalState_LOGIN_APPROVAL_STATE_CANCELLED,
		pb.LoginApprovalState_LOGIN_APPROVAL_STATE_EXPIRED:
		return true
	default:
		return false
	}
}

// ComparisonCode derives a human-checkable six-digit code from the approval
// transcript digest. It is a visual check, never a redemption credential.
func ComparisonCode(transcriptDigest []byte) string {
	hash := Digest(append([]byte(ApprovalDomain), transcriptDigest...))
	value := uint32(hash[0])<<24 | uint32(hash[1])<<16 | uint32(hash[2])<<8 | uint32(hash[3])
	return fmt.Sprintf("%06d", value%1_000_000)
}
