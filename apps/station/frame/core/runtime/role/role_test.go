package role

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestParseRequiresExplicitKnownRole(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		value   string
		want    Role
		wantErr error
	}{
		{name: "station", value: "station", want: Station},
		{name: "relay", value: " RELAY ", want: Relay},
		{name: "missing", value: "", wantErr: ErrMissing},
		{name: "unknown", value: "hybrid", wantErr: ErrInvalid},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			got, err := Parse(test.value)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Parse(%q) error = %v, want %v", test.value, err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("Parse(%q) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}

func TestContextCarriesOneValidatedRole(t *testing.T) {
	t.Parallel()

	if _, err := FromContext(context.Background()); !errors.Is(err, ErrMissing) {
		t.Fatalf("unbound context error = %v, want %v", err, ErrMissing)
	}

	ctx := WithContext(context.Background(), Relay)
	got, err := FromContext(ctx)
	if err != nil {
		t.Fatalf("FromContext: %v", err)
	}
	if got != Relay {
		t.Fatalf("FromContext = %q, want %q", got, Relay)
	}
}

func TestRoleCompositionAllowlists(t *testing.T) {
	t.Parallel()

	if !Station.IncludesApplicationSubservers() || !Station.IncludesTouch() {
		t.Fatal("station role must include application subservers and touch routes")
	}
	if Relay.IncludesApplicationSubservers() || Relay.IncludesTouch() {
		t.Fatal("relay role must exclude application subservers and touch routes")
	}

	wantStationPlugins := []string{
		"agent",
		"bootstrap",
		"launcher",
		"oauth",
		"oss",
		"relay-client",
		"turn",
	}
	if got := Station.PluginSubservers(); !reflect.DeepEqual(got, wantStationPlugins) {
		t.Fatalf("station plugins = %v, want %v", got, wantStationPlugins)
	}
	if got := Relay.PluginSubservers(); !reflect.DeepEqual(got, []string{"relay"}) {
		t.Fatalf("relay plugins = %v, want [relay]", got)
	}

	for _, forbidden := range []string{
		"actor_identity",
		"conversation",
		"federation",
		"oauth",
		"social",
		"unknown-future-plugin",
	} {
		if Relay.AllowsPluginSubserver(forbidden) {
			t.Fatalf("relay role unexpectedly allows plugin %q", forbidden)
		}
	}
}
