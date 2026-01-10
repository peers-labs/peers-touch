package crypto

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

func SignData(data []byte, privateKeyPEM string) (string, error) {
	privateKey, err := ParseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return "", fmt.Errorf("failed to parse private key: %w", err)
	}

	hashed := sha256.Sum256(data)
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hashed[:])
	if err != nil {
		return "", fmt.Errorf("failed to sign data: %w", err)
	}

	return base64.StdEncoding.EncodeToString(signature), nil
}

func VerifySignature(data []byte, signatureBase64 string, publicKeyPEM string) error {
	publicKey, err := ParseRSAPublicKey(publicKeyPEM)
	if err != nil {
		return fmt.Errorf("failed to parse public key: %w", err)
	}

	signature, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		return fmt.Errorf("failed to decode signature: %w", err)
	}

	hashed := sha256.Sum256(data)
	err = rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, hashed[:], signature)
	if err != nil {
		return fmt.Errorf("signature verification failed: %w", err)
	}

	return nil
}

func EncryptData(data []byte, publicKeyPEM string) (string, error) {
	publicKey, err := ParseRSAPublicKey(publicKeyPEM)
	if err != nil {
		return "", fmt.Errorf("failed to parse public key: %w", err)
	}

	encrypted, err := rsa.EncryptPKCS1v15(rand.Reader, publicKey, data)
	if err != nil {
		return "", fmt.Errorf("failed to encrypt data: %w", err)
	}

	return base64.StdEncoding.EncodeToString(encrypted), nil
}

func DecryptData(encryptedBase64 string, privateKeyPEM string) ([]byte, error) {
	privateKey, err := ParseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	encrypted, err := base64.StdEncoding.DecodeString(encryptedBase64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode encrypted data: %w", err)
	}

	decrypted, err := rsa.DecryptPKCS1v15(rand.Reader, privateKey, encrypted)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt data: %w", err)
	}

	return decrypted, nil
}
