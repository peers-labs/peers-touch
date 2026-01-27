package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"log"
	"net"
	"os"

	"github.com/flynn/noise"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	LengthPrefixLength = 2
)

func main() {
	port := os.Getenv("LIBP2P_PORT")
	if port == "" {
		port = "5003" // Different port
	}

	listener, err := net.Listen("tcp", "0.0.0.0:"+port)
	if err != nil {
		log.Fatalf("listen error: %v", err)
	}
	defer listener.Close()

	fmt.Printf("Noise debug server listening on port %s\n", port)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("accept error: %v", err)
			continue
		}
		go handleConnection(conn)
	}
}

func handleConnection(conn net.Conn) {
	defer conn.Close()
	fmt.Println("\n=== New connection ===")

	// Read multistream header
	header := make([]byte, 1024)
	n, _ := conn.Read(header)
	fmt.Printf("Received multistream: %s\n", string(header[:n]))
	
	// Send multistream response
	conn.Write([]byte("\x13/multistream/1.0.0\n"))
	
	// Read protocol negotiation
	n, _ = conn.Read(header)
	fmt.Printf("Received protocol request: %s\n", string(header[:n]))
	
	// Send protocol response
	conn.Write([]byte("\x07/noise\n"))

	// Now do Noise handshake
	runNoiseHandshake(conn)
}

func runNoiseHandshake(conn net.Conn) {
	// Generate keypairs
	cs := noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashSHA256)
	
	staticKP, _ := cs.GenerateKeypair(rand.Reader)
	ephemeralKP, _ := cs.GenerateKeypair(rand.Reader)
	
	fmt.Printf("Responder static pub: %s\n", hex.EncodeToString(staticKP.Public))
	fmt.Printf("Responder ephemeral pub: %s\n", hex.EncodeToString(ephemeralKP.Public))

	// Initialize handshake
	cfg := noise.Config{
		CipherSuite:      cs,
		Pattern:          noise.HandshakeXX,
		Initiator:        false,
		StaticKeypair:    staticKP,
		EphemeralKeypair: ephemeralKP,
		Prologue:         []byte{},
	}
	hs, err := noise.NewHandshakeState(cfg)
	if err != nil {
		log.Printf("handshake state error: %v", err)
		return
	}

	// Print initial state
	fmt.Printf("\n--- Initial State ---\n")
	fmt.Printf("h (ChannelBinding): %s\n", hex.EncodeToString(hs.ChannelBinding()))

	// Read msg1 (initiator's ephemeral key)
	msg1, err := readNoiseMessage(conn)
	if err != nil {
		log.Printf("read msg1 error: %v", err)
		return
	}
	fmt.Printf("\n--- Message 1 ---\n")
	fmt.Printf("msg1 len: %d\n", len(msg1))
	fmt.Printf("initiator_e: %s\n", hex.EncodeToString(msg1))

	// Process msg1
	_, _, _, err = hs.ReadMessage(nil, msg1)
	if err != nil {
		log.Printf("process msg1 error: %v", err)
		return
	}
	fmt.Printf("h after msg1: %s\n", hex.EncodeToString(hs.ChannelBinding()))

	// Build msg2
	// For debugging, let's manually trace what happens
	fmt.Printf("\n--- Building Message 2 ---\n")
	
	// The payload for libp2p-noise would be the handshake payload (identity key + signature)
	// For simplicity, let's use an empty payload first
	payload := []byte{}
	
	msg2, cs1, cs2, err := hs.WriteMessage(nil, payload)
	if err != nil {
		log.Printf("write msg2 error: %v", err)
		return
	}
	
	fmt.Printf("msg2 len: %d\n", len(msg2))
	fmt.Printf("msg2 e (first 32): %s\n", hex.EncodeToString(msg2[:32]))
	if len(msg2) > 32 {
		fmt.Printf("msg2 encrypted_s (next 48): %s\n", hex.EncodeToString(msg2[32:min(80, len(msg2))]))
	}
	if len(msg2) > 80 {
		fmt.Printf("msg2 rest: %s\n", hex.EncodeToString(msg2[80:]))
	}
	fmt.Printf("h after msg2: %s\n", hex.EncodeToString(hs.ChannelBinding()))

	// Let's also manually calculate what we'd expect
	fmt.Printf("\n--- Manual Verification ---\n")
	manualVerify(msg1, ephemeralKP, staticKP)

	// Send msg2
	err = writeNoiseMessage(conn, msg2)
	if err != nil {
		log.Printf("write msg2 error: %v", err)
		return
	}

	// Read msg3
	msg3, err := readNoiseMessage(conn)
	if err != nil {
		log.Printf("read msg3 error: %v", err)
		return
	}
	fmt.Printf("\n--- Message 3 ---\n")
	fmt.Printf("msg3 len: %d\n", len(msg3))

	decrypted, _, _, err := hs.ReadMessage(nil, msg3)
	if err != nil {
		log.Printf("process msg3 error: %v", err)
		return
	}
	fmt.Printf("Decrypted payload: %s\n", hex.EncodeToString(decrypted))

	if cs1 != nil && cs2 != nil {
		fmt.Println("Handshake complete!")
	}
}

