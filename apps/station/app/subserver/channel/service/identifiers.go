package service

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

func truncateTitle(text string) string {
	text = strings.TrimSpace(text)
	if runes := []rune(text); len(runes) > 48 {
		return string(runes[:48])
	}
	return text
}

func newChannelConversationID() string {
	return "chc-" + randomToken(12)
}

func newDeliveryID(identity string) string {
	if strings.TrimSpace(identity) != "" {
		return "del-" + sanitizeToken(identity)
	}
	return "del-" + randomToken(16)
}

func sanitizeToken(value string) string {
	var result strings.Builder
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '-' || character == '_' {
			result.WriteRune(character)
		}
		if result.Len() >= 48 {
			break
		}
	}
	if result.Len() == 0 {
		return randomToken(16)
	}
	return result.String()
}

func randomToken(byteCount int) string {
	body := make([]byte, byteCount)
	_, _ = rand.Read(body)
	return hex.EncodeToString(body)
}
