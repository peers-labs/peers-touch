package domain

import (
	"errors"
	"fmt"
	"time"
)

const (
	BackupRetentionLimit = 5

	MaxEncryptedBackupBlobBytes = 64 << 20
	BackupNonceBytes             = 12
	BackupIntegrityTagBytes      = 16
	MinBackupSaltBytes           = 16
	MaxBackupSaltBytes           = 64

	MinArgon2MemoryCostKiB = 19 * 1024
	MaxArgon2MemoryCostKiB = 1024 * 1024
	MinArgon2TimeCost      = 1
	MaxArgon2TimeCost      = 10
	MinArgon2Parallelism   = 1
	MaxArgon2Parallelism   = 16
	BackupKeyOutputBytes   = 32
)

var (
	ErrInvalidBackup   = errors.New("key_exchange: invalid crypto backup")
	ErrBackupNotFound  = errors.New("key_exchange: crypto backup not found")
	ErrBackupImmutable = errors.New("key_exchange: crypto backup revisions are immutable")
)

type BackupKDFParameters struct {
	Salt          []byte
	MemoryCostKiB uint32
	TimeCost      uint32
	Parallelism   uint32
	OutputLength  uint32
}

type CryptoBackupRevision struct {
	BackupID     string
	Ptid         string
	Revision     uint64
	EncryptedBlob []byte
	Nonce        []byte
	IntegrityTag []byte
	KDF          BackupKDFParameters
	CreatedAt    time.Time
}

type NewCryptoBackup struct {
	EncryptedBlob []byte
	Nonce         []byte
	IntegrityTag  []byte
	KDF           BackupKDFParameters
}

func ValidateNewCryptoBackup(backup NewCryptoBackup) error {
	if len(backup.EncryptedBlob) == 0 ||
		len(backup.EncryptedBlob) > MaxEncryptedBackupBlobBytes {
		return fmt.Errorf(
			"%w: "+
			"encrypted_blob must contain 1..%d bytes",
			ErrInvalidBackup,
			MaxEncryptedBackupBlobBytes,
		)
	}
	if len(backup.Nonce) != BackupNonceBytes {
		return fmt.Errorf(
			"%w: nonce must contain exactly %d bytes",
			ErrInvalidBackup,
			BackupNonceBytes,
		)
	}
	if len(backup.IntegrityTag) != BackupIntegrityTagBytes {
		return fmt.Errorf(
			"%w: integrity_tag must contain exactly %d bytes",
			ErrInvalidBackup,
			BackupIntegrityTagBytes,
		)
	}
	if len(backup.KDF.Salt) < MinBackupSaltBytes ||
		len(backup.KDF.Salt) > MaxBackupSaltBytes {
		return fmt.Errorf(
			"%w: kdf.salt must contain %d..%d bytes",
			ErrInvalidBackup,
			MinBackupSaltBytes,
			MaxBackupSaltBytes,
		)
	}
	if backup.KDF.MemoryCostKiB < MinArgon2MemoryCostKiB ||
		backup.KDF.MemoryCostKiB > MaxArgon2MemoryCostKiB {
		return fmt.Errorf(
			"%w: kdf.memory_cost_kib must be within %d..%d",
			ErrInvalidBackup,
			MinArgon2MemoryCostKiB,
			MaxArgon2MemoryCostKiB,
		)
	}
	if backup.KDF.TimeCost < MinArgon2TimeCost ||
		backup.KDF.TimeCost > MaxArgon2TimeCost {
		return fmt.Errorf(
			"%w: kdf.time_cost must be within %d..%d",
			ErrInvalidBackup,
			MinArgon2TimeCost,
			MaxArgon2TimeCost,
		)
	}
	if backup.KDF.Parallelism < MinArgon2Parallelism ||
		backup.KDF.Parallelism > MaxArgon2Parallelism {
		return fmt.Errorf(
			"%w: kdf.parallelism must be within %d..%d",
			ErrInvalidBackup,
			MinArgon2Parallelism,
			MaxArgon2Parallelism,
		)
	}
	if backup.KDF.OutputLength != BackupKeyOutputBytes {
		return fmt.Errorf(
			"%w: kdf.output_length must equal %d",
			ErrInvalidBackup,
			BackupKeyOutputBytes,
		)
	}
	return nil
}
