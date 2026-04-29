// Tests pin the strict-mode contract end-to-end. Each test
// resets the registry first so they can run in any order under
// `go test -shuffle=on`.
package scope

import (
	"errors"
	"testing"
	"time"
)

func TestRegister_HappyPath(t *testing.T) {
	ResetForTest()
	if err := Register(Scope{
		Name:        "demo",
		Description: "demo scope",
		Policy:      Policy{TTLMax: time.Minute},
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	got, err := Get("demo")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Policy.TTLMax != time.Minute {
		t.Errorf("policy round-trip: got %v want %v", got.Policy.TTLMax, time.Minute)
	}
}

func TestRegister_RejectsEmptyName(t *testing.T) {
	ResetForTest()
	err := Register(Scope{Policy: Policy{TTLMax: time.Minute}})
	if !errors.Is(err, ErrInvalidPolicy) {
		t.Fatalf("expected ErrInvalidPolicy, got %v", err)
	}
}

func TestRegister_RejectsWhitespaceName(t *testing.T) {
	ResetForTest()
	err := Register(Scope{Name: " demo ", Policy: Policy{TTLMax: time.Minute}})
	if !errors.Is(err, ErrInvalidPolicy) {
		t.Fatalf("expected ErrInvalidPolicy, got %v", err)
	}
}

func TestRegister_RejectsZeroTTLMax(t *testing.T) {
	ResetForTest()
	err := Register(Scope{Name: "demo", Policy: Policy{TTLMax: 0}})
	if !errors.Is(err, ErrInvalidPolicy) {
		t.Fatalf("expected ErrInvalidPolicy, got %v", err)
	}
}

func TestRegister_RejectsEmptyClaimKey(t *testing.T) {
	ResetForTest()
	err := Register(Scope{
		Name:   "demo",
		Policy: Policy{TTLMax: time.Minute, AllowedClaimKeys: []string{""}},
	})
	if !errors.Is(err, ErrInvalidPolicy) {
		t.Fatalf("expected ErrInvalidPolicy, got %v", err)
	}
}

func TestRegister_RefusesDuplicate(t *testing.T) {
	ResetForTest()
	must := Scope{Name: "demo", Policy: Policy{TTLMax: time.Minute}}
	if err := Register(must); err != nil {
		t.Fatalf("first register: %v", err)
	}
	err := Register(must)
	if !errors.Is(err, ErrAlreadyRegistered) {
		t.Fatalf("expected ErrAlreadyRegistered, got %v", err)
	}
}

func TestSeal_BlocksFurtherRegister(t *testing.T) {
	ResetForTest()
	if err := Register(Scope{Name: "demo", Policy: Policy{TTLMax: time.Minute}}); err != nil {
		t.Fatalf("register: %v", err)
	}
	Seal()
	if !IsSealed() {
		t.Fatalf("Seal did not transition state")
	}
	err := Register(Scope{Name: "demo2", Policy: Policy{TTLMax: time.Minute}})
	if !errors.Is(err, ErrRegistrySealed) {
		t.Fatalf("expected ErrRegistrySealed, got %v", err)
	}
}

func TestMustRegister_PanicsOnError(t *testing.T) {
	ResetForTest()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("MustRegister should panic on bad scope")
		}
	}()
	MustRegister(Scope{Name: "", Policy: Policy{TTLMax: time.Minute}})
}

func TestMustGet_PanicsOnMissing(t *testing.T) {
	ResetForTest()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("MustGet should panic on missing scope")
		}
	}()
	MustGet("nope")
}

func TestGet_UnknownReturnsTypedError(t *testing.T) {
	ResetForTest()
	_, err := Get("nope")
	if !errors.Is(err, ErrUnknownScope) {
		t.Fatalf("expected ErrUnknownScope, got %v", err)
	}
}

func TestListAll_StableOrder(t *testing.T) {
	ResetForTest()
	for _, name := range []string{"c-scope", "a-scope", "b-scope"} {
		MustRegister(Scope{Name: name, Policy: Policy{TTLMax: time.Minute}})
	}
	got := ListAll()
	if len(got) != 3 {
		t.Fatalf("len: %d", len(got))
	}
	want := []string{"a-scope", "b-scope", "c-scope"}
	for i, s := range got {
		if s.Name != want[i] {
			t.Errorf("[%d]: got %q want %q", i, s.Name, want[i])
		}
	}
}

