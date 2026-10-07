package application

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
)

var (
	ErrInviteNotFound    = errors.New("invite not found")
	ErrInviteInactive    = errors.New("invite is not active")
	ErrInviteExpired     = errors.New("invite has expired")
	ErrChallengeInvalid  = errors.New("enrollment challenge is invalid")
	ErrChallengeExpired  = errors.New("enrollment challenge has expired")
	ErrProofInvalid      = errors.New("station host-key proof is invalid")
	ErrStationMismatch   = errors.New("station identity does not match invite")
	ErrCapacityFull      = errors.New("relay capacity exceeded")
	ErrMountNotFound     = errors.New("mount not found")
	ErrCredentialInvalid = errors.New("relay credential is invalid")
	ErrInvalidRequest    = errors.New("relay enrollment request is invalid")
)

const defaultChallengeTTL = 90 * time.Second

type Service struct {
	repo      domain.Repository
	authority *CredentialAuthority
	now       func() time.Time

	challengeMu sync.Mutex
	challenges  map[string]domain.EnrollmentChallenge

	discoveryMu sync.Mutex
	routes      map[string]domain.RouteRecord
	grants      map[string]domain.GrantRecord
}

func NewService(
	repo domain.Repository,
	authority *CredentialAuthority,
) *Service {
	return &Service{
		repo:       repo,
		authority:  authority,
		now:        func() time.Time { return time.Now().UTC() },
		challenges: make(map[string]domain.EnrollmentChallenge),
		routes:     make(map[string]domain.RouteRecord),
		grants:     make(map[string]domain.GrantRecord),
	}
}

func (s *Service) RelayPeerID() string {
	return s.authority.RelayPeerID()
}

// ---- Invite operations ----

