package domain

import "testing"

func TestDeviceApprovalPolicy_RequiresApproval(t *testing.T) {
	tests := []struct {
		name     string
		policy   DeviceApprovalPolicy
		enrolled int
		want     bool
	}{
		{"default off never blocks", DeviceApprovalPolicy{Enabled: false}, 3, false},
		{"first device bypasses approval", DeviceApprovalPolicy{Enabled: true}, 0, false},
		{"negative count treated as none", DeviceApprovalPolicy{Enabled: true}, -1, false},
		{"existing devices require approval", DeviceApprovalPolicy{Enabled: true}, 2, true},
		{"at limit still routes through surface", DeviceApprovalPolicy{Enabled: true, MaxDevicesPerActor: 3}, 3, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.policy.RequiresApproval(tc.enrolled); got != tc.want {
				t.Fatalf("RequiresApproval(%d) = %v, want %v", tc.enrolled, got, tc.want)
			}
		})
	}
}

func TestDeviceApprovalPolicy_OverDeviceLimit(t *testing.T) {
	policy := DeviceApprovalPolicy{Enabled: true, MaxDevicesPerActor: 3}
	if policy.OverDeviceLimit(2) {
		t.Fatal("under limit must not report over-limit")
	}
	if !policy.OverDeviceLimit(3) {
		t.Fatal("at limit must report over-limit")
	}
	if (DeviceApprovalPolicy{Enabled: true}.OverDeviceLimit(99)) {
		t.Fatal("no configured ceiling means no limit")
	}
}