// ---- CheckMint -------------------------------------------------------------

func TestCheckMint_RejectsUnknownScope(t *testing.T) {
	ResetForTest()
	_, err := CheckMint("missing", "peer-A", time.Second, nil)
	if !errors.Is(err, ErrUnknownScope) {
		t.Fatalf("expected ErrUnknownScope, got %v", err)
	}
}

func TestCheckMint_HappyPath(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{
		Name: "demo",
		Policy: Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{"oss_key"},
		},
	})
	if _, err := CheckMint("demo", "peer-A", 30*time.Second, map[string]string{"oss_key": "k"}); err != nil {
		t.Fatalf("expected pass, got %v", err)
	}
}

func TestCheckMint_RejectsTTLOverflow(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{Name: "demo", Policy: Policy{TTLMax: time.Minute}})
	_, err := CheckMint("demo", "", time.Hour, nil)
	if !errors.Is(err, ErrTTLExceedsPolicy) {
		t.Fatalf("expected ErrTTLExceedsPolicy, got %v", err)
	}
}

func TestCheckMint_ZeroTTLDoesNotErrorAndUsesMax(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{Name: "demo", Policy: Policy{TTLMax: time.Minute}})
	s, err := CheckMint("demo", "", 0, nil)
	if err != nil {
		t.Fatalf("zero TTL should pass, got %v", err)
	}
	if got := EffectiveTTL(s, 0); got != time.Minute {
		t.Errorf("EffectiveTTL: got %v want %v", got, time.Minute)
	}
}

func TestCheckMint_AudienceRequired(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{
		Name:   "demo",
		Policy: Policy{TTLMax: time.Minute, AudienceRequired: true},
	})
	_, err := CheckMint("demo", "  ", time.Second, nil)
	if !errors.Is(err, ErrAudienceRequired) {
		t.Fatalf("expected ErrAudienceRequired, got %v", err)
	}
}

func TestCheckMint_AudienceOptionalByDefault(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{Name: "demo", Policy: Policy{TTLMax: time.Minute}})
	if _, err := CheckMint("demo", "", time.Second, nil); err != nil {
		t.Fatalf("expected pass, got %v", err)
	}
}

func TestCheckMint_RejectsDisallowedClaim(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{
		Name:   "demo",
		Policy: Policy{TTLMax: time.Minute, AllowedClaimKeys: []string{"oss_key"}},
	})
	_, err := CheckMint("demo", "", time.Second, map[string]string{"hidden": "v"})
	if !errors.Is(err, ErrClaimNotAllowed) {
		t.Fatalf("expected ErrClaimNotAllowed, got %v", err)
	}
}

func TestCheckMint_AllowsAnyClaimWildcard(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{
		Name:   "demo",
		Policy: Policy{TTLMax: time.Minute, AllowedClaimKeys: []string{AnyClaimKey}},
	})
	if _, err := CheckMint("demo", "", time.Second, map[string]string{"x": "1", "y": "2"}); err != nil {
		t.Fatalf("expected pass with wildcard, got %v", err)
	}
}

func TestCheckMint_EmptyAllowedClaimsRejectsAnyCustom(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{Name: "demo", Policy: Policy{TTLMax: time.Minute}})
	_, err := CheckMint("demo", "", time.Second, map[string]string{"x": "1"})
	if !errors.Is(err, ErrClaimNotAllowed) {
		t.Fatalf("expected ErrClaimNotAllowed when AllowedClaimKeys is empty, got %v", err)
	}
}

func TestEffectiveTTL_PassesThroughExplicit(t *testing.T) {
	ResetForTest()
	MustRegister(Scope{Name: "demo", Policy: Policy{TTLMax: time.Hour}})
	s := MustGet("demo")
	if got := EffectiveTTL(s, 5*time.Minute); got != 5*time.Minute {
		t.Errorf("got %v want %v", got, 5*time.Minute)
	}
}
