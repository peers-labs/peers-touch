package application

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
)

// ResetDeploymentVerifier proves that the canonical Station deployment is live.
type ResetDeploymentVerifier interface {
	VerifyResetDeployment(
		context.Context,
		infrastructure.SecureContentResetManifestV1,
	) (infrastructure.ResetDeploymentProof, error)
}

// SecureContentResetOwner is the sole SC-D23/SC-D24 reset orchestrator.
type SecureContentResetOwner struct {
	store         *infrastructure.GORMSecureContentResetStore
	socialObjects infrastructure.ResetObjectOwner
	legacyObjects infrastructure.ResetObjectOwner
	deployment    ResetDeploymentVerifier
	clock         func() time.Time
}

// NewSecureContentResetOwner composes Social, OSS, and deployment owners.
func NewSecureContentResetOwner(
	store *infrastructure.GORMSecureContentResetStore,
	socialObjects infrastructure.ResetObjectOwner,
	legacyObjects infrastructure.ResetObjectOwner,
	deployment ResetDeploymentVerifier,
) (*SecureContentResetOwner, error) {
	if store == nil || socialObjects == nil || legacyObjects == nil {
		return nil, fmt.Errorf(
			"Secure Content reset requires store, Social objects, and OSS objects",
		)
	}

	return &SecureContentResetOwner{
		store:         store,
		socialObjects: socialObjects,
		legacyObjects: legacyObjects,
		deployment:    deployment,
		clock:         time.Now,
	}, nil
}

// Audit performs and persists the immutable pre-mutation reset manifest.
func (o *SecureContentResetOwner) Audit(
	ctx context.Context,
	request infrastructure.SecureContentResetAuditRequestV1,
	binding infrastructure.ResetInvocationBinding,
) (infrastructure.SecureContentResetManifestV1, error) {
	if err := infrastructure.ValidateAuditRequest(
		request,
		binding,
		o.clock().UTC(),
		nil,
	); err != nil {
		return infrastructure.SecureContentResetManifestV1{}, err
	}

	var prepared infrastructure.PreparedSecureContentReset
	err := o.store.WithAdvisoryLock(
		ctx,
		request.DeploymentEnvironment,
		request.DestructiveScope,
		func(locked *infrastructure.GORMSecureContentResetStore) error {
			existing, found, err := locked.FindManifest(
				ctx,
				request.ResetID,
			)
			if err != nil {
				return err
			}
			if found {
				if existing.ResetIntent != request.ResetIntent ||
					existing.SourceCommit != request.SourceCommit ||
					existing.WorkspaceID != request.WorkspaceID ||
					existing.ProfileID != request.ProfileID ||
					existing.DeploymentEnvironment !=
						request.DeploymentEnvironment ||
					existing.DestructiveScope != request.DestructiveScope {
					return &infrastructure.ResetError{
						Code: infrastructure.ResetCodeManifestConflict,
						Err: fmt.Errorf(
							"existing reset manifest does not match the audit request",
						),
					}
				}
				prepared.Manifest = existing

				return nil
			}
			prepared, err = locked.PrepareManifest(
				ctx,
				request.ScopeIdentity(),
				o.socialObjects,
				o.legacyObjects,
			)
			if err != nil {
				return err
			}
			if err := locked.SaveAuditedManifest(ctx, prepared); err != nil {
				return err
			}

			return nil
		},
	)
	if err != nil {
		return infrastructure.SecureContentResetManifestV1{}, err
	}

	return prepared.Manifest, nil
}

// Execute validates, journals, and advances one bounded reset invocation.
func (o *SecureContentResetOwner) Execute(
	ctx context.Context,
	invocation infrastructure.SecureContentResetInvocationV1,
	binding infrastructure.ResetInvocationBinding,
) (infrastructure.ResetExecutionResult, error) {
	if err := infrastructure.ValidateResetInvocation(
		invocation,
		binding,
		o.clock().UTC(),
		nil,
	); err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}

	var result infrastructure.ResetExecutionResult
	err := o.store.WithAdvisoryLock(
		ctx,
		invocation.DeploymentEnvironment,
		invocation.DestructiveScope,
		func(locked *infrastructure.GORMSecureContentResetStore) error {
			var err error
			result, err = o.executeLocked(ctx, locked, invocation)

			return err
		},
	)
	if err != nil {
		_ = o.store.RecordFailure(
			context.WithoutCancel(ctx),
			invocation.ResetID,
			infrastructure.ResetCodeOf(err),
			o.clock().UTC(),
		)

		return infrastructure.ResetExecutionResult{}, err
	}

	return result, nil
}

