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
	nativeRelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
)

var (
	ErrInviteNotFound     = errors.New("invite not found")
	ErrInviteInactive     = errors.New("invite is not active")
	ErrInviteExpired      = errors.New("invite has expired")
	ErrChallengeInvalid   = errors.New("enrollment challenge is invalid")
	ErrChallengeExpired   = errors.New("enrollment challenge has expired")
	ErrProofInvalid       = errors.New("station host-key proof is invalid")
	ErrStationMismatch    = errors.New("station identity does not match invite")
	ErrCapacityFull       = errors.New("relay capacity exceeded")
	ErrEnrollmentNotFound = errors.New("enrollment not found")
	ErrCredentialInvalid  = errors.New("relay credential is invalid")
	ErrInvalidRequest     = errors.New("relay enrollment request is invalid")
)

const defaultChallengeTTL = 90 * time.Second

type Service struct {
	repo      domain.Repository
	authority *CredentialAuthority
	admission *nativeRelay.Admission
	now       func() time.Time

	challengeMu sync.Mutex
	challenges  map[string]domain.EnrollmentChallenge

	discoveryMu sync.Mutex
	routes      map[string]domain.RouteRecord
	grants      map[string]domain.GrantRecord
	redemptions map[string]domain.GrantRedemptionRecord
}

func NewService(
	repo domain.Repository,
	authority *CredentialAuthority,
	admission *nativeRelay.Admission,
) *Service {
	return &Service{
		repo:        repo,
		authority:   authority,
		admission:   admission,
		now:         func() time.Time { return time.Now().UTC() },
		challenges:  make(map[string]domain.EnrollmentChallenge),
		routes:      make(map[string]domain.RouteRecord),
		grants:      make(map[string]domain.GrantRecord),
		redemptions: make(map[string]domain.GrantRedemptionRecord),
	}
}

