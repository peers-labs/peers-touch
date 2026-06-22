package accessgate

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// InviteCodeInput is the Dashboard-supplied data for minting a new code.
type InviteCodeInput struct {
	Code      string
	Note      string
	MaxUses   int
	ExpiresAt *time.Time
	CreatedBy string
}

// errInviteCodeInvalid is returned to the invite.code gate when a submitted code
// is unknown, revoked, expired, or exhausted. The gate maps it to a single
// blocking reason so a probe cannot distinguish which condition failed.
var errInviteCodeInvalid = errors.New("invite code is invalid")

// CreateInviteCode mints and persists a new invite code. An empty input code
// triggers random generation; an explicit code must be unique.
func CreateInviteCode(ctx context.Context, input InviteCodeInput) (*dbmodel.AccessInviteCode, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	code := normalizeCode(input.Code)
	if code == "" {
		code = generateInviteCode()
	}

	maxUses := input.MaxUses
	if maxUses < 0 {
		maxUses = 0
	}

	row := &dbmodel.AccessInviteCode{
		ID:        newInviteCodeID(),
		Code:      code,
		Note:      strings.TrimSpace(input.Note),
		MaxUses:   maxUses,
		CreatedBy: strings.TrimSpace(input.CreatedBy),
		ExpiresAt: input.ExpiresAt,
	}
	if err := rds.WithContext(ctx).Create(row).Error; err != nil {
		return nil, fmt.Errorf("create invite code: %w", err)
	}
	return row, nil
}

// ListInviteCodes returns all codes, optionally including revoked ones, newest
// first so the Dashboard shows the most recent activity at the top.
func ListInviteCodes(ctx context.Context, includeRevoked bool) ([]dbmodel.AccessInviteCode, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	q := rds.WithContext(ctx).Order("created_at DESC")
	if !includeRevoked {
		q = q.Where("revoked = ?", false)
	}

	var rows []dbmodel.AccessInviteCode
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// RevokeInviteCode marks a code revoked. A revoked code can never pass the gate
// again, even if it still has remaining uses.
func RevokeInviteCode(ctx context.Context, id string) (*dbmodel.AccessInviteCode, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("invite code id required")
	}

	if err := rds.WithContext(ctx).Model(&dbmodel.AccessInviteCode{}).
		Where("id = ?", id).Update("revoked", true).Error; err != nil {
		return nil, err
	}

	var row dbmodel.AccessInviteCode
	if err := rds.WithContext(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// redeemInviteCode validates and atomically consumes one use of a code. It is
// the only place that increments usage, run inside a transaction with a row lock
// so concurrent redemptions of a single-use code cannot both succeed.
func redeemInviteCode(ctx context.Context, rawCode string) error {
	code := normalizeCode(rawCode)
	if code == "" {
		return errInviteCodeInvalid
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	return rds.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row dbmodel.AccessInviteCode
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("code = ?", code).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errInviteCodeInvalid
			}
			return err
		}

		if !inviteCodeUsable(&row) {
			return errInviteCodeInvalid
		}

		now := time.Now()
		updates := map[string]any{
			"used_count":   row.UsedCount + 1,
			"last_used_at": &now,
		}
		return tx.Model(&dbmodel.AccessInviteCode{}).
			Where("id = ?", row.ID).Updates(updates).Error
	})
}

// inviteCodeUsable reports whether a code can still be redeemed: not revoked, not
// expired, and within its usage budget (zero MaxUses means unlimited).
func inviteCodeUsable(row *dbmodel.AccessInviteCode) bool {
	if row.Revoked {
		return false
	}
	if row.ExpiresAt != nil && time.Now().After(*row.ExpiresAt) {
		return false
	}
	if row.MaxUses > 0 && row.UsedCount >= row.MaxUses {
		return false
	}
	return true
}

func ToProtoInviteCode(row *dbmodel.AccessInviteCode) *pb.InviteCode {
	out := &pb.InviteCode{
		Id:        row.ID,
		Code:      row.Code,
		Note:      row.Note,
		MaxUses:   int32(row.MaxUses),
		UsedCount: int32(row.UsedCount),
		Revoked:   row.Revoked,
		CreatedBy: row.CreatedBy,
		CreatedAt: timestamppb.New(row.CreatedAt),
	}
	if row.ExpiresAt != nil {
		out.ExpiresAt = timestamppb.New(*row.ExpiresAt)
	}
	if row.LastUsedAt != nil {
		out.LastUsedAt = timestamppb.New(*row.LastUsedAt)
	}
	return out
}

func normalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// generateInviteCode produces a human-typable random code. base32 without
// padding avoids ambiguous separators while keeping the alphabet copy-friendly.
func generateInviteCode() string {
	var b [10]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("INV%d", time.Now().UnixNano())
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:])
}

func newInviteCodeID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("invite-%d", time.Now().UnixNano())
	}
	return "invite-" + base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:])
}
