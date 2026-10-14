package valueobject

import "testing"

// Service plaintext uses commitment code 8 to match the wire payload kind.
func TestDeliveryKindServicePlaintextCommitmentCode(t *testing.T) {
	code, err := DeliveryKindDirectServicePlaintext.CommitmentCode()
	if err != nil {
		t.Fatalf("direct_service_plaintext must be a supported delivery kind: %v", err)
	}
	if code != 8 {
		t.Fatalf("commitment code = %d, want 8", code)
	}

	if _, err := DeliveryKind("not_a_real_kind").CommitmentCode(); err == nil {
		t.Fatal("unknown delivery kind must error, not silently map")
	}
}