func (s *Service) HydrateAdmission(ctx context.Context) error {
	if s == nil || s.admission == nil {
		return fmt.Errorf("standard Circuit admission is unavailable")
	}
	enrollments, err := s.repo.ListAdmittedEnrollments(ctx)
	if err != nil {
		return err
	}
	for _, enrollment := range enrollments {
		nodePeerID, decodeErr := peer.Decode(enrollment.NodePeerID)
		if decodeErr != nil {
			return fmt.Errorf(
				"decode admitted Node PeerID for %s: %w",
				enrollment.StationPeerID,
				decodeErr,
			)
		}
		if err := s.admission.AdmitNode(nativeRelay.NodeAdmission{
			StationPeerID: enrollment.StationPeerID,
			NodePeerID:    nodePeerID,
			Generation:    enrollment.Generation,
			ExpiresAt:     enrollment.NodeAuthorizationUntil,
		}); err != nil {
			return err
		}
	}
	return nil
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
	identity, enrollment, err := s.authenticateNodeCredential(
		ctx,
		currentToken,
		domain.ScopeNodeRotate,
	)
	if err != nil {
		return nil, err
	}
	return s.createChallenge(domain.EnrollmentChallenge{
		Operation:     domain.ChallengeOperationRotate,
		RelayPeerID:   s.authority.RelayPeerID(),
		StationPeerID: identity.StationPeerID,
		EnrollmentID:  identity.EnrollmentID,
		Generation:    identity.Generation,
		CredentialJTI: identity.JTI,
		Label:         enrollment.Label,
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
	Credential *domain.NodeCredential
	Enrollment *domain.Enrollment
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

	verifiedNode, err := VerifyStationIdentityProof(
		proof,
		challenge.Challenge,
		s.now(),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProofInvalid, err)
	}
	if invite.IntendedStationPeerID != "" &&
		invite.IntendedStationPeerID != verifiedNode.StationPeerID {
		return nil, ErrStationMismatch
	}

	jti, err := randomIdentifier(18)
	if err != nil {
		return nil, fmt.Errorf("generate credential id: %w", err)
	}
	enrollment, err := s.repo.ConsumeInviteAndCreateEnrollment(
		ctx,
		invite.ID,
		&domain.Enrollment{
			StationPeerID:          verifiedNode.StationPeerID,
			NodePeerID:             verifiedNode.NodePeerID,
			StationRootPublicKey:   verifiedNode.StationRootPublicKey,
			NodeAuthorizationEpoch: verifiedNode.AuthorizationEpoch,
			NodeAuthorizationUntil: verifiedNode.AuthorizationExpiresAt,
			Label:                  firstNonEmpty(challenge.Label, invite.Label),
			CredentialJTI:          jti,
			MaxClients:             invite.MaxClients,
			BandwidthLimit:         invite.BandwidthLimit,
			InviteID:               invite.ID,
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
			return nil, fmt.Errorf("activate Relay enrollment: %w", err)
		}
	}
	nodePeerID, err := peer.Decode(enrollment.NodePeerID)
	if err != nil {
		_, _ = s.repo.RevokeEnrollment(
			ctx,
			enrollment.StationPeerID,
			enrollment.NodePeerID,
		)
		return nil, fmt.Errorf("decode enrolled Node PeerID: %w", err)
	}
	if err := s.admission.AdmitNode(nativeRelay.NodeAdmission{
		StationPeerID: enrollment.StationPeerID,
		NodePeerID:    nodePeerID,
		Generation:    enrollment.Generation,
		ExpiresAt:     enrollment.NodeAuthorizationUntil,
	}); err != nil {
		_, _ = s.repo.RevokeEnrollment(
			ctx,
			enrollment.StationPeerID,
			enrollment.NodePeerID,
		)
		return nil, fmt.Errorf("admit enrolled Relay node: %w", err)
	}
	credential, err := s.authority.IssueNodeCredential(enrollment, jti)
	if err != nil {
		return nil, err
	}
	return &RegisterResult{Credential: credential, Enrollment: enrollment}, nil
}

func (s *Service) RotateCredential(
	ctx context.Context,
	currentToken string,
	proof domain.StationIdentityProof,
) (*domain.NodeCredential, error) {
	current, enrollment, err := s.authenticateNodeCredential(
		ctx,
		currentToken,
		domain.ScopeNodeRotate,
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
		challenge.EnrollmentID != current.EnrollmentID ||
		challenge.Generation != current.Generation ||
		challenge.CredentialJTI != current.JTI {
		return nil, ErrChallengeInvalid
	}
	verifiedNode, err := VerifyStationIdentityProof(
		proof,
		challenge.Challenge,
		s.now(),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProofInvalid, err)
	}
	if verifiedNode.StationPeerID != current.StationPeerID ||
		verifiedNode.NodePeerID != current.NodePeerID ||
		verifiedNode.NodePeerID != enrollment.NodePeerID ||
		subtle.ConstantTimeCompare(
			verifiedNode.StationRootPublicKey,
			enrollment.StationRootPublicKey,
		) != 1 {
		return nil, ErrStationMismatch
	}

	nextJTI, err := randomIdentifier(18)
	if err != nil {
		return nil, fmt.Errorf("generate credential id: %w", err)
	}
	if err := s.repo.UpdateNodeAuthorization(
		ctx,
		current,
		verifiedNode.AuthorizationEpoch,
		verifiedNode.AuthorizationExpiresAt,
	); err != nil {
		return nil, ErrCredentialInvalid
	}
	enrollment, err = s.repo.RotateNodeCredential(ctx, current, nextJTI)
	if err != nil {
		return nil, ErrCredentialInvalid
	}
	enrollment.NodeAuthorizationEpoch = verifiedNode.AuthorizationEpoch
	enrollment.NodeAuthorizationUntil = verifiedNode.AuthorizationExpiresAt
	nodePeerID, err := peer.Decode(enrollment.NodePeerID)
	if err != nil {
		return nil, ErrCredentialInvalid
	}
	if err := s.admission.AdmitNode(nativeRelay.NodeAdmission{
		StationPeerID: enrollment.StationPeerID,
		NodePeerID:    nodePeerID,
		Generation:    enrollment.Generation,
		ExpiresAt:     enrollment.NodeAuthorizationUntil,
	}); err != nil {
		return nil, ErrCredentialInvalid
	}
	return s.authority.IssueNodeCredential(enrollment, nextJTI)
}

func (s *Service) AuthenticateNodeCredential(
	ctx context.Context,
	token string,
	requiredScope string,
) (domain.NodeIdentity, error) {
	identity, _, err := s.authenticateNodeCredential(ctx, token, requiredScope)
	return identity, err
}

func (s *Service) authenticateNodeCredential(
	ctx context.Context,
	token string,
	requiredScope string,
) (domain.NodeIdentity, *domain.Enrollment, error) {
	identity, err := s.authority.ValidateCredential(
		token,
		domain.NodeCredentialAudience,
		requiredScope,
	)
	if err != nil {
		return domain.NodeIdentity{}, nil, ErrCredentialInvalid
	}
	enrollment, err := s.authenticateNodeIdentity(ctx, identity)
	if err != nil {
		return domain.NodeIdentity{}, nil, err
	}
	return identity, enrollment, nil
}

func (s *Service) authenticateNodeIdentity(
	ctx context.Context,
	identity domain.NodeIdentity,
) (*domain.Enrollment, error) {
	enrollment, err := s.repo.GetEnrollment(
		ctx,
		identity.StationPeerID,
		identity.NodePeerID,
	)
	if err != nil || enrollment.Status == domain.EnrollmentStatusRevoked ||
		enrollment.ID != identity.EnrollmentID ||
		enrollment.NodePeerID != identity.NodePeerID ||
		enrollment.Generation != identity.Generation ||
		enrollment.CredentialJTI != identity.JTI ||
		!enrollment.NodeAuthorizationUntil.After(s.now()) {
		return nil, ErrCredentialInvalid
	}
	return enrollment, nil
}

// ---- Enrollment operations ----

func (s *Service) ListOnlineEnrollments(ctx context.Context) ([]domain.Enrollment, error) {
	return s.repo.ListOnlineEnrollments(ctx)
}

func (s *Service) CountOnlineEnrollments(ctx context.Context) (int64, error) {
	return s.repo.CountOnlineEnrollments(ctx)
}

func (s *Service) RevokeEnrollment(
	ctx context.Context,
	stationPeerID string,
	nodePeerID string,
) (*domain.Enrollment, error) {
	enrollment, err := s.repo.RevokeEnrollment(
		ctx,
		stationPeerID,
		nodePeerID,
	)
	if errors.Is(err, domain.ErrEnrollmentNotFound) {
		return nil, ErrEnrollmentNotFound
	}
	if err != nil {
		return nil, err
	}
	decodedNodePeerID, decodeErr := peer.Decode(enrollment.NodePeerID)
	if decodeErr != nil {
		return enrollment, fmt.Errorf("decode revoked Node PeerID: %w", decodeErr)
	}
	s.InvalidateNodeRoutes(stationPeerID, nodePeerID)
	if revokeErr := s.admission.RevokeNode(decodedNodePeerID); revokeErr != nil {
		return enrollment, fmt.Errorf("retire revoked Node circuits: %w", revokeErr)
	}
	return enrollment, nil
}

func (s *Service) UpdateEnrollmentStatus(
	ctx context.Context,
	stationPeerID string,
	nodePeerID string,
	generation uint64,
	status domain.EnrollmentStatus,
) error {
	return s.repo.UpdateEnrollmentStatus(
		ctx,
		stationPeerID,
		nodePeerID,
		generation,
		status,
	)
}

func (s *Service) GetEnrollment(
	ctx context.Context,
	stationPeerID string,
	nodePeerID string,
) (*domain.Enrollment, error) {
	return s.repo.GetEnrollment(ctx, stationPeerID, nodePeerID)
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
