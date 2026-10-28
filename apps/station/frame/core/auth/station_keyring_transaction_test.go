package auth

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestStationAccessKeyringTransactionRequiresActiveTransaction(t *testing.T) {
	database := openStationAccessKeyringTestDB(t)
	for _, handle := range []*gorm.DB{nil, {}, database} {
		_, err := StationAccessKeyringInTransaction(handle)
		require.Error(t, err)
	}
}

func TestStationAccessKeyringReadsCallerTransaction(t *testing.T) {
	database := openStationAccessKeyringTestDB(t)
	ctx := context.Background()
	keyring, err := OpenStationAccessKeyring(ctx, database, "public-keyring-transaction-test", "")
	require.NoError(t, err)
	expected, err := keyring.Current(ctx)
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)

	require.NoError(t, database.Transaction(func(tx *gorm.DB) error {
		transactionKeyring, keyErr := StationAccessKeyringInTransaction(tx)
		if keyErr != nil {
			return keyErr
		}
		current, currentErr := transactionKeyring.Current(ctx)
		if currentErr != nil {
			return currentErr
		}
		require.Equal(t, expected, current)
		resolved, resolveErr := transactionKeyring.Resolve(ctx, expected.ID)
		if resolveErr != nil {
			return resolveErr
		}
		require.Equal(t, expected, resolved)
		keys, validationErr := transactionKeyring.ValidationKeys(ctx, expected.ID)
		if validationErr != nil {
			return validationErr
		}
		require.Equal(t, []StationAccessKey{expected}, keys)
		return nil
	}))
	require.Zero(t, sqlDB.Stats().WaitCount)
}