func (s *Service) CreateInvite(
	ctx context.Context,
	stationPeerID string,
	label string,
	maxClients int32,
	bandwidthLimit int64,
	expiresIn time.Duration,
) (*domain.Invite, string, error) {
	stationPeerID = strings.TrimSpace(stationPeerID)
	label = strings.TrimSpace(label)
	if stationPeerID != "" {
		if _, err := peer.Decode(stationPeerID); err != nil {
			return nil, "", ErrInvalidRequest
		}
	}
	if len(label) > 255 || maxClients < 0 || bandwidthLimit < 0 {
		return nil, "", ErrInvalidRequest
	}
	secret, err := randomIdentifier(32)
	if err != nil {
		return nil, "", fmt.Errorf("generate invite secret: %w", err)
	}
	if expiresIn <= 0 {
		expiresIn = 24 * time.Hour
	}
	invite := &domain.Invite{
		SecretDigest:          s.authority.DigestInvite(secret),
		IntendedStationPeerID: stationPeerID,
		Label:                 label,
		MaxClients:            maxClients,
		BandwidthLimit:        bandwidthLimit,
		Status:                domain.InviteStatusActive,
		ExpiresAt:             s.now().Add(expiresIn),
	}
	if err := s.repo.CreateInvite(ctx, invite); err != nil {
		return nil, "", fmt.Errorf("create invite: %w", err)
	}
	return invite, secret, nil
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

// ---- Enrollment challenges ----

func (s *Service) BeginEnrollmentChallenge(
	ctx context.Context,
	inviteSecret string,
	label string,
) (*domain.EnrollmentChallenge, error) {
	if inviteSecret == "" || inviteSecret != strings.TrimSpace(inviteSecret) {
		return nil, ErrInviteNotFound
	}
	label = strings.TrimSpace(label)
	if len(label) > 255 {
		return nil, ErrInvalidRequest
	}
	digest := s.authority.DigestInvite(inviteSecret)
	invite, err := s.repo.GetInviteBySecretDigest(ctx, digest)
	if err != nil {
		return nil, ErrInviteNotFound
	}
	if invite.Status != domain.InviteStatusActive {
		return nil, ErrInviteInactive
	}
	if !invite.ExpiresAt.After(s.now()) {
		return nil, ErrInviteExpired
	}
	return s.createChallenge(domain.EnrollmentChallenge{
		Operation:    domain.ChallengeOperationEnroll,
		InviteID:     invite.ID,
		InviteDigest: digest,
		RelayPeerID:  s.authority.RelayPeerID(),
		Label:        label,
	})
}

func (s *Service) BeginRotationChallenge(
	ctx context.Context,
	currentToken string,
) (*domain.EnrollmentChallenge, error) {
	identity, mount, err := s.authenticateMountCredential(
		ctx,
		currentToken,
		domain.ScopeMountRotate,
	)
	if err != nil {
		return nil, err
	}
	return s.createChallenge(domain.EnrollmentChallenge{
		Operation:     domain.ChallengeOperationRotate,
		RelayPeerID:   s.authority.RelayPeerID(),
		StationPeerID: identity.StationPeerID,
		MountID:       identity.MountID,
		Generation:    identity.Generation,
		CredentialJTI: identity.JTI,
		Label:         mount.Label,
	})
}

func (s *Service) createChallenge(
	challenge domain.EnrollmentChallenge,
) (*domain.EnrollmentChallenge, error) {
	challengeID, err := randomIdentifier(18)
	if err != nil {
		return nil, fmt.Errorf("generate challenge id: %w", err)
	}
	nonce, err := randomBytes(domain.EnrollmentChallengeByteSize)
	if err != nil {
		return nil, fmt.Errorf("generate challenge nonce: %w", err)
	}
	now := s.now()
	challenge.ID = challengeID
	challenge.Nonce = nonce
	challenge.IssuedAt = now
	challenge.ExpiresAt = now.Add(defaultChallengeTTL)
	challenge.Challenge = domain.BindEnrollmentChallenge(challenge)

	s.challengeMu.Lock()
	s.deleteExpiredChallengesLocked(now)
	s.challenges[challenge.ID] = cloneChallenge(challenge)
	s.challengeMu.Unlock()

	out := cloneChallenge(challenge)
	return &out, nil
}

func (s *Service) consumeChallenge(
	challengeID string,
	operation domain.ChallengeOperation,
) (domain.EnrollmentChallenge, error) {
	now := s.now()
	s.challengeMu.Lock()
	defer s.challengeMu.Unlock()
	s.deleteExpiredChallengesLocked(now)
	challenge, ok := s.challenges[strings.TrimSpace(challengeID)]
	if !ok || challenge.Operation != operation {
		return domain.EnrollmentChallenge{}, ErrChallengeInvalid
	}
	delete(s.challenges, challenge.ID)
	if !challenge.ExpiresAt.After(now) {
		return domain.EnrollmentChallenge{}, ErrChallengeExpired
	}
	return cloneChallenge(challenge), nil
}

func (s *Service) deleteExpiredChallengesLocked(now time.Time) {
	for challengeID, challenge := range s.challenges {
		if !challenge.ExpiresAt.After(now) {
			delete(s.challenges, challengeID)
		}
	}
}

// ---- Registration and credential rotation ----

type RegisterResult struct {
	Credential *domain.MountCredential
	Mount      *domain.Mount
}

func (s *Service) Register(
	ctx context.Context,
	inviteSecret string,
	proof domain.StationIdentityProof,
	maxStations int,
) (*RegisterResult, error) {
	if inviteSecret == "" || inviteSecret != strings.TrimSpace(inviteSecret) {
		return nil, ErrInviteNotFound
	}
	challenge, err := s.consumeChallenge(
		proof.ChallengeID,
		domain.ChallengeOperationEnroll,
	)
	if err != nil {
		return nil, err
	}
	inviteDigest := s.authority.DigestInvite(inviteSecret)
	if subtle.ConstantTimeCompare(
		[]byte(inviteDigest),
		[]byte(challenge.InviteDigest),
	) != 1 {
		return nil, ErrChallengeInvalid
	}
	invite, err := s.repo.GetInviteBySecretDigest(ctx, inviteDigest)
	if err != nil || invite.ID != challenge.InviteID {
		return nil, ErrInviteNotFound
	}
	if invite.Status != domain.InviteStatusActive {
		return nil, ErrInviteInactive
	}
	if !invite.ExpiresAt.After(s.now()) {
		return nil, ErrInviteExpired
	}

	stationPeerID, hostPublicKey, err := VerifyStationIdentityProof(
		proof,
		challenge.Challenge,
		s.now(),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProofInvalid, err)
	}
	if invite.IntendedStationPeerID != "" &&
		invite.IntendedStationPeerID != stationPeerID {
		return nil, ErrStationMismatch
	}

	jti, err := randomIdentifier(18)
	if err != nil {
		return nil, fmt.Errorf("generate credential id: %w", err)
	}
	mount, err := s.repo.ConsumeInviteAndActivateMount(
		ctx,
		invite.ID,
		&domain.Mount{
			StationPeerID:  stationPeerID,
			HostPublicKey:  hostPublicKey,
			Label:          firstNonEmpty(challenge.Label, invite.Label),
			CredentialJTI:  jti,
			MaxClients:     invite.MaxClients,
			BandwidthLimit: invite.BandwidthLimit,
			InviteID:       invite.ID,
		},
		maxStations,
	)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInviteAlreadyConsumed):
			return nil, ErrInviteInactive
		case errors.Is(err, domain.ErrRelayCapacityFull):
			return nil, ErrCapacityFull
		default:
			return nil, fmt.Errorf("activate Relay mount: %w", err)
		}
	}
	credential, err := s.authority.IssueMountCredential(mount, jti)
	if err != nil {
		return nil, err
	}
	return &RegisterResult{Credential: credential, Mount: mount}, nil
}

