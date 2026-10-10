package relayclient

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

func (s *SubServer) configureRelayTLS() error {
	path := strings.TrimSpace(s.opts.TLSCAFile)
	if path == "" {
		s.relayTLSRootCAs = nil
		return nil
	}
	pem, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read Relay TLS CA file: %w", err)
	}
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}
	if !roots.AppendCertsFromPEM(pem) {
		return fmt.Errorf("Relay TLS CA file contains no certificates")
	}
	s.relayTLSRootCAs = roots
	return nil
}

func (s *SubServer) relayTLSConfig() *tls.Config {
	return &tls.Config{
		MinVersion:         tls.VersionTLS13,
		RootCAs:            s.relayTLSRootCAs,
		InsecureSkipVerify: s.opts.TLSInsecureSkipVerify,
	}
}

func (s *SubServer) relayHTTPClient(timeout time.Duration) *http.Client {
	s.relayHTTPTransportOnce.Do(func() {
		s.relayHTTPTransport = http.DefaultTransport.(*http.Transport).Clone()
		s.relayHTTPTransport.TLSClientConfig = s.relayTLSConfig()
	})
	return &http.Client{
		Transport: s.relayHTTPTransport,
		Timeout:   timeout,
	}
}
