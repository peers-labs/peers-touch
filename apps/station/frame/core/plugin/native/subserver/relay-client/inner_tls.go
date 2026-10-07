package relayclient

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"io"
	"math/big"
	"net"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/client"
)

const (
	innerTLSHandshakeTimeout = 10 * time.Second
	innerTLSCertificateLife  = 25 * time.Hour
	tunnelCopyBufferSize     = 32 * 1024
)

type innerTLSIngress struct {
	certificate tls.Certificate
	spkiSHA256  []byte
	localAddr   string
	dialTimeout time.Duration
}

func newInnerTLSIngress(
	localHTTPPort int,
	dialTimeout time.Duration,
) (*innerTLSIngress, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate inner TLS key: %w", err)
	}
	now := time.Now().UTC()
	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		return nil, fmt.Errorf("generate inner TLS serial: %w", err)
	}
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: "peers-touch-station",
		},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(innerTLSCertificateLife),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(
		rand.Reader,
		template,
		template,
		&privateKey.PublicKey,
		privateKey,
	)
	if err != nil {
		return nil, fmt.Errorf("create inner TLS certificate: %w", err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, fmt.Errorf("parse inner TLS certificate: %w", err)
	}
	certificate := tls.Certificate{
		Certificate: [][]byte{der},
		PrivateKey:  privateKey,
		Leaf:        leaf,
	}
	spki, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("marshal inner TLS SPKI: %w", err)
	}
	digest := sha256.Sum256(spki)
	if dialTimeout <= 0 {
		dialTimeout = 30 * time.Second
	}
	return &innerTLSIngress{
		certificate: certificate,
		spkiSHA256:  append([]byte(nil), digest[:]...),
		localAddr:   fmt.Sprintf("127.0.0.1:%d", localHTTPPort),
		dialTimeout: dialTimeout,
	}, nil
}

func (i *innerTLSIngress) SPKISHA256() []byte {
	if i == nil {
		return nil
	}
	return append([]byte(nil), i.spkiSHA256...)
}

func (i *innerTLSIngress) Serve(
	ctx context.Context,
	tunnel *client.InboundTunnel,
) {
	if i == nil || tunnel == nil {
		return
	}
	if err := tunnel.Accept(); err != nil {
		return
	}

	tlsConn := tls.Server(tunnel, &tls.Config{
		Certificates: []tls.Certificate{i.certificate},
		MinVersion:   tls.VersionTLS13,
		MaxVersion:   tls.VersionTLS13,
		NextProtos:   []string{"http/1.1"},
	})
	_ = tlsConn.SetDeadline(time.Now().Add(innerTLSHandshakeTimeout))
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		logger.Warnf(ctx, "[relay-client] inner TLS handshake failed: %v", err)
		_ = tlsConn.Close()
		return
	}
	_ = tlsConn.SetDeadline(time.Time{})

	localConn, err := (&net.Dialer{Timeout: i.dialTimeout}).
		DialContext(ctx, "tcp", i.localAddr)
	if err != nil {
		logger.Warnf(ctx, "[relay-client] canonical router dial failed: %v", err)
		_ = tlsConn.Close()
		return
	}
	defer localConn.Close()
	defer tlsConn.Close()

	copyDone := make(chan error, 2)
	copyOneWay := func(dst io.Writer, src io.Reader) {
		buffer := make([]byte, tunnelCopyBufferSize)
		_, copyErr := io.CopyBuffer(dst, src, buffer)
		copyDone <- copyErr
	}
	go copyOneWay(localConn, tlsConn)
	go copyOneWay(tlsConn, localConn)

	select {
	case <-ctx.Done():
	case <-copyDone:
	}
}
