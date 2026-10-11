package relay

import (
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/config"
)

const (
	PoolModeOff    = "off"
	PoolModeCustom = "custom"
)

type Resources struct {
	ReservationTTL        time.Duration
	MaxReservations       int
	MaxCircuitsPerPeer    int
	MaxBytesPerDirection  int64
	MaxCircuitDuration    time.Duration
	MaxReservationsPerIP  int
	MaxReservationsPerASN int
	BufferSize            int
}

type Target struct {
	RelayPeerID    peer.ID
	Addresses      []string
	ControlOrigin  string
	InviteToken    string
	CredentialFile string
	TLSCAFile      string
	Label          string
}

type Pool struct {
	Mode        string
	RenewBefore time.Duration
	RetryMin    time.Duration
	RetryMax    time.Duration
	Targets     []Target
}

type RuntimeConfig struct {
	Resources Resources
	Pool      Pool
}

var registeredConfig struct {
	Peers struct {
		Node struct {
			RelayService struct {
				ReservationTTLSeconds     int   `pconf:"reservation-ttl-seconds"`
				MaxReservations           int   `pconf:"max-reservations"`
				MaxCircuitsPerPeer        int   `pconf:"max-circuits-per-peer"`
				MaxBytesPerDirection      int64 `pconf:"max-bytes-per-direction"`
				MaxCircuitDurationSeconds int   `pconf:"max-circuit-duration-seconds"`
				MaxReservationsPerIP      int   `pconf:"max-reservations-per-ip"`
				MaxReservationsPerASN     int   `pconf:"max-reservations-per-asn"`
				BufferSize                int   `pconf:"buffer-size"`
			} `pconf:"relay-service"`
			RelayPool struct {
				Mode               string `pconf:"mode"`
				RenewBeforeSeconds int    `pconf:"renew-before-seconds"`
				RetryMinSeconds    int    `pconf:"retry-min-seconds"`
				RetryMaxSeconds    int    `pconf:"retry-max-seconds"`
				Relays             []struct {
					PeerID         string   `pconf:"peer-id" json:"peer-id"`
					Addresses      []string `pconf:"addresses" json:"addresses"`
					ControlOrigin  string   `pconf:"control-origin" json:"control-origin"`
					InviteToken    string   `pconf:"invite-token" json:"invite-token"`
					CredentialFile string   `pconf:"credential-file" json:"credential-file"`
					TLSCAFile      string   `pconf:"tls-ca-file" json:"tls-ca-file"`
					Label          string   `pconf:"label" json:"label"`
				} `pconf:"relays"`
			} `pconf:"relay-pool"`
		} `pconf:"node"`
	} `pconf:"peers"`
}

func init() {
	config.RegisterOptions(&registeredConfig)
}

func ConfigFromRegistered() (RuntimeConfig, error) {
	service := registeredConfig.Peers.Node.RelayService
	poolConfig := registeredConfig.Peers.Node.RelayPool
	mode := strings.ToLower(strings.TrimSpace(poolConfig.Mode))
	if mode == "" {
		mode = PoolModeOff
	}
	if mode != PoolModeOff && mode != PoolModeCustom {
		return RuntimeConfig{}, fmt.Errorf("unsupported Relay pool mode %q", mode)
	}
	targets := make([]Target, 0, len(poolConfig.Relays))
	seen := make(map[peer.ID]struct{}, len(poolConfig.Relays))
	for index, raw := range poolConfig.Relays {
		relayPeerID, err := peer.Decode(strings.TrimSpace(raw.PeerID))
		if err != nil {
			return RuntimeConfig{}, fmt.Errorf(
				"Relay pool target %d has invalid PeerID %q: %w",
				index,
				raw.PeerID,
				err,
			)
		}
		if len(raw.Addresses) == 0 {
			return RuntimeConfig{}, fmt.Errorf(
				"Relay pool target %d has no dial addresses",
				index,
			)
		}
		if strings.TrimSpace(raw.ControlOrigin) == "" {
			return RuntimeConfig{}, fmt.Errorf(
				"Relay pool target %d has no control origin",
				index,
			)
		}
		controlOrigin := strings.TrimRight(
			strings.TrimSpace(raw.ControlOrigin),
			"/",
		)
		parsedOrigin, err := url.Parse(controlOrigin)
		if err != nil || parsedOrigin.Hostname() == "" ||
			(parsedOrigin.Scheme != "https" &&
				(parsedOrigin.Scheme != "http" ||
					!isLoopbackRelayHost(parsedOrigin.Hostname()))) {
			return RuntimeConfig{}, fmt.Errorf(
				"Relay pool target %d has invalid control origin",
				index,
			)
		}
		if strings.TrimSpace(raw.CredentialFile) == "" {
			return RuntimeConfig{}, fmt.Errorf(
				"Relay pool target %d has no credential file",
				index,
			)
		}
		if _, exists := seen[relayPeerID]; exists {
			return RuntimeConfig{}, fmt.Errorf(
				"Relay pool target %s is duplicated",
				relayPeerID,
			)
		}
		seen[relayPeerID] = struct{}{}
		targets = append(targets, Target{
			RelayPeerID:    relayPeerID,
			Addresses:      append([]string(nil), raw.Addresses...),
			ControlOrigin:  controlOrigin,
			InviteToken:    strings.TrimSpace(raw.InviteToken),
			CredentialFile: strings.TrimSpace(raw.CredentialFile),
			TLSCAFile:      strings.TrimSpace(raw.TLSCAFile),
			Label:          strings.TrimSpace(raw.Label),
		})
	}
	if mode == PoolModeCustom && len(targets) == 0 {
		return RuntimeConfig{}, fmt.Errorf(
			"custom Relay pool requires at least one target",
		)
	}
	return RuntimeConfig{
		Resources: Resources{
			ReservationTTL: durationOrDefault(
				service.ReservationTTLSeconds,
				time.Hour,
			),
			MaxReservations: intOrDefault(
				service.MaxReservations,
				256,
			),
			MaxCircuitsPerPeer: intOrDefault(
				service.MaxCircuitsPerPeer,
				64,
			),
			MaxBytesPerDirection: int64OrDefault(
				service.MaxBytesPerDirection,
				256<<20,
			),
			MaxCircuitDuration: durationOrDefault(
				service.MaxCircuitDurationSeconds,
				time.Hour,
			),
			MaxReservationsPerIP: intOrDefault(
				service.MaxReservationsPerIP,
				8,
			),
			MaxReservationsPerASN: intOrDefault(
				service.MaxReservationsPerASN,
				32,
			),
			BufferSize: intOrDefault(service.BufferSize, 32<<10),
		},
		Pool: Pool{
			Mode: mode,
			RenewBefore: durationOrDefault(
				poolConfig.RenewBeforeSeconds,
				20*time.Minute,
			),
			RetryMin: durationOrDefault(
				poolConfig.RetryMinSeconds,
				time.Second,
			),
			RetryMax: durationOrDefault(
				poolConfig.RetryMaxSeconds,
				time.Minute,
			),
			Targets: targets,
		},
	}, nil
}

func isLoopbackRelayHost(value string) bool {
	if strings.EqualFold(value, "localhost") {
		return true
	}
	ip := net.ParseIP(value)
	return ip != nil && ip.IsLoopback()
}

func durationOrDefault(seconds int, fallback time.Duration) time.Duration {
	if seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

func intOrDefault(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func int64OrDefault(value, fallback int64) int64 {
	if value <= 0 {
		return fallback
	}
	return value
}
