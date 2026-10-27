package service

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PutImmutableContentTx stores content by its sha256 identity. Identical
// bytes are deduplicated globally; actor/domain ownership remains in the
// referencing revision table.
func PutImmutableContentTx(
	tx *gorm.DB,
	actorPTID string,
	content []byte,
	now time.Time,
) (string, uint64, error) {
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])
	blob := persistence.ImmutableContentBlob{
		ContentHash: hash,
		Content:     append([]byte(nil), content...),
		Size:        uint64(len(content)),
		CreatedBy:   actorPTID,
		CreatedAt:   now,
	}
	if err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "content_hash"}},
		DoNothing: true,
	}).Create(&blob).Error; err != nil {
		return "", 0, err
	}
	return hash, uint64(len(content)), nil
}

func GetImmutableContent(tx *gorm.DB, hash string) ([]byte, error) {
	var blob persistence.ImmutableContentBlob
	if err := tx.Where("content_hash = ?", hash).First(&blob).Error; err != nil {
		return nil, err
	}
	return blob.Content, nil
}
