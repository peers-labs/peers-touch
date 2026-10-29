package valueobject

import "testing"

func TestLocalScope(t *testing.T) {
	station := StationID("12D3KooWStation")
	scope, err := LocalScope(station)
	if err != nil {
		t.Fatal(err)
	}
	if !scope.IsLocal() || scope.IsFederation() {
		t.Fatal("new scope must be local")
	}
	if got := scope.LocalStation(); got != station {
		t.Fatalf("local station = %q", got)
	}
	if fed, ok := scope.FederationID(); ok || fed != "" {
		t.Fatal("local scope must expose no federation id")
	}
	if scope.IsZero() {
		t.Fatal("local scope is not zero")
	}
	if scope.Canonical() != "local\x00"+string(station) {
		t.Fatalf("canonical = %q", scope.Canonical())
	}
	if _, err := LocalScope(""); err == nil {
		t.Fatal("empty station must fail")
	}
}

func TestFederationScope(t *testing.T) {
	fed := FederationID("fed_01J0network")
	scope, err := FederationScope(fed)
	if err != nil {
		t.Fatal(err)
	}
	if !scope.IsFederation() || scope.IsLocal() {
		t.Fatal("scope must be federation")
	}
	got, ok := scope.FederationID()
	if !ok || got != fed {
		t.Fatalf("federation id = (%q,%v)", got, ok)
	}
	if scope.FederationIDOrEmpty() != fed {
		t.Fatal("or-empty should return id")
	}
	if scope.Canonical() != "federation\x00"+string(fed) {
		t.Fatalf("canonical = %q", scope.Canonical())
	}
	if _, err := FederationScope(""); err == nil {
		t.Fatal("empty federation must fail")
	}
}

func TestScopeEqualityAndKindIsolation(t *testing.T) {
	local, _ := LocalScope("12D3KooWS")
	fed := MustFederationScope("fed_1")
	if local.Equal(fed) {
		t.Fatal("local and federation scopes must never be equal")
	}
	if local.Canonical() == fed.Canonical() {
		t.Fatal("canonical encodings must not collide across kinds")
	}
	local2, _ := LocalScope("12D3KooWS")
	if !local.Equal(local2) {
		t.Fatal("same local scopes must be equal")
	}
	other, _ := LocalScope("12D3KooWO")
	if local.Equal(other) {
		t.Fatal("local scopes of different stations must differ")
	}
}

func TestScopeFromPersistence(t *testing.T) {
	local, err := ScopeFromPersistence(ScopeKindLocal, "", "12D3KooWS")
	if err != nil || !local.IsLocal() || local.LocalStation() != "12D3KooWS" {
		t.Fatalf("rebuild local: %v %+v", err, local)
	}
	// A stray federation id column on a local row must not leak through.
	local2, err := ScopeFromPersistence(ScopeKindLocal, "fed_x", "12D3KooWS")
	if err != nil || !local2.IsLocal() {
		t.Fatal("local kind must ignore stored federation id")
	}
	fed, err := ScopeFromPersistence(ScopeKindFederation, "fed_1", "")
	if err != nil || !fed.IsFederation() {
		t.Fatalf("rebuild federation: %v", err)
	}
	if _, err := ScopeFromPersistence(ScopeKindFederation, "", "12D3KooWS"); err == nil {
		t.Fatal("federation kind without id must fail")
	}
	if _, err := ScopeFromPersistence("bogus", "", "s"); err == nil {
		t.Fatal("unknown kind must fail")
	}
}
