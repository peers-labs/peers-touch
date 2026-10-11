package securehttp

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"golang.org/x/net/http2"
)

const nodeCertificateLifetime = 24 * time.Hour

// NodeTLSIdentity binds inner TLS to the same delegated Ed25519 key that owns
// the Station node's libp2p PeerID.
type NodeTLSIdentity struct {
	certificate tls.Certificate
	peerID      peer.ID
	spkiSHA256  [sha256.Size]byte
}

func NewNodeTLSIdentity(
	nodePrivateKey libp2pcrypto.PrivKey,
	now time.Time,
) (*NodeTLSIdentity, error) {
	if nodePrivateKey == nil ||
		nodePrivateKey.Type() != libp2pcrypto.Ed25519 {
		return nil, fmt.Errorf("secure HTTP requires an Ed25519 node key")
	}
	rawPrivateKey, err := nodePrivateKey.Raw()
	if err != nil {
		return nil, fmt.Errorf("read Ed25519 node key: %w", err)
	}
	if len(rawPrivateKey) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf(
			"Ed25519 node key has %d bytes, want %d",
			len(rawPrivateKey),
			ed25519.PrivateKeySize,
		)
	}
	privateKey := ed25519.PrivateKey(append([]byte(nil), rawPrivateKey...))
	nodePeerID, err := peer.IDFromPrivateKey(nodePrivateKey)
	if err != nil {
		return nil, fmt.Errorf("derive node PeerID: %w", err)
	}
	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		return nil, fmt.Errorf("generate node TLS certificate serial: %w", err)
	}
	if serial.Sign() == 0 {
		serial.SetInt64(1)
	}
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: nodePeerID.String(),
		},
		NotBefore:             now.UTC().Add(-time.Minute),
		NotAfter:              now.UTC().Add(nodeCertificateLifetime),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	certificateDER, err := x509.CreateCertificate(
		rand.Reader,
		template,
		template,
		privateKey.Public(),
		privateKey,
	)
	if err != nil {
		return nil, fmt.Errorf("create node TLS certificate: %w", err)
	}
	leaf, err := x509.ParseCertificate(certificateDER)
	if err != nil {
		return nil, fmt.Errorf("parse node TLS certificate: %w", err)
	}
	return &NodeTLSIdentity{
		certificate: tls.Certificate{
			Certificate: [][]byte{certificateDER},
			PrivateKey:  privateKey,
			Leaf:        leaf,
		},
		peerID:     nodePeerID,
		spkiSHA256: sha256.Sum256(leaf.RawSubjectPublicKeyInfo),
	}, nil
}

func (i *NodeTLSIdentity) PeerID() peer.ID {
	if i == nil {
		return ""
	}
	return i.peerID
}

func (i *NodeTLSIdentity) SPKISHA256() [sha256.Size]byte {
	if i == nil {
		return [sha256.Size]byte{}
	}
	return i.spkiSHA256
}

func (i *NodeTLSIdentity) serverTLSConfig() (*tls.Config, error) {
	if i == nil || i.peerID == "" || len(i.certificate.Certificate) != 1 {
		return nil, fmt.Errorf("node TLS identity is incomplete")
	}
	return &tls.Config{
		Certificates: []tls.Certificate{i.certificate},
		MinVersion:   tls.VersionTLS13,
		MaxVersion:   tls.VersionTLS13,
		NextProtos:   []string{http2.NextProtoTLS},
	}, nil
}

func pinnedClientTLSConfig(
	expectedPeerID peer.ID,
	expectedSPKI [sha256.Size]byte,
) (*tls.Config, error) {
	if expectedPeerID == "" || expectedSPKI == ([sha256.Size]byte{}) {
		return nil, fmt.Errorf("secure HTTP target identity is incomplete")
	}
	return &tls.Config{
		MinVersion:         tls.VersionTLS13,
		MaxVersion:         tls.VersionTLS13,
		NextProtos:         []string{http2.NextProtoTLS},
		InsecureSkipVerify: true, // Verification is route-pinned below.
		VerifyConnection: func(state tls.ConnectionState) error {
			if state.Version != tls.VersionTLS13 ||
				state.NegotiatedProtocol != http2.NextProtoTLS ||
				len(state.PeerCertificates) != 1 {
				return fmt.Errorf("node TLS negotiation is invalid")
			}
			certificate := state.PeerCertificates[0]
			actualSPKI := sha256.Sum256(certificate.RawSubjectPublicKeyInfo)
			if !bytes.Equal(actualSPKI[:], expectedSPKI[:]) {
				return fmt.Errorf("node TLS SPKI does not match the signed route")
			}
			publicKey, ok := certificate.PublicKey.(ed25519.PublicKey)
			if !ok {
				return fmt.Errorf("node TLS certificate does not use Ed25519")
			}
			libp2pPublicKey, err := libp2pcrypto.UnmarshalEd25519PublicKey(
				publicKey,
			)
			if err != nil {
				return fmt.Errorf("decode node TLS public key: %w", err)
			}
			certificatePeerID, err := peer.IDFromPublicKey(libp2pPublicKey)
			if err != nil || certificatePeerID != expectedPeerID {
				return fmt.Errorf("node TLS certificate does not match target PeerID")
			}
			return nil
		},
	}, nil
}
