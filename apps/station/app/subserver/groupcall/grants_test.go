package groupcall

import (
	"context"
	"errors"
	"testing"
	"time"

	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"gorm.io/gorm"
)

func readGrant(t *testing.T, s *subServer, id, side string) endpointGrant {
	t.Helper()
	var row endpointGrant
	if err := s.db.Where("grant_id = ? AND side = ?", id, side).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

func TestMintEndpointGrant(t *testing.T) {
	for _, state := range []string{grantIssued, grantAdmitting, grantAdmitted, grantRevoked} {
		t.Run(state, func(t *testing.T) {
			s, provider, _ := newGroupCallFixture(t)
			g := testEndpointGrant()
			stored := g
			stored.Status = state
			if err := s.db.Create(&stored).Error; err != nil {
				t.Fatal(err)
			}
			result, err := s.mintEndpointGrant(context.Background(), g)
			if state == grantIssued {
				if err != nil || result.ParticipantIdentity != g.identity() {
					t.Fatalf("grant = %v, %v", result, err)
				}
			} else if err == nil || provider.tokenFor != "" {
				t.Fatal("a consumed or revoked grant minted a token")
			}
		})
	}
	t.Run("Home withdrawn", func(t *testing.T) {
		s, provider, federation := newGroupCallFixture(t)
		federation.allowed = false
		if _, err := s.mintEndpointGrant(context.Background(), testEndpointGrant()); err == nil {
			t.Fatal("withdrawn Home authorization minted a token")
		}
		if provider.createdFor != "" {
			t.Fatal("denied endpoint reached SFU")
		}
	})
}

func TestAdmit(t *testing.T) {
	t.Run("consumed SID and replay", func(t *testing.T) {
		s, provider, _ := newGroupCallFixture(t)
		g := testEndpointGrant()
		if err := s.db.Create(&g).Error; err != nil {
			t.Fatal(err)
		}
		if err := s.admit(context.Background(), roomName(g.ConversationID), g.identity(), "PA-first"); err != nil {
			t.Fatal(err)
		}
		row := readGrant(t, s, g.GrantID, grantAuthority)
		if row.Status != grantAdmitted || row.ParticipantSID != "PA-first" || provider.admittedSID != "PA-first" {
			t.Fatalf("admission = %+v", row)
		}
		if err := s.admit(context.Background(), roomName(g.ConversationID), g.identity(), "PA-second"); err == nil {
			t.Fatal("saved token/new SID replay was admitted")
		}
		if provider.admittedSID != "PA-first" {
			t.Fatal("new SID reached permission update")
		}
	})
	t.Run("failed final commit retires consumed grant", func(t *testing.T) {
		s, provider, _ := newGroupCallFixture(t)
		g := testEndpointGrant()
		if err := s.db.Create(&g).Error; err != nil {
			t.Fatal(err)
		}
		commitFailure := errors.New("admitted commit failed")
		if err := s.db.Callback().Update().Before("gorm:update").Register("test:admitted-failure", func(tx *gorm.DB) {
			if values, ok := tx.Statement.Dest.(map[string]any); ok && values["status"] == grantAdmitted {
				tx.AddError(commitFailure)
			}
		}); err != nil {
			t.Fatal(err)
		}
		err := s.admit(context.Background(), roomName(g.ConversationID), g.identity(), "PA-first")
		if !errors.Is(err, commitFailure) {
			t.Fatalf("admit error = %v", err)
		}
		row := readGrant(t, s, g.GrantID, grantAuthority)
		if row.Status != grantRevoked || !row.Ejected || row.ParticipantSID != "PA-first" || len(provider.removed) != 1 {
			t.Fatalf("failed final commit left media live: %+v", row)
		}
	})
	for _, scenario := range []string{"Home denied", "wrong room", "expired", "revoked", "unknown identity"} {
		t.Run(scenario, func(t *testing.T) {
			s, provider, federation := newGroupCallFixture(t)
			g := testEndpointGrant()
			room, identity := roomName(g.ConversationID), g.identity()
			switch scenario {
			case "Home denied":
				federation.allowed = false
			case "wrong room":
				room = "gc-other"
			case "expired":
				g.ExpiresAt = time.Now().Add(-time.Hour)
			case "revoked":
				g.Status = grantRevoked
			case "unknown identity":
				identity = "ptid:alice"
			}
			if err := s.db.Create(&g).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.admit(context.Background(), room, identity, "PA-first"); err == nil {
				t.Fatal("invalid grant admitted")
			}
			if provider.admittedSID != "" {
				t.Fatal("denied grant reached media update")
			}
		})
	}
}

func TestRevokeAuthority(t *testing.T) {
	t.Run("eject failure retains tombstone for retry", func(t *testing.T) {
		s, provider, _ := newGroupCallFixture(t)
		g := testEndpointGrant()
		g.Status, g.ParticipantSID = grantAdmitted, "PA-first"
		if err := s.db.Create(&g).Error; err != nil {
			t.Fatal(err)
		}
		provider.removeErr = errors.New("SFU unavailable")
		if err := s.revokeAuthority(context.Background(), g); err == nil {
			t.Fatal("failed eject returned success")
		}
		row := readGrant(t, s, g.GrantID, grantAuthority)
		if row.Status != grantRevoked || row.Ejected {
			t.Fatalf("lost tombstone: %+v", row)
		}
		provider.removeErr = nil
		if err := s.maintainGrants(context.Background()); err != nil {
			t.Fatal(err)
		}
		if !readGrant(t, s, g.GrantID, grantAuthority).Ejected {
			t.Fatal("maintenance did not retry ejection")
		}
		if _, err := s.mintEndpointGrant(context.Background(), g); err == nil {
			t.Fatal("retry reactivated tombstone")
		}
	})
	t.Run("revocation overtakes delayed issuance", func(t *testing.T) {
		s, _, _ := newGroupCallFixture(t)
		g := testEndpointGrant()
		if err := s.revokeAuthority(context.Background(), g); err != nil {
			t.Fatal(err)
		}
		if _, err := s.mintEndpointGrant(context.Background(), g); err == nil {
			t.Fatal("delayed mint ignored tombstone")
		}
	})
}

func TestRevokeHome(t *testing.T) {
	s, _, federation := newGroupCallFixture(t)
	federation.localStation = testGroupCallHome
	g := testEndpointGrant()
	g.Side = grantHome
	if err := s.db.Create(&g).Error; err != nil {
		t.Fatal(err)
	}
	federation.err = errors.New("Authority unreachable")
	if err := s.RevokeDevice(context.Background(), g.ActorPTID, g.DeviceID); err == nil {
		t.Fatal("unconfirmed device media revocation returned success")
	}
	row := readGrant(t, s, g.GrantID, grantHome)
	if row.Status != grantRevoked || row.Ejected {
		t.Fatalf("Home did not persist denial: %+v", row)
	}
	federation.err = nil
	if err := s.maintainGrants(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !readGrant(t, s, g.GrantID, grantHome).Ejected {
		t.Fatal("Home retry did not confirm ejection")
	}
}

func TestMaintainGrants(t *testing.T) {
	for _, scenario := range []struct {
		name            string
		expiry, updated time.Duration
		wantRevoked     bool
	}{
		{"recent admission", time.Hour, 0, false},
		{"abandoned admission", time.Hour, -2 * time.Minute, true},
		{"expired recent admission", -time.Minute, 0, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, provider, _ := newGroupCallFixture(t)
			g := testEndpointGrant()
			g.Status = grantAdmitting
			g.ExpiresAt = time.Now().Add(scenario.expiry)
			g.UpdatedAt = time.Now().Add(scenario.updated)
			if err := s.db.Create(&g).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.maintainGrants(context.Background()); err != nil {
				t.Fatal(err)
			}
			row := readGrant(t, s, g.GrantID, grantAuthority)
			if (row.Status == grantRevoked) != scenario.wantRevoked || (len(provider.removed) > 0) != scenario.wantRevoked {
				t.Fatalf("maintenance = %+v, removals=%v", row, provider.removed)
			}
		})
	}
}

func TestAuthorityRoomQuery(t *testing.T) {
	s, provider, _ := newGroupCallFixture(t)
	provider.roomStatus = RoomStatus{Active: true, RoomName: roomName(testGroupCallID), RoomSID: "RM-new"}
	input := &realtime.GroupCallEndpointControlRequest{
		Kind:    realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_DECLINE_INVITATION,
		RoomSid: "RM-old",
		RoomQuery: &realtime.GroupCallAuthorityJoinRequest{
			ConversationId: testGroupCallID, ActorPtid: testGroupCallActor, ActorDeviceId: "device-alice",
			SourceHomeStationPeerId: testGroupCallHome, FederationId: testGroupCallFederation, AuthorityEpoch: testGroupCallEpoch,
		},
	}
	if _, err := s.authorityRoomQuery(context.Background(), input); err == nil {
		t.Fatal("old-room decline changed current invitation")
	}
	input.RoomSid = "RM-new"
	result, err := s.authorityRoomQuery(context.Background(), input)
	if err != nil || len(result.DeclinedActorPTIDs) != 1 {
		t.Fatalf("current decline = %+v, %v", result, err)
	}
	provider.roomStatus.RoomSID = "RM-next"
	input.Kind = realtime.GroupCallEndpointControlKind_GROUP_CALL_ENDPOINT_CONTROL_KIND_ROOM_STATUS
	result, err = s.authorityRoomQuery(context.Background(), input)
	if err != nil || len(result.DeclinedActorPTIDs) != 0 {
		t.Fatalf("old decisions leaked to new room: %+v, %v", result, err)
	}
}
