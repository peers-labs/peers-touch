package http

import (
	"context"
	"errors"
	"fmt"
	nethttp "net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	// EnrollPath is the canonical actor-owned device enrollment route.
	EnrollPath = "/device/enroll"
	// ListPath is the canonical actor-owned device listing route.
	ListPath = "/device/list"
	// RevokePath is the canonical actor-owned device revocation route.
	RevokePath = "/device/revoke"
)

// AuthenticatedActor is the already-verified request identity supplied by transport.
type AuthenticatedActor struct {
	PTID     string
	DeviceID string
}

type deviceLifecycle interface {
	Enroll(context.Context, application.EnrollRequest) (domain.Device, error)
	List(context.Context, string) ([]domain.Device, error)
	Revoke(context.Context, application.RevokeRequest) (domain.Device, error)
}

// Handler maps canonical Actor protobuf contracts to Actor Identity use cases.
type Handler struct {
	service deviceLifecycle
}

// NewHandler constructs the route-independent Actor Identity HTTP adapter.
func NewHandler(service deviceLifecycle) (*Handler, error) {
	if service == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"actor_identity.new_http_handler",
			"service",
			"is required",
		)
	}

	return &Handler{service: service}, nil
}

// Enroll verifies and persists one canonical actor-device enrollment request.
func (h *Handler) Enroll(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *actormodel.EnrollActorDeviceRequest,
) (*actormodel.EnrollActorDeviceResponse, error) {
	mapped, err := MapEnrollRequest(authenticated, request)
	if err != nil {
		return nil, MapError(err)
	}

	device, err := h.service.Enroll(ctx, mapped)
	if err != nil {
		return nil, MapError(err)
	}

	return &actormodel.EnrollActorDeviceResponse{
		Device: MapDevice(device),
	}, nil
}

// List returns all canonical actor-device lifecycle records for the authenticated actor.
func (h *Handler) List(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *actormodel.ListActorDevicesRequest,
) (*actormodel.ListActorDevicesResponse, error) {
	if request == nil {
		return nil, MapError(domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"actor_identity.map_list_request",
			"request",
			"is required",
		))
	}

	devices, err := h.service.List(ctx, authenticated.PTID)
	if err != nil {
		return nil, MapError(err)
	}

	mapped := make([]*actormodel.ActorDevice, 0, len(devices))
	for _, device := range devices {
		mapped = append(mapped, MapDevice(device))
	}

	return &actormodel.ListActorDevicesResponse{Devices: mapped}, nil
}

// Revoke applies a profile-fenced terminal revocation to one actor-owned device.
func (h *Handler) Revoke(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *actormodel.RevokeActorDeviceRequest,
) (*actormodel.RevokeActorDeviceResponse, error) {
	if request == nil {
		return nil, MapError(domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"actor_identity.map_revoke_request",
			"request",
			"is required",
		))
	}

	device, err := h.service.Revoke(ctx, application.RevokeRequest{
		AuthenticatedPTID:      authenticated.PTID,
		DeviceID:               request.GetDeviceId(),
		ObservedProfileVersion: request.GetObservedProfileVersion(),
	})
	if err != nil {
		return nil, MapError(err)
	}

	return &actormodel.RevokeActorDeviceResponse{
		Device: MapDevice(device),
	}, nil
}

// MapEnrollRequest preserves the canonical protobuf bytes used by actor signatures.
func MapEnrollRequest(
	authenticated AuthenticatedActor,
	request *actormodel.EnrollActorDeviceRequest,
) (application.EnrollRequest, error) {
	const operation = "actor_identity.map_enroll_request"

	if request == nil || request.GetCertificate() == nil {
		return application.EnrollRequest{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"certificate",
			"is required",
		)
	}
	certificate := request.GetCertificate()
	if certificate.GetDevice() == nil || certificate.GetDevice().GetActor() == nil {
		return application.EnrollRequest{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"certificate.device.actor",
			"is required",
		)
	}

	canonicalBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(certificate)
	if err != nil {
		return application.EnrollRequest{}, domain.WrapError(
			domain.ErrorCodeInvalidArgument,
			operation,
			err,
		)
	}
	actor := certificate.GetDevice().GetActor()

	return application.EnrollRequest{
		AuthenticatedPTID:     authenticated.PTID,
		AuthenticatedDeviceID: authenticated.DeviceID,
		Enrollment: domain.Enrollment{
			FormatVersion:             certificate.GetFormatVersion(),
			PTID:                      actor.GetPtid(),
			ActorAccount:              actor.GetAcct(),
			ActorKind:                 int32(actor.GetKind()),
			DeviceID:                  certificate.GetDevice().GetDeviceId(),
			Label:                     request.GetLabel(),
			ActorIdentityPublicKey:    append([]byte(nil), certificate.GetActorIdentityPublicKey()...),
			ActorIdentityFingerprint:  append([]byte(nil), certificate.GetActorIdentityKeyFingerprint()...),
			DeviceSigningPublicKey:    append([]byte(nil), certificate.GetDeviceSigningPublicKey()...),
			SigningKeyID:              certificate.GetSigningKeyId(),
			ProfileVersion:            certificate.GetObservedProfileVersion(),
			CanonicalCertificateBytes: canonicalBytes,
			ActorCrossSignature:       append([]byte(nil), request.GetActorCrossSignature()...),
		},
	}, nil
}

