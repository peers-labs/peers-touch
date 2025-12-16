package oss

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
)

func hmacHex(secret, msg string) string {
    if secret == "" { return "" }
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(msg))
    return hex.EncodeToString(mac.Sum(nil))
}

type urlQuery interface{ Get(string) string }

