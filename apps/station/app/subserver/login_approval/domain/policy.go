package domain

// DeviceApprovalPolicy is the default-off switch for the claimant-first
// device approval gate. The live Access gate chain consults RequiresApproval
// before emitting DEVICE_APPROVAL; with the switch off the authorization
// behaviour stays identical to the pre-feature flow.
type DeviceApprovalPolicy struct {
	// Enabled gates the whole feature per Station rollout.
	Enabled bool
	// MaxDevicesPerActor, when > 0, rejects additional enrollments once the
	// Actor reaches the explicit device limit instead of silently replacing.
	MaxDevicesPerActor int
}

// RequiresApproval decides whether a credential-passed login must wait for
// another enrolled device. The first device of an Actor can never require
// approval, otherwise a brand-new install would dead-lock with no approver.
func (p DeviceApprovalPolicy) RequiresApproval(enrolledDeviceCount int) bool {
	if !p.Enabled || enrolledDeviceCount <= 0 {
		return false
	}
	if p.MaxDevicesPerActor > 0 && enrolledDeviceCount >= p.MaxDevicesPerActor {
		// The limit is enforced separately as DEVICE_LIMIT; it still routes
		// through the approval surface so the caller gets a typed reason.
		return true
	}
	return true
}

// OverDeviceLimit reports the explicit enrollment ceiling independently of the
// approval requirement, keeping the implicit category-based kick path closed.
func (p DeviceApprovalPolicy) OverDeviceLimit(enrolledDeviceCount int) bool {
	return p.Enabled && p.MaxDevicesPerActor > 0 &&
		enrolledDeviceCount >= p.MaxDevicesPerActor
}
