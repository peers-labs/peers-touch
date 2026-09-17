package key_exchange

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type contentPreKeyValidationTransaction struct {
	db *gorm.DB
}

func (t contentPreKeyValidationTransaction) DB() *gorm.DB {
	return t.db
}

func (contentPreKeyValidationTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}

func TestContentPreKeyClaimValidationOperational(t *testing.T) {
	t.Run("exact request and original or replay response pass", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentEndpointPreKey("validate-exact-endpoint", 7),
		)
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentRecoveryPreKey("validate-exact-recovery", 1),
		)
		request := contentPreKeyClaimRequest(
			"validate-exact-plan",
			contentPreKeyEndpointTarget(),
			contentPreKeyRecoveryTarget(),
		)
		claimed, err := fixture.capability.ClaimContentPreKeys(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateContentPreKeyClaimsInTransaction(
			ctx,
			fixture,
			request,
			claimed,
		); err != nil {
			t.Fatalf("validate original claim response: %v", err)
		}
		if claimed.GetExactReplay() {
			t.Fatal("validation mutated the original response replay flag")
		}

		replayed, err := fixture.capability.ClaimContentPreKeys(
			ctx,
			proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
		)
		if err != nil {
			t.Fatalf("replay completed claim: %v", err)
		}
		if !replayed.GetExactReplay() {
			t.Fatal("completed claim replay did not report exact replay")
		}
		if err := validateContentPreKeyClaimsInTransaction(
			ctx,
			fixture,
			request,
			replayed,
		); err != nil {
			t.Fatalf("validate replay response: %v", err)
		}
		if !replayed.GetExactReplay() {
			t.Fatal("validation mutated the replay response flag")
		}
	})

	t.Run("endpoint revoke and profile drift reject validation", func(t *testing.T) {
		tests := []struct {
			name    string
			updates map[string]any
			code    domain.ErrorCode
		}{
			{
				name: "revoked",
				updates: map[string]any{
					"revoked":    true,
					"revoked_at": time.Unix(1_800_000_200, 0).UTC(),
				},
				code: domain.ErrorCodeUnauthorized,
			},
			{
				name: "profile advanced",
				updates: map[string]any{
					"profile_version": 8,
				},
				code: domain.ErrorCodeStaleMaterial,
			},
		}
		for _, testCase := range tests {
			t.Run(testCase.name, func(t *testing.T) {
				fixture := newContentPreKeyOperationalFixture(t)
				ctx := context.Background()
				fixture.publish(
					t,
					ctx,
					contentPreKeyEndpointRef(),
					contentPreKeyTestSigningKey,
					7,
					0,
					fixture.privateKey,
					contentEndpointPreKey(
						"validate-endpoint-"+testCase.name,
						7,
					),
				)
				request := contentPreKeyClaimRequest(
					"validate-endpoint-"+testCase.name+"-plan",
					contentPreKeyEndpointTarget(),
				)
				claimed, err := fixture.capability.ClaimContentPreKeys(
					ctx,
					request,
				)
				if err != nil {
					t.Fatal(err)
				}

				updateContentPreKeyPublisher(t, fixture.db, testCase.updates)
				err = validateContentPreKeyClaimsInTransaction(
					ctx,
					fixture,
					request,
					claimed,
				)
				assertContentPreKeyError(t, err, testCase.code)

				replayed, err := fixture.capability.ClaimContentPreKeys(
					ctx,
					proto.Clone(
						request,
					).(*securecontentpb.ClaimContentPreKeysRequest),
				)
				if err != nil {
					t.Fatalf("replay completed claim after drift: %v", err)
				}
				if !replayed.GetExactReplay() {
					t.Fatal("completed claim replay lost exact replay semantics")
				}
			})
		}
	})

	t.Run("recovery epoch advance rejects validation", func(t *testing.T) {
		fixture := newContentPreKeyOperationalFixture(t)
		ctx := context.Background()
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			0,
			fixture.privateKey,
			contentRecoveryPreKey("validate-recovery-epoch-1", 1),
		)
		request := contentPreKeyClaimRequest(
			"validate-recovery-epoch-plan",
			contentPreKeyRecoveryTarget(),
		)
		claimed, err := fixture.capability.ClaimContentPreKeys(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		fixture.publish(
			t,
			ctx,
			contentPreKeyEndpointRef(),
			contentPreKeyTestSigningKey,
			7,
			1,
			fixture.privateKey,
			contentRecoveryPreKey("validate-recovery-epoch-2", 2),
		)

		err = validateContentPreKeyClaimsInTransaction(
			ctx,
			fixture,
			request,
			claimed,
		)
		assertContentPreKeyError(t, err, domain.ErrorCodeStaleMaterial)
	})

	t.Run("request and response tamper reject validation", func(t *testing.T) {
		t.Run("request", func(t *testing.T) {
			fixture, request, claimed := claimedEndpointForValidation(t)
			tampered := proto.Clone(
				request,
			).(*securecontentpb.ClaimContentPreKeysRequest)
			tampered.PlanRequestSha256 = bytes.Repeat(
				[]byte{0x7f},
				sha256.Size,
			)

			err := validateContentPreKeyClaimsInTransaction(
				context.Background(),
				fixture,
				tampered,
				claimed,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeConflict)
		})

		t.Run("response", func(t *testing.T) {
			fixture, request, claimed := claimedEndpointForValidation(t)
			tampered := proto.Clone(
				claimed,
			).(*securecontentpb.ClaimContentPreKeysResponse)
			tampered.Claims[0].ClaimId += "-tampered"

			err := validateContentPreKeyClaimsInTransaction(
				context.Background(),
				fixture,
				request,
				tampered,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeInvalidMaterial)
		})

		t.Run("persisted receipt", func(t *testing.T) {
			fixture, request, claimed := claimedEndpointForValidation(t)
			if err := fixture.db.Model(
				&infrastructure.ContentPreKeyClaimReceiptModel{},
			).Where(
				"plan_id = ?",
				request.GetPlanId(),
			).Update(
				"response_sha256",
				bytes.Repeat([]byte{0x7f}, sha256.Size),
			).Error; err != nil {
				t.Fatal(err)
			}

			err := validateContentPreKeyClaimsInTransaction(
				context.Background(),
				fixture,
				request,
				claimed,
			)
			assertContentPreKeyError(t, err, domain.ErrorCodeInternal)
		})
	})
}

func claimedEndpointForValidation(
	t *testing.T,
) (
	*contentPreKeyOperationalFixture,
	*securecontentpb.ClaimContentPreKeysRequest,
	*securecontentpb.ClaimContentPreKeysResponse,
) {
	t.Helper()
	fixture := newContentPreKeyOperationalFixture(t)
	ctx := context.Background()
	fixture.publish(
		t,
		ctx,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("validate-tamper", 7),
	)
	request := contentPreKeyClaimRequest(
		"validate-tamper-plan",
		contentPreKeyEndpointTarget(),
	)
	claimed, err := fixture.capability.ClaimContentPreKeys(ctx, request)
	if err != nil {
		t.Fatal(err)
	}

	return fixture, request, claimed
}

func validateContentPreKeyClaimsInTransaction(
	ctx context.Context,
	fixture *contentPreKeyOperationalFixture,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
) error {
	return fixture.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fixture.capability.ValidateContentPreKeyClaims(
			ctx,
			contentPreKeyValidationTransaction{db: tx},
			request,
			response,
		)
	})
}
