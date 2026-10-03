package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
)

const maxInputBytes = 128 << 20

type verificationRequest struct {
	ActiveKeyID string            `json:"active_key_id"`
	Keys        map[string]string `json:"keys"`
	Records     []encryptedRecord `json:"records"`
}

type encryptedRecord struct {
	Path    string `json:"path"`
	Payload string `json:"payload"`
}

type verificationResult struct {
	Status                   string `json:"status"`
	RecordCount              int    `json:"record_count"`
	ActiveKeyEnvelopeCount   int    `json:"active_key_envelope_count"`
	RetainedKeyEnvelopeCount int    `json:"retained_key_envelope_count"`
}

func decodeSecret(value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil || len(decoded) != 32 {
		return nil, errors.New("invalid encryption key")
	}
	return decoded, nil
}

func recordKind(path string) (string, error) {
	switch {
	case strings.HasPrefix(path, "oauth-data/transactions/"):
		return "authorization-transaction", nil
	case strings.HasPrefix(path, "oauth-data/identities/"):
		return "oauth-identity", nil
	case strings.HasPrefix(path, "oauth-data/credentials/"):
		return "oauth-credential", nil
	case strings.HasPrefix(path, "oauth-data/refresh-operations/"):
		return "oauth-refresh-operation", nil
	case strings.HasPrefix(path, "oauth-data/audits/"):
		return "oauth-audit", nil
	default:
		return "", errors.New("unknown record path")
	}
}

func verify(request verificationRequest) (verificationResult, error) {
	activeKeyID := strings.ToLower(strings.TrimSpace(request.ActiveKeyID))
	keys := make(map[string][]byte, len(request.Keys))
	for id, encoded := range request.Keys {
		decoded, err := decodeSecret(encoded)
		if err != nil {
			return verificationResult{}, err
		}
		keys[strings.ToLower(strings.TrimSpace(id))] = decoded
	}
	codec, err := recordcrypto.NewCodec(activeKeyID, keys)
	if err != nil {
		return verificationResult{}, err
	}

	result := verificationResult{Status: "PASS"}
	for _, record := range request.Records {
		kind, err := recordKind(record.Path)
		if err != nil {
			return verificationResult{}, err
		}
		payload, err := base64.StdEncoding.DecodeString(record.Payload)
		if err != nil {
			return verificationResult{}, errors.New("invalid record payload")
		}
		plaintext, retained, err := codec.Decrypt(kind, record.Path, payload)
		if err != nil {
			return verificationResult{}, errors.New("record authentication failed")
		}
		var decoded any
		if err := json.Unmarshal(plaintext, &decoded); err != nil {
			return verificationResult{}, errors.New("record plaintext is invalid")
		}
		result.RecordCount++
		if retained {
			result.RetainedKeyEnvelopeCount++
		} else {
			result.ActiveKeyEnvelopeCount++
		}
	}
	if result.ActiveKeyEnvelopeCount == 0 {
		return verificationResult{}, errors.New("active key envelope missing")
	}
	return result, nil
}

func run(input io.Reader, output io.Writer) error {
	payload, err := io.ReadAll(io.LimitReader(input, maxInputBytes+1))
	if err != nil || len(payload) > maxInputBytes {
		return errors.New("verification input unavailable")
	}
	var request verificationRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		return errors.New("verification input invalid")
	}
	result, err := verify(request)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "record envelope verification failed")
		os.Exit(2)
	}
}