// VerifyCanonicalSchema revalidates one completed attestation against live
// deployment, schema, public-state, and object-owner truth without mutation.
func (o *SecureContentResetOwner) VerifyCanonicalSchema(
	ctx context.Context,
	supplied infrastructure.CanonicalPrivateSchemaAttestationV1,
	binding infrastructure.ResetInvocationBinding,
) (infrastructure.CanonicalPrivateSchemaAttestationV1, error) {
	if supplied.SourceCommit != binding.SourceCommit ||
		supplied.WorkspaceID != binding.WorkspaceID ||
		supplied.ProfileID != binding.ProfileID ||
		supplied.DeploymentEnvironment != binding.DeploymentEnvironment ||
		supplied.DestructiveScope != binding.DestructiveScope {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{},
			&infrastructure.ResetError{
				Code: infrastructure.ResetCodeManifestConflict,
				Err:  fmt.Errorf("schema attestation does not match the live binding"),
			}
	}

	var verified infrastructure.CanonicalPrivateSchemaAttestationV1
	err := o.store.WithAdvisoryLock(
		ctx,
		supplied.DeploymentEnvironment,
		supplied.DestructiveScope,
		func(locked *infrastructure.GORMSecureContentResetStore) error {
			manifest, journal, persisted, err :=
				locked.ResolveCompletedAttestation(ctx, supplied)
			if err != nil {
				return err
			}
			if o.deployment == nil {
				return &infrastructure.ResetError{
					Code: infrastructure.ResetCodePartialFailure,
					Err:  fmt.Errorf("Station deployment verification is required"),
				}
			}
			deployment, err := o.deployment.VerifyResetDeployment(ctx, manifest)
			if err != nil {
				return fmt.Errorf("verify live canonical Station deployment: %w", err)
			}
			if err := validateDeploymentProof(
				manifest,
				journal,
				deployment,
			); err != nil {
				return err
			}
			if deployment.StationServiceID != persisted.StationServiceID ||
				deployment.StationPeerID != persisted.StationPeerID ||
				deployment.StationRuntimeIdentity !=
					persisted.StationRuntimeIdentity ||
				!strings.EqualFold(
					deployment.ServiceAttestationDigest,
					persisted.ServiceAttestationDigest,
				) {
				return &infrastructure.ResetError{
					Code: infrastructure.ResetCodePartialFailure,
					Err: fmt.Errorf(
						"live Station deployment differs from the schema attestation",
					),
				}
			}
			if err := locked.ValidateCanonicalPrivateSchema(
				ctx,
				persisted.CanonicalSchemaDigest,
			); err != nil {
				return err
			}
			verified = persisted

			return nil
		},
	)
	if err != nil {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{}, err
	}

	return verified, nil
}

