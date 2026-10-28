package application

import (
	identity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
)

func ownerError(err error, sc *scope) error {
	if err == nil {
		return nil
	}
	code := pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNSPECIFIED
	switch identity.CodeOf(err) {
	case identity.ErrorCodeStaleProfileVersion, identity.ErrorCodeFutureProfileVersion:
		code = pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_PROFILE_STALE
	case identity.ErrorCodeIdentityConflict:
		code = pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_IDENTITY_CONFLICT
	case identity.ErrorCodeDeviceConflict:
		code = pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_DEVICE_SESSION_CONFLICT
	case identity.ErrorCodeDeviceRevoked:
		code = pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED
	case identity.ErrorCodeInvalidProof, identity.ErrorCodeUnauthorized:
		code = pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED
	}
	if code == pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNSPECIFIED {
		return err
	}
	result := &link.Error{Code: code}
	if sc != nil && sc.offer != nil && code == pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_PROFILE_STALE {
		result.Status = &pb.DeviceLinkStatus{OfferId: sc.offer.ID, State: sc.offer.State,
			Revision: sc.offer.Revision, ExpiresAtUnixMs: sc.offer.ExpiresAt.UnixMilli(),
			CurrentProfileRevision: sc.identity.ProfileVersion, Reason: code}
	}
	return result
}
