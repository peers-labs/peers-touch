package native

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"

	"github.com/dirty-bro-tech/peers-touch-go/core/node"
)

func initKeys(sOpts *node.Options) error {
	// Check if keys exist in current directory
	if _, err := os.Stat("private.pem"); err != nil {
		// Generate new RSA keys
		privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return fmt.Errorf("failed to generate private key: %v", err)
		}

		// Save private key
		privBytes := x509.MarshalPKCS1PrivateKey(privateKey)
		privPEM := pem.EncodeToMemory(&pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: privBytes,
		})
		if err := os.WriteFile("private.pem", privPEM, 0600); err != nil {
			return fmt.Errorf("failed to save private key: %v", err)
		}

		// Save public key
		pubBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
		if err != nil {
			return fmt.Errorf("failed to marshal public key: %v", err)
		}
		pubPEM := pem.EncodeToMemory(&pem.Block{
			Type:  "RSA PUBLIC KEY",
			Bytes: pubBytes,
		})
		if err := os.WriteFile("public.pem", pubPEM, 0644); err != nil {
			return fmt.Errorf("failed to save public key: %v", err)
		}
	}

	// Load keys from files
	privData, err := os.ReadFile("private.pem")
	if err != nil {
		return fmt.Errorf("failed to read private key: %v", err)
	}
	pubData, err := os.ReadFile("public.pem")
	if err != nil {
		return fmt.Errorf("failed to read public key: %v", err)
	}

	sOpts.PrivateKey = string(privData)
	sOpts.PublicKey = string(pubData)
	return nil
}
