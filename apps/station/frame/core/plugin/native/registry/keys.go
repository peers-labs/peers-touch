package native

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"crypto/rand"
	"github.com/libp2p/go-libp2p/core/crypto"
)

func loadOrGenerateKey(keyFilePath string) (crypto.PrivKey, error) {
	// region checks keyFilePath is under the working directory
	// because we need to avoid hacker to load key from other directories or access the risk directories
	wd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory: %w", err)
	}

	absKeyPath, err := filepath.Abs(keyFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to get absolute path of key file: %w", err)
	}

	relPath, err := filepath.Rel(wd, absKeyPath)
	if err != nil {
		return nil, fmt.Errorf("key file path is not under the working directory: %w", err)
	}

	if strings.HasPrefix(relPath, "..") {
		return nil, fmt.Errorf("key file path is not under the working directory")
	}
	// endregion

	// Try to load existing key
	if data, err := os.ReadFile(keyFilePath); err == nil {
		return crypto.UnmarshalPrivateKey(data)
	}

	// Generate new key
	privKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, err
	}

	// Save the key
	data, err := crypto.MarshalPrivateKey(privKey)
	if err != nil {
		return nil, err
	}

	if err := os.WriteFile(keyFilePath, data, 0600); err != nil {
		return nil, err
	}

	return privKey, nil
}