func (s *Service) RotateCredential(
	ctx context.Context,
	currentToken string,
	proof domain.StationIdentityProof,
) (*domain.MountCredential, error) {
	current, mount, err := s.authenticateMountCredential(
		ctx,
		currentToken,
		domain.ScopeMountRotate,
	)
	if err != nil {
		return nil, err
	}
	challenge, err := s.consumeChallenge(
		proof.ChallengeID,
		domain.ChallengeOperationRotate,
	)
	if err != nil {
		return nil, err
	}
	if challenge.StationPeerID != current.StationPeerID ||
		challenge.MountID != current.MountID ||
		challenge.Generation != current.Generation ||
		challenge.CredentialJTI != current.JTI {
		return nil, ErrChallengeInvalid
	}
	stationPeerID, hostPublicKey, err := VerifyStationIdentityProof(
		proof,
		challenge.Challenge,
		s.now(),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProofInvalid, err)
	}
	if stationPeerID != current.StationPeerID ||
		subtle.ConstantTimeCompare(hostPublicKey, mount.HostPublicKey) != 1 {
		return nil, ErrStationMismatch
	}

	nextJTI, err := randomIdentifier(18)
	if err != nil {
		return nil, fmt.Errorf("generate credential id: %w", err)
	}
	mount, err = s.repo.RotateMountCredential(ctx, current, nextJTI)
	if err != nil {
		return nil, ErrCredentialInvalid
	}
	return s.authority.IssueMountCredential(mount, nextJTI)
}

func (s *Service) AuthenticateMountCredential(
	ctx context.Context,
	token string,
	requiredScope string,
) (domain.MountIdentity, error) {
	identity, _, err := s.authenticateMountCredential(ctx, token, requiredScope)
	return identity, err
}

func (s *Service) authenticateMountCredential(
	ctx context.Context,
	token string,
	requiredScope string,
) (domain.MountIdentity, *domain.Mount, error) {
	identity, err := s.authority.ValidateCredential(
		token,
		domain.MountCredentialAudience,
		requiredScope,
	)
	if err != nil {
		return domain.MountIdentity{}, nil, ErrCredentialInvalid
	}
	mount, err := s.authenticateMountIdentity(ctx, identity)
	if err != nil {
		return domain.MountIdentity{}, nil, err
	}
	return identity, mount, nil
}

func (s *Service) authenticateMountIdentity(
	ctx context.Context,
	identity domain.MountIdentity,
) (*domain.Mount, error) {
	mount, err := s.repo.GetMountByStationPeerID(ctx, identity.StationPeerID)
	if err != nil || mount.Status == domain.MountStatusRevoked ||
		mount.ID != identity.MountID ||
		mount.Generation != identity.Generation ||
		mount.CredentialJTI != identity.JTI {
		return nil, ErrCredentialInvalid
	}
	return mount, nil
}

// ---- Mount operations ----

func (s *Service) ListOnlineMounts(ctx context.Context) ([]domain.Mount, error) {
	return s.repo.ListOnlineMounts(ctx)
}

func (s *Service) CountOnlineMounts(ctx context.Context) (int64, error) {
	return s.repo.CountOnlineMounts(ctx)
}

func (s *Service) RevokeMount(
	ctx context.Context,
	stationPeerID string,
) (*domain.Mount, error) {
	mount, err := s.repo.RevokeMount(ctx, stationPeerID)
	if errors.Is(err, domain.ErrMountNotFound) {
		return nil, ErrMountNotFound
	}
	return mount, err
}

func (s *Service) UpdateHeartbeat(
	ctx context.Context,
	identity domain.MountIdentity,
) error {
	if err := s.repo.UpdateHeartbeat(
		ctx,
		identity.StationPeerID,
		identity.Generation,
		identity.JTI,
	); err != nil {
		return ErrCredentialInvalid
	}
	return nil
}

func (s *Service) MarkStaleOffline(
	ctx context.Context,
	timeout time.Duration,
) (int64, error) {
	return s.repo.MarkStaleOffline(ctx, timeout)
}

func (s *Service) UpdateMountStatus(
	ctx context.Context,
	stationPeerID string,
	generation uint64,
	status domain.MountStatus,
) error {
	return s.repo.UpdateMountStatus(ctx, stationPeerID, generation, status)
}

func (s *Service) ActivateMount(
	ctx context.Context,
	identity domain.MountIdentity,
) error {
	return s.repo.ActivateMount(ctx, identity)
}

func (s *Service) GetMountByStationPeerID(
	ctx context.Context,
	stationPeerID string,
) (*domain.Mount, error) {
	return s.repo.GetMountByStationPeerID(ctx, stationPeerID)
}

// ---- ICE servers (TURN) ----

type TurnConfig struct {
	Enabled    bool
	PublicIP   string
	Port       int
	AuthSecret string
}

func (s *Service) BuildICEServers(cfg TurnConfig) []domain.ICEServerInfo {
	if !cfg.Enabled || cfg.PublicIP == "" || cfg.Port == 0 ||
		cfg.AuthSecret == "" {
		return nil
	}

	expiresAt := s.now().Add(24 * time.Hour)
	tempUsername := fmt.Sprintf("%d:relay-user", expiresAt.Unix())
	mac := hmac.New(sha1.New, []byte(cfg.AuthSecret))
	_, _ = mac.Write([]byte(tempUsername))
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

func cloneChallenge(input domain.EnrollmentChallenge) domain.EnrollmentChallenge {
	input.Nonce = append([]byte(nil), input.Nonce...)
	input.Challenge = append([]byte(nil), input.Challenge...)
	return input
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