func (o *SecureContentResetOwner) executeLocked(
	ctx context.Context,
	store *infrastructure.GORMSecureContentResetStore,
	invocation infrastructure.SecureContentResetInvocationV1,
) (infrastructure.ResetExecutionResult, error) {
	manifest, err := store.Manifest(ctx, invocation.ResetID)
	if err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}
	if !strings.EqualFold(
		manifest.ManifestDigest,
		invocation.ResetManifestDigest,
	) {
		return infrastructure.ResetExecutionResult{}, &infrastructure.ResetError{
			Code: infrastructure.ResetCodeManifestConflict,
			Err:  fmt.Errorf("invocation references another reset manifest"),
		}
	}

	journal, found, err := store.LoadJournal(ctx, invocation.ResetID)
	if err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}
	var prepared *infrastructure.PreparedSecureContentReset
	if !found || journal.CurrentState == infrastructure.ResetStatePrepared {
		current, err := store.PrepareManifest(
			ctx,
			infrastructure.ResetScopeIdentity{
				SchemaVersion:         manifest.SchemaVersion,
				ResetID:               manifest.ResetID,
				ResetIntent:           manifest.ResetIntent,
				SourceCommit:          manifest.SourceCommit,
				WorkspaceID:           manifest.WorkspaceID,
				ProfileID:             manifest.ProfileID,
				DeploymentEnvironment: manifest.DeploymentEnvironment,
				DestructiveScope:      manifest.DestructiveScope,
				RecoveryPredecessor:   manifest.RecoveryPredecessor,
				CreatedAt:             manifest.CreatedAt,
			},
			o.socialObjects,
			o.legacyObjects,
		)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		if !strings.EqualFold(
			current.Manifest.ManifestDigest,
			manifest.ManifestDigest,
		) {
			return infrastructure.ResetExecutionResult{}, &infrastructure.ResetError{
				Code: infrastructure.ResetCodeManifestConflict,
				Err:  fmt.Errorf("live preflight no longer matches the audited manifest"),
			}
		}
		prepared = &current
	}
	if journal.CurrentState == infrastructure.ResetStateComplete {
		if err := store.ValidateTerminalInvocation(ctx, invocation); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		attestation, err := store.CompletedAttestation(
			ctx,
			invocation.ResetID,
		)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}

		return resetResult(journal, true, &attestation)
	}
	journal, exactReplay, err := store.AcceptInvocation(
		ctx,
		invocation,
		prepared,
		o.clock().UTC(),
	)
	if err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}
	if exactReplay {
		return resetResult(journal, exactReplay, nil)
	}

	startingState := journal.CurrentState
	if journal.CurrentState == infrastructure.ResetStatePrepared {
		if err := contextCause(ctx); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		if err := store.CommitDatabase(
			ctx,
			invocation.ResetID,
			o.clock().UTC(),
		); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		journal, _, err = store.LoadJournal(ctx, invocation.ResetID)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
	}
	if journal.CurrentState == infrastructure.ResetStateDatabaseSchemaCommitted {
		if err := o.deleteObjects(ctx, store, invocation.ResetID); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		if err := store.AdvanceJournal(
			ctx,
			invocation.ResetID,
			infrastructure.ResetStateDatabaseSchemaCommitted,
			infrastructure.ResetStateObjectsDeleted,
			o.clock().UTC(),
		); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		journal, _, err = store.LoadJournal(ctx, invocation.ResetID)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
	}
	if startingState != infrastructure.ResetStateObjectsDeleted &&
		journal.CurrentState == infrastructure.ResetStateObjectsDeleted {
		return resetResult(journal, false, nil)
	}

	var deployment infrastructure.ResetDeploymentProof
	if journal.CurrentState == infrastructure.ResetStateObjectsDeleted ||
		journal.CurrentState == infrastructure.ResetStateStationDeployed {
		if o.deployment == nil {
			return infrastructure.ResetExecutionResult{}, &infrastructure.ResetError{
				Code: infrastructure.ResetCodePartialFailure,
				Err:  fmt.Errorf("Station deployment verification is required"),
			}
		}
		deployment, err = o.deployment.VerifyResetDeployment(ctx, manifest)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, fmt.Errorf(
				"verify canonical Station deployment: %w",
				err,
			)
		}
		if err := validateDeploymentProof(
			manifest,
			journal,
			deployment,
		); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
	}
	if journal.CurrentState == infrastructure.ResetStateObjectsDeleted {
		if err := store.AdvanceJournal(
			ctx,
			invocation.ResetID,
			infrastructure.ResetStateObjectsDeleted,
			infrastructure.ResetStateStationDeployed,
			o.clock().UTC(),
		); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		journal.CurrentState = infrastructure.ResetStateStationDeployed
	}

	if journal.CurrentState == infrastructure.ResetStateStationDeployed {
		schemaDigest, err := store.PostAudit(
			ctx,
			manifest,
			o.socialObjects,
			o.legacyObjects,
		)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		if err := store.RecordPostAuditPassed(
			ctx,
			manifest,
			deployment,
			schemaDigest,
			o.clock().UTC(),
		); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		attestation, completed, err := store.Complete(
			ctx,
			manifest,
			o.clock().UTC(),
		)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}

		return resetResult(completed, false, &attestation)
	}

	if journal.CurrentState == infrastructure.ResetStatePostAuditPassed {
		if o.deployment == nil {
			return infrastructure.ResetExecutionResult{}, &infrastructure.ResetError{
				Code: infrastructure.ResetCodePartialFailure,
				Err:  fmt.Errorf("Station deployment verification is required"),
			}
		}
		deployment, err := o.deployment.VerifyResetDeployment(ctx, manifest)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, fmt.Errorf(
				"reverify canonical Station deployment: %w",
				err,
			)
		}
		if err := validateDeploymentProof(
			manifest,
			journal,
			deployment,
		); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		schemaDigest, err := store.PostAudit(
			ctx,
			manifest,
			o.socialObjects,
			o.legacyObjects,
		)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		if err := store.ValidatePostAuditEvidence(
			ctx,
			manifest,
			deployment,
			schemaDigest,
		); err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}
		attestation, completed, err := store.Complete(
			ctx,
			manifest,
			o.clock().UTC(),
		)
		if err != nil {
			return infrastructure.ResetExecutionResult{}, err
		}

		return resetResult(completed, false, &attestation)
	}

	return resetResult(journal, false, nil)
}

