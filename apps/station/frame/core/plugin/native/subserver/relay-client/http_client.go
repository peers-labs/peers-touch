package relayclient

import (
	"crypto/tls"
	"net/http"
	"time"
)

func (s *SubServer) relayHTTPClient(timeout time.Duration) *http.Client {
	s.relayHTTPTransportOnce.Do(func() {
		s.relayHTTPTransport = http.DefaultTransport.(*http.Transport).Clone()
		s.relayHTTPTransport.TLSClientConfig = &tls.Config{
			MinVersion:         tls.VersionTLS13,
			InsecureSkipVerify: s.opts.TLSInsecureSkipVerify,
		}
	})
	return &http.Client{
		Transport: s.relayHTTPTransport,
		Timeout:   timeout,
	}
}
