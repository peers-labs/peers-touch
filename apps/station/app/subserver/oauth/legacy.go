package oauth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
	"gorm.io/gorm"
)

var errLegacyAuthorizationCodeInvalid = errors.New("legacy OAuth authorization code is invalid")

func redeemLegacyAuthorizationCode(
	ctx context.Context,
	database *gorm.DB,
	clientID string,
	code string,
	now time.Time,
) (string, *db.OAuthAuthCode, error) {
	var (
		accessToken string
		authCode    db.OAuthAuthCode
	)

	err := database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&db.OAuthAuthCode{}).
			Where(
				"code_hash = ? AND client_id = ? AND used = ? AND expires_at > ?",
				util.HashString(code),
				clientID,
				false,
				now,
			).
			Update("used", true)
		if result.Error != nil {
			return fmt.Errorf("consume legacy OAuth authorization code: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return errLegacyAuthorizationCodeInvalid
		}

		if err := tx.
			Where("code_hash = ? AND client_id = ?", util.HashString(code), clientID).
			First(&authCode).Error; err != nil {
			return fmt.Errorf("load consumed legacy OAuth authorization code: %w", err)
		}

		var err error
		accessToken, err = util.RandomString(32)
		if err != nil {
			return fmt.Errorf("generate legacy OAuth access token: %w", err)
		}
		token := db.OAuthToken{
			AccessTokenHash: util.HashString(accessToken),
			TokenType:       "Bearer",
			Scope:           authCode.Scopes,
			UserID:          authCode.UserID,
			ClientID:        clientID,
			CreatedAt:       now,
			ExpiresAt:       now.Add(2 * time.Hour),
		}
		if err := tx.Create(&token).Error; err != nil {
			return fmt.Errorf("persist legacy OAuth access token: %w", err)
		}
		return nil
	})
	if err != nil {
		return "", nil, err
	}
	return accessToken, &authCode, nil
}
