package activitypub

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	m "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// SignatureData holds parsed signature header fields
type SignatureData struct {
	KeyID     string
	Algorithm string
	Headers   []string
	Signature string
}

// VerifyHTTPSignature verifies the HTTP signature of the incoming request
func VerifyHTTPSignature(c context.Context, method string, path string, headers map[string]string, body []byte) error {
	// 1. Get Signature Header
	sigHeader := headers["signature"]
	if sigHeader == "" {
		// Fallback to case-insensitive lookup if map keys are not normalized
		for k, v := range headers {
			if strings.ToLower(k) == "signature" {
				sigHeader = v
				break
			}
		}
	}
	if sigHeader == "" {
		return errors.New("missing Signature header")
	}

	// 2. Parse Signature Header
	sigData, err := parseSignatureHeader(sigHeader)
	if err != nil {
		return fmt.Errorf("invalid signature header: %w", err)
	}

	// 3. Fetch Public Key
	pubKey, err := fetchPublicKey(c, sigData.KeyID)
	if err != nil {
		return fmt.Errorf("failed to fetch public key: %w", err)
	}

	// 4. Construct Signing String
	signingString, err := buildSigningString(method, path, headers, sigData.Headers)
	if err != nil {
		return fmt.Errorf("failed to build signing string: %w", err)
	}

	// 5. Verify Signature
	signature, err := base64.StdEncoding.DecodeString(sigData.Signature)
	if err != nil {
		return fmt.Errorf("invalid base64 signature: %w", err)
	}

	// 6. Verify Digest if present in headers
	for _, h := range sigData.Headers {
		if strings.ToLower(h) == "digest" {
			if err := verifyDigest(headers, body); err != nil {
				return fmt.Errorf("digest verification failed: %w", err)
			}
			break
		}
	}

	// Assuming RSA-SHA256 for now (ActivityPub standard)
	rsaPubKey, ok := pubKey.(*rsa.PublicKey)
	if !ok {
		return errors.New("public key is not an RSA key")
	}

	hashed := sha256.Sum256([]byte(signingString))
	err = rsa.VerifyPKCS1v15(rsaPubKey, crypto.SHA256, hashed[:], signature)
	if err != nil {
		return fmt.Errorf("signature verification failed: %w", err)
	}

	return nil
}

func parseSignatureHeader(header string) (*SignatureData, error) {
	parts := strings.Split(header, ",")
	data := &SignatureData{}

	for _, part := range parts {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		key := kv[0]
		value := strings.Trim(kv[1], "\"")

		switch key {
		case "keyId":
			data.KeyID = value
		case "algorithm":
			data.Algorithm = value
		case "headers":
			data.Headers = strings.Split(value, " ")
		case "signature":
			data.Signature = value
		}
	}

	if data.KeyID == "" || data.Signature == "" {
		return nil, errors.New("missing required signature fields")
	}
	if len(data.Headers) == 0 {
		// Default headers if not specified: (request-target) date (but usually it's specified)
		data.Headers = []string{"(request-target)", "date"}
	}

	return data, nil
}

func buildSigningString(method string, path string, headers map[string]string, requiredHeaders []string) (string, error) {
	var sb strings.Builder

	for i, header := range requiredHeaders {
		if i > 0 {
			sb.WriteString("\n")
		}

		headerName := strings.ToLower(header)
		sb.WriteString(headerName)
		sb.WriteString(": ")

		switch headerName {
		case "(request-target)":
			// method is already lowercased by caller usually, but let's ensure
			sb.WriteString(fmt.Sprintf("%s %s", strings.ToLower(method), path))
		case "host":
			// Host is usually in headers map
			val := getHeader(headers, "host")
			if val == "" {
				return "", errors.New("missing host header")
			}
			sb.WriteString(val)
		default:
			val := getHeader(headers, headerName)
			if val == "" {
				return "", fmt.Errorf("missing header required for signature: %s", header)
			}
			sb.WriteString(val)
		}
	}

	return sb.String(), nil
}

func getHeader(headers map[string]string, key string) string {
	if v, ok := headers[key]; ok {
		return v
	}
	// Try case-insensitive
	keyLower := strings.ToLower(key)
	for k, v := range headers {
		if strings.ToLower(k) == keyLower {
			return v
		}
	}
	return ""
}

// Helper struct for parsing Actor JSON
type actorPublicKey struct {
	ID           string `json:"id"`
	Owner        string `json:"owner"`
	PublicKeyPem string `json:"publicKeyPem"`
}

type remoteActor struct {
	PublicKey actorPublicKey `json:"publicKey"`
}

func fetchPublicKey(c context.Context, keyID string) (crypto.PublicKey, error) {
	// TODO: Implement caching for keys to avoid fetching on every request

	req, err := http.NewRequestWithContext(c, "GET", keyID, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", m.AcceptActivityJSONLD)

	// Use default client for now. In production, use a client with timeout and limits.
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch key, status: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var actor remoteActor
	if err := json.Unmarshal(bodyBytes, &actor); err != nil {
		return nil, fmt.Errorf("failed to parse actor JSON: %w", err)
	}

	if actor.PublicKey.PublicKeyPem == "" {
		// Fallback: maybe the keyID *is* the key object, not the actor?
		// Try parsing as key object directly
		var keyObj actorPublicKey
		if err := json.Unmarshal(bodyBytes, &keyObj); err == nil && keyObj.PublicKeyPem != "" {
			actor.PublicKey = keyObj
		} else {
			return nil, errors.New("public key PEM not found in response")
		}
	}

	block, _ := pem.Decode([]byte(actor.PublicKey.PublicKeyPem))
	if block == nil {
		return nil, errors.New("failed to parse PEM block")
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse PKIX public key: %w", err)
	}

	return pub, nil
}

func verifyDigest(headers map[string]string, body []byte) error {
	digestHeader := getHeader(headers, "digest")
	if digestHeader == "" {
		return errors.New("missing Digest header")
	}

	hash := sha256.Sum256(body)
	calculatedDigest := "SHA-256=" + base64.StdEncoding.EncodeToString(hash[:])

	if digestHeader != calculatedDigest {
		return fmt.Errorf("digest mismatch: expected %s, got %s", calculatedDigest, digestHeader)
	}

	return nil
}