// MapDevice converts one domain lifecycle record to the canonical Actor protobuf.
func MapDevice(device domain.Device) *actormodel.ActorDevice {
	mapped := &actormodel.ActorDevice{
		Ref: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: device.PTID,
				Acct: device.ActorAccount,
				Kind: actormodel.ActorKind(device.ActorKind),
			},
			DeviceId: device.DeviceID,
		},
		Status:                      mapDeviceStatus(device.Status),
		Label:                       device.Label,
		ActorIdentityKeyFingerprint: append([]byte(nil), device.ActorIdentityFingerprint...),
		SigningKeyId:                device.SigningKeyID,
		DeviceSigningPublicKey:      append([]byte(nil), device.DeviceSigningPublicKey...),
		ProfileVersion:              device.ProfileVersion,
		ActivationSequence:          device.ActivationSequence,
		EnrolledAt:                  timestamppb.New(device.EnrolledAt.UTC()),
	}
	if device.RevokedAt != nil {
		mapped.RevokedAt = timestamppb.New(device.RevokedAt.UTC())
	}

	return mapped
}

// MapError converts typed Actor Identity failures to Station HTTP failures.
func MapError(err error) error {
	if err == nil {
		return nil
	}

	var typed *domain.Error
	if !errors.As(err, &typed) {
		return server.InternalErrorWithCause("actor identity operation failed", err)
	}

	message := fmt.Sprintf("[%s] %s", typed.Code, publicErrorMessage(typed.Code))
	switch typed.Code {
	case domain.ErrorCodeInvalidArgument:
		return server.NewHandlerErrorWithCause(nethttp.StatusBadRequest, message, err)
	case domain.ErrorCodeUnauthorized:
		return server.NewHandlerErrorWithCause(nethttp.StatusUnauthorized, message, err)
	case domain.ErrorCodeInvalidProof:
		return server.NewHandlerErrorWithCause(nethttp.StatusForbidden, message, err)
	case domain.ErrorCodeDeviceNotFound:
		return server.NewHandlerErrorWithCause(nethttp.StatusNotFound, message, err)
	case domain.ErrorCodeIdentityConflict,
		domain.ErrorCodeDeviceConflict,
		domain.ErrorCodeStaleProfileVersion,
		domain.ErrorCodeFutureProfileVersion,
		domain.ErrorCodeDeviceRevoked:
		return server.NewHandlerErrorWithCause(nethttp.StatusConflict, message, err)
	default:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusInternalServerError,
			message,
			err,
		)
	}
}

func mapDeviceStatus(status domain.DeviceStatus) actormodel.ActorDeviceStatus {
	switch status {
	case domain.DeviceStatusActive:
		return actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_ACTIVE
	case domain.DeviceStatusRevoked:
		return actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_REVOKED
	default:
		return actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_UNSPECIFIED
	}
}

func publicErrorMessage(code domain.ErrorCode) string {
	switch code {
	case domain.ErrorCodeInvalidArgument:
		return "invalid actor identity request"
	case domain.ErrorCodeUnauthorized:
		return "actor identity authentication mismatch"
	case domain.ErrorCodeInvalidProof:
		return "actor device proof is invalid"
	case domain.ErrorCodeIdentityConflict:
		return "actor identity continuity conflict"
	case domain.ErrorCodeDeviceConflict:
		return "actor device conflict"
	case domain.ErrorCodeStaleProfileVersion:
		return "actor profile version is stale"
	case domain.ErrorCodeFutureProfileVersion:
		return "actor profile version is not established"
	case domain.ErrorCodeDeviceNotFound:
		return "actor device not found"
	case domain.ErrorCodeDeviceRevoked:
		return "actor device is revoked"
	default:
		return "actor identity operation failed"
	}
}