func manualVerify(initiatorE []byte, ephemeralKP, staticKP noise.DHKey) {
	// Protocol name
	protocolName := "Noise_XX_25519_ChaChaPoly_SHA256"
	
	// Initial h
	var h [32]byte
	copy(h[:], protocolName)
	fmt.Printf("Initial h (protocol): %s\n", hex.EncodeToString(h[:]))
	
	// MixHash(empty prologue)
	hasher := sha256.New()
	hasher.Write(h[:])
	copy(h[:], hasher.Sum(nil))
	fmt.Printf("After MixHash(empty): %s\n", hex.EncodeToString(h[:]))
	
	// MixHash(initiator_e) - after reading msg1
	hasher = sha256.New()
	hasher.Write(h[:])
	hasher.Write(initiatorE)
	copy(h[:], hasher.Sum(nil))
	fmt.Printf("After MixHash(initiator_e): %s\n", hex.EncodeToString(h[:]))
	
	// MixHash(responder_e) - when writing msg2
	hasher = sha256.New()
	hasher.Write(h[:])
	hasher.Write(ephemeralKP.Public)
	copy(h[:], hasher.Sum(nil))
	fmt.Printf("After MixHash(responder_e): %s\n", hex.EncodeToString(h[:]))
	fmt.Printf("  responder_e: %s\n", hex.EncodeToString(ephemeralKP.Public))
	
	// DH(responder_e, initiator_e)
	// We can use the noise library's DH function
	cipherSuite := noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashSHA256)
	dhResult, _ := cipherSuite.DH(ephemeralKP.Private, initiatorE)
	fmt.Printf("DH(responder_e, initiator_e): %s\n", hex.EncodeToString(dhResult))
	
	// MixKey(dhResult) with initial ck
	ck := []byte(protocolName)
	fmt.Printf("Initial ck: %s\n", hex.EncodeToString(ck))
	
	newCk, newK := hkdf(ck, dhResult)
	fmt.Printf("After MixKey - new ck: %s\n", hex.EncodeToString(newCk))
	fmt.Printf("After MixKey - new k: %s\n", hex.EncodeToString(newK))
	
	// h after MixHash(responder_e) is the AAD for EncryptAndHash(static)
	fmt.Printf("\nFor encryption of static key:\n")
	fmt.Printf("  AAD (h): %s\n", hex.EncodeToString(h[:]))
	fmt.Printf("  key (k): %s\n", hex.EncodeToString(newK))
	fmt.Printf("  nonce: 0\n")
	
	// Encrypt static key
	var k32 [32]byte
	copy(k32[:], newK)
	cipher, _ := chacha20poly1305.New(k32[:])
	var nonce [12]byte
	binary.LittleEndian.PutUint64(nonce[4:], 0)
	encrypted := cipher.Seal(nil, nonce[:], staticKP.Public, h[:])
	fmt.Printf("  encrypted_s: %s\n", hex.EncodeToString(encrypted))
}

func hkdf(ck, inputKeyMaterial []byte) ([]byte, []byte) {
	// HMAC-based HKDF
	import_crypto_hmac := func(key, data []byte) []byte {
		h := sha256.New
		mac := hmacNew(h, key)
		mac.Write(data)
		return mac.Sum(nil)
	}
	
	tempKey := import_crypto_hmac(ck, inputKeyMaterial)
	output1 := import_crypto_hmac(tempKey, []byte{0x01})
	output2 := import_crypto_hmac(tempKey, append(output1, 0x02))
	
	return output1, output2
}

func readNoiseMessage(conn net.Conn) ([]byte, error) {
	lenBuf := make([]byte, 2)
	_, err := io.ReadFull(conn, lenBuf)
	if err != nil {
		return nil, err
	}
	length := int(lenBuf[0])<<8 | int(lenBuf[1])
	
	msg := make([]byte, length)
	_, err = io.ReadFull(conn, msg)
	return msg, err
}

func writeNoiseMessage(conn net.Conn, msg []byte) error {
	frame := make([]byte, 2+len(msg))
	frame[0] = byte(len(msg) >> 8)
	frame[1] = byte(len(msg))
	copy(frame[2:], msg)
	_, err := conn.Write(frame)
	return err
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var hmacNew = func() func(func() hash.Hash, []byte) hash.Hash {
	return func(h func() hash.Hash, key []byte) hash.Hash {
		return hmac.New(h, key)
	}
}()
