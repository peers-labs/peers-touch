package infrastructure

import nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"

// LiveFederationRelayAccess reads the relay-client handle at request time.
// Messaging initializes before relay-client connects, so retaining an Init-time
// handle would permanently miss later registration and token rotation.
type LiveFederationRelayAccess struct{}

func NewLiveFederationRelayAccess() *LiveFederationRelayAccess {
	return &LiveFederationRelayAccess{}
}

func (*LiveFederationRelayAccess) BaseURL() string {
	client := nativefed.RelayClient()
	if client == nil {
		return ""
	}
	return client.BaseURL()
}

func (*LiveFederationRelayAccess) Token() string {
	client := nativefed.RelayClient()
	if client == nil {
		return ""
	}
	return client.Token()
}

var _ FederationRelayAccess = (*LiveFederationRelayAccess)(nil)