func (o *SecureContentResetOwner) deleteObjects(
	ctx context.Context,
	store *infrastructure.GORMSecureContentResetStore,
	resetID string,
) error {
	targets, err := store.PendingObjectTargets(ctx, resetID)
	if err != nil {
		return err
	}
	for _, target := range targets {
		if err := contextCause(ctx); err != nil {
			return err
		}
		owner, err := o.objectOwner(target.OwnerDomain)
		if err != nil {
			return err
		}
		if err := owner.DeleteResetObject(ctx, target); err != nil {
			return err
		}
		if err := store.MarkObjectDeleted(ctx, target, o.clock().UTC()); err != nil {
			return err
		}
	}

	return nil
}

func (o *SecureContentResetOwner) objectOwner(
	domain infrastructure.ResetObjectDomain,
) (infrastructure.ResetObjectOwner, error) {
	switch domain {
	case infrastructure.ResetObjectDomainSocial:
		return o.socialObjects, nil
	case infrastructure.ResetObjectDomainOSS:
		return o.legacyObjects, nil
	default:
		return nil, &infrastructure.ResetError{
			Code: infrastructure.ResetCodeObjectReferenceAmbiguous,
			Err:  fmt.Errorf("object owner %q is not allowlisted", domain),
		}
	}
}

func validateDeploymentProof(
	manifest infrastructure.SecureContentResetManifestV1,
	journal infrastructure.ResetJournalV1,
	proof infrastructure.ResetDeploymentProof,
) error {
	var objectsDeletedAt time.Time
	for _, transition := range journal.Transitions {
		if transition.ToState == infrastructure.ResetStateObjectsDeleted {
			objectsDeletedAt = transition.TransitionAt
			break
		}
	}
	if proof.SourceCommit != manifest.SourceCommit ||
		strings.TrimSpace(proof.StationServiceID) == "" ||
		strings.TrimSpace(proof.StationPeerID) == "" ||
		strings.TrimSpace(proof.StationRuntimeIdentity) == "" ||
		len(proof.ServiceAttestationDigest) != 64 ||
		objectsDeletedAt.IsZero() ||
		!proof.CapturedAt.After(objectsDeletedAt) {
		return &infrastructure.ResetError{
			Code: infrastructure.ResetCodePartialFailure,
			Err: fmt.Errorf(
				"Station deployment proof does not postdate object deletion",
			),
		}
	}

	return nil
}

func resetResult(
	journal infrastructure.ResetJournalV1,
	exactReplay bool,
	attestation *infrastructure.CanonicalPrivateSchemaAttestationV1,
) (infrastructure.ResetExecutionResult, error) {
	digest, err := journal.CalculatedDigest()
	if err != nil {
		return infrastructure.ResetExecutionResult{}, fmt.Errorf(
			"calculate reset journal digest: %w",
			err,
		)
	}

	return infrastructure.ResetExecutionResult{
		SchemaVersion:   infrastructure.SecureContentResetSchemaVersion,
		ResetID:         journal.ResetID,
		State:           journal.CurrentState,
		ExactReplay:     exactReplay,
		NeedsDeployment: journal.CurrentState == infrastructure.ResetStateObjectsDeleted,
		Journal:         journal,
		JournalDigest:   digest,
		Attestation:     attestation,
	}, nil
}

func contextCause(ctx context.Context) error {
	if err := context.Cause(ctx); err != nil {
		return &infrastructure.ResetError{
			Code: infrastructure.ResetCodePartialFailure,
			Err:  fmt.Errorf("reset invocation cancelled: %w", err),
		}
	}

	return nil
}
