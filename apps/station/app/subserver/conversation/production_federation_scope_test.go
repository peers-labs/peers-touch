package conversation

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/internal/identity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newScopeResolverTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:scope-resolver-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := federationinfra.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedActiveMembership(
	t *testing.T,
	db *gorm.DB,
	federationID, station string,
) {
	t.Helper()
	if err := federationinfra.NewRepos(db).Membership.Upsert(
		context.Background(),
		&federationdomain.MembershipRecord{
			FederationID:  federationID,
			StationPeerID: station,
			Status:        "active",
		},
	); err != nil {
		t.Fatal(err)
	}
}

func TestResolveSharedFederationReturnsUniqueActiveFederation(t *testing.T) {
	db := newScopeResolverTestDB(t)
	shared := string(identity.NewFederationID())
	other := string(identity.NewFederationID())
	seedActiveMembership(t, db, shared, "station-a")
	seedActiveMembership(t, db, shared, "station-b")
	seedActiveMembership(t, db, other, "station-a")

	resolved, err := newProductionFederationDirectory(db).ResolveSharedFederation(
		context.Background(),
		valueobject.StationID("station-a"),
		valueobject.StationID("station-b"),
	)
	if err != nil {
		t.Fatalf("ResolveSharedFederation() error = %v", err)
	}
	if resolved != valueobject.FederationID(shared) {
		t.Fatalf("resolved federation = %q, want %q", resolved, shared)
	}
}

func TestResolveSharedFederationRejectsNoSharedFederation(t *testing.T) {
	db := newScopeResolverTestDB(t)
	seedActiveMembership(t, db, string(identity.NewFederationID()), "station-a")
	seedActiveMembership(t, db, string(identity.NewFederationID()), "station-b")

	_, err := newProductionFederationDirectory(db).ResolveSharedFederation(
		context.Background(),
		valueobject.StationID("station-a"),
		valueobject.StationID("station-b"),
	)
	if err == nil {
		t.Fatal("stations without a shared active federation must be rejected")
	}
}

func TestResolveSharedFederationRejectsAmbiguousSharedFederation(t *testing.T) {
	db := newScopeResolverTestDB(t)
	fedA := string(identity.NewFederationID())
	fedB := string(identity.NewFederationID())
	for _, fedID := range []string{fedA, fedB} {
		seedActiveMembership(t, db, fedID, "station-a")
		seedActiveMembership(t, db, fedID, "station-b")
	}

	_, err := newProductionFederationDirectory(db).ResolveSharedFederation(
		context.Background(),
		valueobject.StationID("station-a"),
		valueobject.StationID("station-b"),
	)
	if err == nil {
		t.Fatal("stations sharing multiple active federations must be rejected as ambiguous")
	}
}
