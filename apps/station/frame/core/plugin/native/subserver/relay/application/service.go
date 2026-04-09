package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
)

var (
	ErrInviteNotFound = errors.New("invite not found")
	ErrInviteInactive = errors.New("invite is not active")
	ErrInviteExpired  = errors.New("invite has expired")
	ErrNoPeerID       = errors.New("station_peer_id cannot be determined")
	ErrCapacityFull   = errors.New("relay capacity exceeded")
	ErrMountNotFound  = errors.New("mount not found")
)

// Service orchestrates relay business operations.
// It depends only on domain.Repository (interface), not on infrastructure.
type Service struct {
	repo domain.Repository
}

func NewService(repo domain.Repository) *Service {
	return &Service{repo: repo}
}

// ---- Invite operations ----

func (s *Service) CreateInvite(ctx context.Context, stationPeerID, label string, maxClients int32, expiresIn time.Duration) (*domain.Invite, string, error) {
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	claims := coreauth.Credentials{
		SubjectID: domain.SubjectRelayInvite + stationPeerID,
		Attributes: map[string]string{
			"type":            "relay_invite",
			"station_peer_id": stationPeerID,
			"label":           label,
		},
	}
	_, token, err := provider.Authenticate(ctx, claims)
	if err != nil {
		return nil, "", fmt.Errorf("generate invite token: %w", err)
	}

	invite := &domain.Invite{
		Token:         token.Value,
		StationPeerID: stationPeerID,
		Label:         label,
		MaxClients:    maxClients,
		Status:        domain.InviteStatusActive,
		ExpiresAt:     time.Now().Add(expiresIn),
	}
	if err := s.repo.CreateInvite(ctx, invite); err != nil {
		return nil, "", fmt.Errorf("create invite: %w", err)
	}
	return invite, token.Value, nil
}

func (s *Service) ListInvites(ctx context.Context) ([]domain.Invite, error) {
	return s.repo.ListInvites(ctx)
}

func (s *Service) RevokeInvite(ctx context.Context, inviteID uint64) error {
	return s.repo.RevokeInvite(ctx, inviteID)
}

func (s *Service) ExpireStaleInvites(ctx context.Context) (int64, error) {
	return s.repo.ExpireStaleInvites(ctx)
}

// ---- Registration ----

type RegisterResult struct {
	StationPeerID string
	RelayToken    string
	ExpiresAt     time.Time
}

func (s *Service) Register(ctx context.Context, inviteToken, label, headerPeerID string, maxStations int) (*RegisterResult, error) {
	invite, err := s.repo.GetInviteByToken(ctx, inviteToken)
	if err != nil {
		return nil, ErrInviteNotFound
	}
	if invite.Status != domain.InviteStatusActive {
		return nil, ErrInviteInactive
	}
	if time.Now().After(invite.ExpiresAt) {
		return nil, ErrInviteExpired
	}

	stationPeerID := invite.StationPeerID
	if stationPeerID == "" {
		stationPeerID = headerPeerID
	}
	if stationPeerID == "" {
		return nil, ErrNoPeerID
	}

	if maxStations > 0 {
		count, cErr := s.repo.CountOnlineMounts(ctx)
		if cErr != nil {
			return nil, fmt.Errorf("count online mounts: %w", cErr)
		}
		if int(count) >= maxStations {
			return nil, ErrCapacityFull
		}
	}

	if err := s.repo.ConsumeInvite(ctx, invite.ID, stationPeerID); err != nil {
		return nil, fmt.Errorf("consume invite: %w", err)
	}

	relayToken, expiresAt, err := s.issueToken(ctx, domain.SubjectRelayAccess+stationPeerID, "relay_access", stationPeerID, 0)
	if err != nil {
		return nil, fmt.Errorf("generate relay token: %w", err)
	}

	now := time.Now()
	mount := &domain.Mount{
		StationPeerID: stationPeerID,
		Label:         label,
		Status:        domain.MountStatusOnline,
		MaxClients:    invite.MaxClients,
		InviteID:      invite.ID,
		LastHeartbeat: now,
		MountedAt:     now,
	}

	if _, getErr := s.repo.GetMountByStationPeerID(ctx, stationPeerID); getErr != nil {
		if createErr := s.repo.CreateMount(ctx, mount); createErr != nil {
			return nil, fmt.Errorf("create mount: %w", createErr)
		}
	} else {
		if err := s.repo.UpdateMountStatus(ctx, stationPeerID, domain.MountStatusOnline); err != nil {
			return nil, fmt.Errorf("update mount status: %w", err)
		}
		if err := s.repo.UpdateHeartbeat(ctx, stationPeerID); err != nil {
			return nil, fmt.Errorf("update heartbeat: %w", err)
		}
	}

	return &RegisterResult{
		StationPeerID: stationPeerID,
		RelayToken:    relayToken,
		ExpiresAt:     expiresAt,
	}, nil
}

