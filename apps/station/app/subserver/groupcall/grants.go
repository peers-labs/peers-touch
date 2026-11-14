package groupcall

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	actorpersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/mediaaccess"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	grantHome      = "home"
	grantAuthority = "authority"
	grantIssued    = "issued"
	grantAdmitting = "admitting"
	grantAdmitted  = "admitted"
	grantRevoked   = "revoked"
)

// A grant is media authorization, not another membership/device/session store.
// Tombstones are retained across restart and are never reactivated.
type endpointGrant struct {
	GrantID        string    `gorm:"primaryKey;size:64"`
	Side           string    `gorm:"primaryKey;size:16"`
	ConversationID string    `gorm:"index;size:64;not null"`
	ActorPTID      string    `gorm:"column:actor_ptid;index;size:255;not null"`
	DeviceID       string    `gorm:"index;size:128;not null"`
	SessionID      string    `gorm:"index;size:100;not null"`
	Home           string    `gorm:"size:255;not null"`
	Authority      string    `gorm:"size:255;not null"`
	FederationID   string    `gorm:"size:64;not null"`
	AuthorityEpoch uint64    `gorm:"not null"`
	ExpiresAt      time.Time `gorm:"not null;index"`
	Status         string    `gorm:"size:16;not null;index"`
	ParticipantSID string    `gorm:"column:participant_sid;size:64;not null"`
	Ejected        bool      `gorm:"not null;default:false"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (endpointGrant) TableName() string  { return "group_call_endpoint_grants" }
func (g endpointGrant) identity() string { return "gce-" + g.GrantID }
func (g endpointGrant) endpoint() mediaaccess.Endpoint {
	return mediaaccess.Endpoint{ActorPTID: g.ActorPTID, DeviceID: g.DeviceID, Home: g.Home}
}
func (g endpointGrant) wire() *realtime.GroupCallEndpointGrant {
	return &realtime.GroupCallEndpointGrant{
		GrantId: g.GrantID, ConversationId: g.ConversationID, ActorPtid: g.ActorPTID,
		ActorDeviceId: g.DeviceID, SessionId: g.SessionID, HomeStationPeerId: g.Home,
		AuthorityStationPeerId: g.Authority, FederationId: g.FederationID,
		AuthorityEpoch: g.AuthorityEpoch, ExpiresAtUnixMs: g.ExpiresAt.UnixMilli(),
	}
}
func grantFromWire(w *realtime.GroupCallEndpointGrant, side string) (endpointGrant, error) {
	if w == nil || len(w.GetGrantId()) != 64 || w.GetConversationId() == "" ||
		w.GetActorPtid() == "" || w.GetActorDeviceId() == "" || w.GetSessionId() == "" ||
		w.GetHomeStationPeerId() == "" || w.GetAuthorityStationPeerId() == "" ||
		w.GetFederationId() == "" || w.GetAuthorityEpoch() == 0 ||
		w.GetExpiresAtUnixMs() <= 0 {
		return endpointGrant{}, fmt.Errorf("group call endpoint grant is incomplete or expired")
	}
	if _, err := hex.DecodeString(w.GetGrantId()); err != nil {
		return endpointGrant{}, fmt.Errorf("invalid group call grant identity")
	}
	return endpointGrant{
		GrantID: w.GetGrantId(), Side: side, ConversationID: w.GetConversationId(),
		ActorPTID: w.GetActorPtid(), DeviceID: w.GetActorDeviceId(), SessionID: w.GetSessionId(),
		Home: w.GetHomeStationPeerId(), Authority: w.GetAuthorityStationPeerId(),
		FederationID: w.GetFederationId(), AuthorityEpoch: w.GetAuthorityEpoch(),
		ExpiresAt: time.UnixMilli(w.GetExpiresAtUnixMs()).UTC(), Status: grantIssued,
		CreatedAt: time.Now().UTC(),
	}, nil
}

type mediaSessionOwner interface {
	WithMediaSessionFence(context.Context, string, string, string, func(*gorm.DB, session.MediaSession) error) error
	MediaSessionActive(context.Context, string, string, string, string) (bool, error)
}

func currentMediaSessionOwner() (mediaSessionOwner, error) {
	owner, ok := coreauth.GetGlobalSessionValidator().(mediaSessionOwner)
	if !ok || owner == nil {
		return nil, fmt.Errorf("group call Session owner is unavailable")
	}
	return owner, nil
}

// issueHome retains the original Session and Actor Device locks until Authority
// issuance finishes. Grant commits use the media owner's own transaction so a
// conservative tombstone survives a failed permission mutation.
func (s *subServer) issueHome(ctx context.Context, subject *coreauth.Subject, group, authority, federation string, epoch uint64) (*JoinResponse, error) {
	owner, err := currentMediaSessionOwner()
	if err != nil {
		return nil, err
	}
	var result *JoinResponse
	err = owner.WithMediaSessionFence(ctx, subject.SessionID, subject.ID, s.federation.LocalStationPeerID(),
		func(tx *gorm.DB, binding session.MediaSession) error {
			if err := actorpersistence.RequireActiveDeviceForMutation(tx,
				actorpersistence.DeviceLocator{PTID: subject.ID, DeviceID: binding.DeviceID}); err != nil {
				return err
			}
			nonce := make([]byte, 32)
			if _, err := rand.Read(nonce); err != nil {
				return err
			}
			g := endpointGrant{
				GrantID: hex.EncodeToString(nonce), Side: grantHome, ConversationID: group,
				ActorPTID: subject.ID, DeviceID: binding.DeviceID, SessionID: binding.SessionID,
				Home: s.federation.LocalStationPeerID(), Authority: authority,
				FederationID: federation, AuthorityEpoch: epoch, ExpiresAt: binding.ExpiresAt,
				Status: grantIssued, CreatedAt: time.Now().UTC(),
			}
			if err := s.db.WithContext(ctx).Create(&g).Error; err != nil {
				return err
			}
			var issueErr error
			result, issueErr = s.issueAtAuthority(ctx, g)
			if issueErr != nil {
				// Deny future admissions even if remote issuance completed but its
				// response was lost. No token ever enters this durable row.
				revokeErr := s.revokeHome(ctx, s.db.Where("grant_id = ? AND side = ?", g.GrantID, grantHome))
				return errors.Join(issueErr, revokeErr)
			}
			return nil
		})
	return result, err
}

func (s *subServer) authorizeHome(ctx context.Context, expected endpointGrant) (bool, error) {
	var current endpointGrant
	err := s.db.WithContext(ctx).Where("grant_id = ? AND side = ?", expected.GrantID, grantHome).Take(&current).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if current.Status == grantRevoked || !current.ExpiresAt.After(time.Now()) ||
		!sameGrant(current, expected) {
		return false, nil
	}
	owner, err := currentMediaSessionOwner()
	if err != nil {
		return false, err
	}
	// The Home tombstone, committed under the permission owner's fence, is the
	// monotonic media authorization. Do not take permission row locks here.
	return owner.MediaSessionActive(ctx, current.SessionID, current.ActorPTID, current.DeviceID, current.Home)
}

func sameGrant(a, b endpointGrant) bool {
	return a.GrantID == b.GrantID && a.ConversationID == b.ConversationID &&
		a.ActorPTID == b.ActorPTID && a.DeviceID == b.DeviceID && a.SessionID == b.SessionID &&
		a.Home == b.Home && a.Authority == b.Authority && a.FederationID == b.FederationID &&
		a.AuthorityEpoch == b.AuthorityEpoch && a.ExpiresAt.UnixMilli() == b.ExpiresAt.UnixMilli()
}

func (s *subServer) RevokeDevice(ctx context.Context, ptid, deviceID string) error {
	return s.revokeHome(ctx, s.db.Where("side = ? AND actor_ptid = ? AND device_id = ?", grantHome, ptid, deviceID))
}
func (s *subServer) RevokeSessions(ctx context.Context, ids []string) error {
	return s.revokeHome(ctx, s.db.Where("side = ? AND session_id IN ?", grantHome, ids))
}
func (s *subServer) ReconcileConversation(ctx context.Context, scope mediaaccess.ConversationScope) error {
	if scope.Authority != s.federation.LocalStationPeerID() {
		return nil
	}
	var grants []endpointGrant
	if err := s.db.WithContext(ctx).Where("side = ? AND conversation_id = ? AND ejected = false",
		grantAuthority, scope.ConversationID).Find(&grants).Error; err != nil {
		return err
	}
	for _, g := range grants {
		allowed := false
		for _, endpoint := range scope.Endpoints {
			if scope.Active && g.AuthorityEpoch == scope.Epoch && endpoint == g.endpoint() {
				allowed = true
				break
			}
		}
		if !allowed {
			if err := s.revokeAuthority(ctx, g); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *subServer) revokeHome(ctx context.Context, query *gorm.DB) error {
	var grants []endpointGrant
	// This independent tombstone commit must happen before calling Authority.
	// Holding Home grant locks while asking Authority would invert admission.
	err := query.WithContext(ctx).Where("ejected = false").Find(&grants).Error
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(grants))
	for _, g := range grants {
		ids = append(ids, g.GrantID)
	}
	if len(ids) == 0 {
		return nil
	}
	if err := s.db.WithContext(ctx).Model(&endpointGrant{}).
		Where("grant_id IN ? AND side = ?", ids, grantHome).Update("status", grantRevoked).Error; err != nil {
		return err
	}
	for _, g := range grants {
		if err := s.ejectAtAuthority(ctx, g); err != nil {
			return err
		}
		if err := s.db.WithContext(ctx).Model(&endpointGrant{}).
			Where("grant_id = ? AND side = ?", g.GrantID, grantHome).Update("ejected", true).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *subServer) revokeAuthority(ctx context.Context, expected endpointGrant) error {
	if err := s.db.WithContext(ctx).Model(&endpointGrant{}).
		Where("grant_id = ? AND side = ?", expected.GrantID, grantAuthority).
		Update("status", grantRevoked).Error; err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var g endpointGrant
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("grant_id = ? AND side = ?", expected.GrantID, grantAuthority).Take(&g).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// A revoke that overtakes a delayed join still leaves a tombstone.
			g = expected
			g.Side = grantAuthority
			g.Status = grantRevoked
			if err := tx.Create(&g).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if !sameGrant(g, expected) {
			return fmt.Errorf("endpoint revocation grant does not match")
		}
		if g.Ejected {
			return nil
		}
		if err := s.provider.RemoveParticipant(ctx, roomName(g.ConversationID), g.identity()); err != nil {
			return err
		}
		return tx.Model(&g).Update("ejected", true).Error
	})
}

func (s *subServer) admit(ctx context.Context, room, identity, sid string) error {
	var g endpointGrant
	if len(identity) != 68 || identity[:4] != "gce-" || sid == "" {
		return fmt.Errorf("unknown group media endpoint")
	}
	if err := s.db.WithContext(ctx).Where("grant_id = ? AND side = ?", identity[4:], grantAuthority).
		Take(&g).Error; err != nil {
		return err
	}
	if room != roomName(g.ConversationID) {
		return fmt.Errorf("media room does not match grant")
	}
	return s.authorityFence.WithGroupCallFence(ctx, g.ConversationID, g.endpoint(), g.Authority, g.AuthorityEpoch, func() error {
		// Consume the SID durably BEFORE granting media. A later persistence
		// failure must not make this grant reusable by a different connection.
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("grant_id = ? AND side = ?", g.GrantID, grantAuthority).Take(&g).Error; err != nil {
				return err
			}
			if g.Status == grantRevoked || !g.ExpiresAt.After(time.Now()) ||
				(g.ParticipantSID != "" && g.ParticipantSID != sid) {
				return fmt.Errorf("group media grant is no longer admissible")
			}
			allowed, err := s.checkHome(ctx, g)
			if err != nil {
				return err
			}
			if !allowed {
				return fmt.Errorf("group media Home authorization was revoked")
			}
			if g.Status == grantAdmitted {
				return nil
			}
			return tx.Model(&g).Updates(map[string]any{
				"status": grantAdmitting, "participant_sid": sid,
			}).Error
		})
		if err != nil {
			return err
		}
		err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("grant_id = ? AND side = ?", g.GrantID, grantAuthority).Take(&g).Error; err != nil {
				return err
			}
			if g.Status == grantRevoked || g.ParticipantSID != sid || !g.ExpiresAt.After(time.Now()) {
				return fmt.Errorf("group media admission was revoked")
			}
			allowed, err := s.checkHome(ctx, g)
			if err != nil {
				return err
			}
			if !allowed {
				return fmt.Errorf("group media Home authorization was revoked")
			}
			if err := s.provider.AdmitParticipant(ctx, room, identity, sid, g.ActorPTID); err != nil {
				return err
			}
			if err := tx.Model(&g).Updates(map[string]any{"status": grantAdmitted, "participant_sid": sid}).Error; err != nil {
				return err
			}
			// An actual successful join clears this Actor's earlier "not now".
			return tx.Where("conversation_id = ? AND actor_ptid = ?", g.ConversationID, g.ActorPTID).
				Delete(&invitationDecision{}).Error
		})
		if err != nil {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
			defer cancel()
			return errors.Join(err, s.revokeAuthority(cleanup, g))
		}
		return nil
	})
}
