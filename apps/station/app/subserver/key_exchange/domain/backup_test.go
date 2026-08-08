package domain

import (
	"errors"
	"testing"
)

func validBackup() NewCryptoBackup {
	return NewCryptoBackup{
		EncryptedBlob: []byte("opaque-ciphertext"),
		Nonce:         make([]byte, BackupNonceBytes),
		IntegrityTag:  make([]byte, BackupIntegrityTagBytes),
		KDF: BackupKDFParameters{
			Salt:          make([]byte, MinBackupSaltBytes),
			MemoryCostKiB: 64 * 1024,
			TimeCost:      3,
			Parallelism:   1,
			OutputLength:  BackupKeyOutputBytes,
		},
	}
}

func TestValidateNewCryptoBackup(t *testing.T) {
	if err := ValidateNewCryptoBackup(validBackup()); err != nil {
		t.Fatalf("valid backup rejected: %v", err)
	}

	tests := map[string]func(*NewCryptoBackup){
		"empty blob": func(backup *NewCryptoBackup) {
			backup.EncryptedBlob = nil
		},
		"oversized blob": func(backup *NewCryptoBackup) {
			backup.EncryptedBlob = make([]byte, MaxEncryptedBackupBlobBytes+1)
		},
		"wrong nonce": func(backup *NewCryptoBackup) {
			backup.Nonce = make([]byte, BackupNonceBytes-1)
		},
		"wrong tag": func(backup *NewCryptoBackup) {
			backup.IntegrityTag = make([]byte, BackupIntegrityTagBytes-1)
		},
		"short salt": func(backup *NewCryptoBackup) {
			backup.KDF.Salt = make([]byte, MinBackupSaltBytes-1)
		},
		"low memory": func(backup *NewCryptoBackup) {
			backup.KDF.MemoryCostKiB = MinArgon2MemoryCostKiB - 1
		},
		"high memory": func(backup *NewCryptoBackup) {
			backup.KDF.MemoryCostKiB = MaxArgon2MemoryCostKiB + 1
		},
		"zero time": func(backup *NewCryptoBackup) {
			backup.KDF.TimeCost = 0
		},
		"high time": func(backup *NewCryptoBackup) {
			backup.KDF.TimeCost = MaxArgon2TimeCost + 1
		},
		"zero parallelism": func(backup *NewCryptoBackup) {
			backup.KDF.Parallelism = 0
		},
		"high parallelism": func(backup *NewCryptoBackup) {
			backup.KDF.Parallelism = MaxArgon2Parallelism + 1
		},
		"wrong output length": func(backup *NewCryptoBackup) {
			backup.KDF.OutputLength = BackupKeyOutputBytes - 1
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			backup := validBackup()
			mutate(&backup)
			err := ValidateNewCryptoBackup(backup)
			if !errors.Is(err, ErrInvalidBackup) {
				t.Fatalf("error = %v, want ErrInvalidBackup", err)
			}
		})
	}
}