// ---- Mount operations ----

func (s *Service) ListOnlineMounts(ctx context.Context) ([]domain.Mount, error) {
	return s.repo.ListOnlineMounts(ctx)
}

func (s *Service) CountOnlineMounts(ctx context.Context) (int64, error) {
	return s.repo.CountOnlineMounts(ctx)
}

func (s *Service) DeleteMount(ctx context.Context, stationPeerID string) error {
	return s.repo.DeleteMount(ctx, stationPeerID)
}

func (s *Service) UpdateHeartbeat(ctx context.Context, stationPeerID string) error {
	return s.repo.UpdateHeartbeat(ctx, stationPeerID)
}

func (s *Service) MarkStaleOffline(ctx context.Context, timeout time.Duration) (int64, error) {
	return s.repo.MarkStaleOffline(ctx, timeout)
}

func (s *Service) UpdateMountStatus(ctx context.Context, stationPeerID string, status domain.MountStatus) error {
	return s.repo.UpdateMountStatus(ctx, stationPeerID, status)
}

func (s *Service) GetMountByStationPeerID(ctx context.Context, stationPeerID string) (*domain.Mount, error) {
	return s.repo.GetMountByStationPeerID(ctx, stationPeerID)
}

func (s *Service) CreateMount(ctx context.Context, mount *domain.Mount) error {
	return s.repo.CreateMount(ctx, mount)
}

// ---- Client token ----

// MintClientToken creates a JWT scoped to a specific station, intended for
// distribution to clients (desktop/mobile) so they can forward requests through
// the relay to that station.
func (s *Service) MintClientToken(ctx context.Context, stationPeerID string, ttl time.Duration) (string, time.Time, error) {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}

	mount, err := s.repo.GetMountByStationPeerID(ctx, stationPeerID)
	if err != nil {
		return "", time.Time{}, ErrMountNotFound
	}
	if mount.Status != domain.MountStatusOnline {
		return "", time.Time{}, ErrMountNotFound
	}

	return s.issueToken(ctx, domain.SubjectRelayClient+stationPeerID, "relay_client", stationPeerID, ttl)
}

// ---- Token refresh ----

func (s *Service) RefreshToken(ctx context.Context, peerID string) (string, time.Time, error) {
	return s.issueToken(ctx, domain.SubjectRelayAccess+peerID, "relay_access", peerID, 0)
}

// ---- internal: token issuing ----

// issueToken signs a JWT with the given subject and attributes.
// ttl=0 means use the global AccessTTL from auth config.
func (s *Service) issueToken(ctx context.Context, subject, tokenType, stationPeerID string, ttl time.Duration) (string, time.Time, error) {
	if ttl <= 0 {
		ttl = coreauth.Get().AccessTTL
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, ttl)
	claims := coreauth.Credentials{
		SubjectID: subject,
		Attributes: map[string]string{
			"type":            tokenType,
			"station_peer_id": stationPeerID,
		},
	}
	_, token, err := provider.Authenticate(ctx, claims)
	if err != nil {
		return "", time.Time{}, err
	}
	return token.Value, token.ExpiresAt, nil
}

// ---- ICE servers (TURN) ----

type TurnConfig struct {
	Enabled    bool
	PublicIP   string
	Port       int
	AuthSecret string
}

func (s *Service) BuildICEServers(cfg TurnConfig) []domain.ICEServerInfo {
	if !cfg.Enabled || cfg.PublicIP == "" {
		return nil
	}
	if cfg.Port == 0 || cfg.AuthSecret == "" {
		return nil
	}

	ttl := 24 * time.Hour
	expiresAt := time.Now().Add(ttl)
	tempUsername := fmt.Sprintf("%d:relay-user", expiresAt.Unix())

	mac := hmac.New(sha1.New, []byte(cfg.AuthSecret))
	mac.Write([]byte(tempUsername))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	turnAddr := cfg.PublicIP + ":" + strconv.Itoa(cfg.Port)

	return []domain.ICEServerInfo{
		{
			URLs:       []string{"turn:" + turnAddr},
			Username:   tempUsername,
			Credential: credential,
			Source:     "relay",
			Priority:   2,
		},
		{
			URLs:       []string{"turn:" + turnAddr + "?transport=tcp"},
			Username:   tempUsername,
			Credential: credential,
			Source:     "relay",
			Priority:   2,
		},
	}
}
