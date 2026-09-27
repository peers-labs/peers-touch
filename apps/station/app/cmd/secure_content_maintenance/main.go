package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	appmeta "github.com/peers-labs/peers-touch/station/app/subserver/app_meta"
	ossservice "github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	socialapplication "github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

const (
	maintenanceOperationSession      = "session"
	maintenanceOperationSchemaVerify = "schema_verify"
	maximumMaintenanceInput          = 1 << 20

	maintenanceSessionAudit = "schema_audit"
	maintenanceSessionReset = "reset"
	serviceAttestationKind  = "service-deployment-attestation"
	stationServiceKind      = "station"
	cleanWorkspaceDigest    = "clean"

	workspaceIDEnvironment       = "PT_SECURE_CONTENT_WORKSPACE_ID"
	profileIDEnvironment         = "PT_SECURE_CONTENT_PROFILE_ID"
	deploymentEnvironment        = "PT_SECURE_CONTENT_DEPLOYMENT_ENVIRONMENT"
	destructiveScopeEnvironment  = "PT_SECURE_CONTENT_DESTRUCTIVE_SCOPE"
	declarationDigestEnvironment = "PT_SECURE_CONTENT_DECLARATION_DIGEST"

	postgresDSNEnvironment        = "PT_SECURE_CONTENT_POSTGRES_DSN"
	socialObjectRootEnvironment   = "PT_SECURE_CONTENT_SOCIAL_PRIVATE_OBJECT_ROOT"
	ossBackendEnvironment         = "PT_SECURE_CONTENT_OSS_BACKEND"
	ossLocalRootEnvironment       = "PT_SECURE_CONTENT_OSS_LOCAL_ROOT"
	serviceAttestationEnvironment = "PT_SECURE_CONTENT_SERVICE_ATTESTATION_FILE"
	stationQuiesceEnvironment     = "PT_SECURE_CONTENT_STATION_QUIESCE_COMMAND_JSON"
)

type resetRunner interface {
	Audit(
		context.Context,
		infrastructure.SecureContentResetAuditRequestV1,
		infrastructure.ResetInvocationBinding,
	) (infrastructure.SecureContentResetManifestV1, error)
	Execute(
		context.Context,
		infrastructure.SecureContentResetInvocationV1,
		infrastructure.ResetInvocationBinding,
	) (infrastructure.ResetExecutionResult, error)
	VerifyCanonicalSchema(
		context.Context,
		infrastructure.CanonicalPrivateSchemaAttestationV1,
		infrastructure.ResetInvocationBinding,
	) (infrastructure.CanonicalPrivateSchemaAttestationV1, error)
}

type commandDependencies struct {
	runner  resetRunner
	binding infrastructure.ResetInvocationBinding
	now     func() time.Time
}

type sessionState struct {
	request  infrastructure.SecureContentResetAuditRequestV1
	manifest infrastructure.SecureContentResetManifestV1
}

type productionConfig struct {
	PostgresDSN            string
	SocialObjectRoot       string
	OSSBackend             string
	OSSLocalRoot           string
	ServiceAttestationFile string
	StationQuiesceCommand  []string
}

type productionRunner struct {
	owner          *socialapplication.SecureContentResetOwner
	store          *infrastructure.GORMSecureContentResetStore
	quiesceCommand []string
	resetPrepared  bool
}

type serviceAttestationLiveMetadata struct {
	BuildCommit string `json:"buildCommit"`
	BuildTime   string `json:"buildTime"`
}

func (m *serviceAttestationLiveMetadata) UnmarshalJSON(data []byte) error {
	type wire serviceAttestationLiveMetadata
	if err := requireJSONFields(
		data,
		[]string{"buildCommit", "buildTime"},
		nil,
	); err != nil {
		return err
	}

	return json.Unmarshal(data, (*wire)(m))
}

type serviceDeploymentAttestation struct {
	ArtifactKind          string                         `json:"artifactKind"`
	CapturedAt            time.Time                      `json:"capturedAt"`
	ServiceID             string                         `json:"serviceId"`
	ServiceKind           string                         `json:"serviceKind"`
	EnvironmentID         string                         `json:"environmentId"`
	DeploymentEnvironment string                         `json:"deploymentEnvironment"`
	Endpoint              string                         `json:"endpoint"`
	Commit                string                         `json:"commit"`
	WorkspaceDigest       string                         `json:"workspaceDigest"`
	ProtocolDigest        string                         `json:"protocolDigest"`
	Producer              string                         `json:"producer"`
	LiveMetadata          serviceAttestationLiveMetadata `json:"liveMetadata"`
	RuntimeIdentity       string                         `json:"runtimeIdentity"`
	RunID                 string                         `json:"runId,omitempty"`
	GateID                string                         `json:"gateId,omitempty"`
}

func (a *serviceDeploymentAttestation) UnmarshalJSON(data []byte) error {
	type wire serviceDeploymentAttestation
	if err := requireJSONFields(
		data,
		[]string{
			"artifactKind",
			"capturedAt",
			"serviceId",
			"serviceKind",
			"environmentId",
			"deploymentEnvironment",
			"endpoint",
			"commit",
			"workspaceDigest",
			"protocolDigest",
			"producer",
			"liveMetadata",
			"runtimeIdentity",
		},
		[]string{"runId", "gateId"},
	); err != nil {
		return err
	}

	return json.Unmarshal(data, (*wire)(a))
}

type fileDeploymentVerifier struct {
	path   string
	client *http.Client
}

func main() {
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGHUP,
		syscall.SIGTERM,
	)
	defer stop()
	binding, err := bindingFromEnvironment()
	if err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	runner, err := productionResetRunner(ctx)
	if err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	if err := run(
		ctx,
		os.Args[1:],
		os.Stdin,
		os.Stdout,
		commandDependencies{
			runner:  runner,
			binding: binding,
			now:     time.Now,
		},
	); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}

func run(
	ctx context.Context,
	arguments []string,
	input io.Reader,
	output io.Writer,
	dependencies commandDependencies,
) error {
	if dependencies.runner == nil {
		return errors.New("Secure Content maintenance runner is unavailable")
	}
	if dependencies.now == nil {
		dependencies.now = time.Now
	}

	flags := flag.NewFlagSet("secure_content_maintenance", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	operation := flags.String("operation", "", "allowlisted maintenance operation")
	if err := flags.Parse(arguments); err != nil {
		return fmt.Errorf("parse Secure Content maintenance command: %w", err)
	}
	if flags.NArg() != 0 {
		return errors.New("Secure Content maintenance command rejects positional arguments")
	}
	switch *operation {
	case maintenanceOperationSession:
		if !isSHA256(dependencies.binding.DeclarationDigest) {
			return errors.New(
				"Secure Content reset session requires a declaration digest",
			)
		}
		return runSession(ctx, input, output, dependencies)
	case maintenanceOperationSchemaVerify:
		if dependencies.binding.DeclarationDigest != "" {
			return errors.New(
				"Secure Content schema verification cannot inherit reset authority",
			)
		}
		return runSchemaVerification(ctx, input, output, dependencies)
	default:
		return fmt.Errorf(
			"Secure Content maintenance operation %q is not allowlisted",
			*operation,
		)
	}
}

func runSchemaVerification(
	ctx context.Context,
	input io.Reader,
	output io.Writer,
	dependencies commandDependencies,
) error {
	raw, err := io.ReadAll(io.LimitReader(input, maximumMaintenanceInput+1))
	if err != nil {
		return fmt.Errorf("read Secure Content schema verification: %w", err)
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return errors.New("Secure Content schema verification input is required")
	}
	if len(raw) > maximumMaintenanceInput {
		return errors.New("Secure Content schema verification input exceeds the size limit")
	}
	verified, err := verifyCanonicalSchemaSession(ctx, raw, dependencies)
	if err != nil {
		return err
	}
	return encodeOutput(output, verified)
}

func runSession(
	ctx context.Context,
	input io.Reader,
	output io.Writer,
	dependencies commandDependencies,
) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 64*1024), maximumMaintenanceInput+1)

	var state *sessionState
	invocationCount := 0
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		raw := append([]byte(nil), scanner.Bytes()...)
		if len(bytes.TrimSpace(raw)) == 0 {
			return fmt.Errorf(
				"Secure Content maintenance session line %d is empty",
				lineNumber,
			)
		}
		if len(raw) > maximumMaintenanceInput {
			return fmt.Errorf(
				"Secure Content maintenance session line %d exceeds the size limit",
				lineNumber,
			)
		}

		action, payload, err := decodeSessionEnvelope(raw)
		if err != nil {
			return fmt.Errorf(
				"decode Secure Content maintenance session line %d: %w",
				lineNumber,
				err,
			)
		}
		switch {
		case state == nil:
			if action != maintenanceSessionAudit {
				return errors.New(
					"Secure Content maintenance session requires schema_audit first",
				)
			}
			prepared, response, err := prepareSession(ctx, payload, dependencies)
			if err != nil {
				return err
			}
			if err := encodeOutput(output, response); err != nil {
				return err
			}
			state = &prepared
		default:
			if action != maintenanceSessionReset {
				return errors.New(
					"Secure Content maintenance session accepts only reset after schema_audit",
				)
			}
			response, err := invokeSession(ctx, payload, *state, dependencies)
			if err != nil {
				return err
			}
			if err := encodeOutput(output, response); err != nil {
				return err
			}
			invocationCount++
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read Secure Content maintenance session: %w", err)
	}
	if state == nil {
		return errors.New("Secure Content maintenance session input is required")
	}
	if invocationCount == 0 {
		return errors.New(
			"Secure Content maintenance session ended before reset",
		)
	}

	return nil
}

func prepareSession(
	ctx context.Context,
	raw json.RawMessage,
	dependencies commandDependencies,
) (sessionState, infrastructure.SecureContentResetManifestV1, error) {
	var request infrastructure.SecureContentResetAuditRequestV1
	if err := decodeStrictInput(raw, &request); err != nil {
		return sessionState{}, infrastructure.SecureContentResetManifestV1{}, err
	}
	if err := infrastructure.ValidateAuditRequest(
		request,
		dependencies.binding,
		dependencies.now().UTC(),
		[]byte(raw),
	); err != nil {
		return sessionState{}, infrastructure.SecureContentResetManifestV1{}, err
	}

	manifest, err := dependencies.runner.Audit(
		ctx,
		request,
		dependencies.binding,
	)
	if err != nil {
		return sessionState{}, infrastructure.SecureContentResetManifestV1{}, err
	}
	if err := validatePreparedManifest(request, manifest); err != nil {
		return sessionState{}, infrastructure.SecureContentResetManifestV1{}, err
	}

	return sessionState{
		request:  request,
		manifest: manifest,
	}, manifest, nil
}

func invokeSession(
	ctx context.Context,
	raw json.RawMessage,
	state sessionState,
	dependencies commandDependencies,
) (infrastructure.ResetExecutionResult, error) {
	var invocation infrastructure.SecureContentResetInvocationV1
	if err := decodeStrictInput(raw, &invocation); err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}
	if err := validateInvocationForSession(
		invocation,
		state,
		dependencies.now().UTC(),
		[]byte(raw),
	); err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}

	result, err := dependencies.runner.Execute(
		ctx,
		invocation,
		dependencies.binding,
	)
	if err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}
	if err := validateExecutionResult(
		invocation,
		state.manifest,
		result,
	); err != nil {
		return infrastructure.ResetExecutionResult{}, err
	}

	return result, nil
}

func verifyCanonicalSchemaSession(
	ctx context.Context,
	raw json.RawMessage,
	dependencies commandDependencies,
) (infrastructure.CanonicalPrivateSchemaAttestationV1, error) {
	if err := requireJSONFields(
		raw,
		[]string{
			"schema_version",
			"source_commit",
			"workspace_id",
			"profile_id",
			"deployment_environment",
			"destructive_scope",
			"station_service_id",
			"station_peer_id",
			"station_runtime_identity",
			"service_attestation_digest",
			"reset_intent",
			"reset_manifest_digest",
			"completed_journal_digest",
			"canonical_private_schema_digest",
			"retired_columns_absent",
			"public_snapshot_digest",
			"created_at",
			"attestation_digest",
		},
		nil,
	); err != nil {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{}, err
	}
	var supplied infrastructure.CanonicalPrivateSchemaAttestationV1
	if err := decodeStrictInput(raw, &supplied); err != nil {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{}, err
	}
	if supplied.SchemaVersion != infrastructure.SecureContentResetSchemaVersion ||
		supplied.SourceCommit != dependencies.binding.SourceCommit ||
		supplied.WorkspaceID != dependencies.binding.WorkspaceID ||
		supplied.ProfileID != dependencies.binding.ProfileID ||
		supplied.DeploymentEnvironment !=
			dependencies.binding.DeploymentEnvironment ||
		supplied.DestructiveScope != dependencies.binding.DestructiveScope {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{},
			errors.New(
				"Secure Content schema verification does not match the live binding",
			)
	}
	digest, err := supplied.CalculatedDigest()
	if err != nil {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{},
			fmt.Errorf("calculate supplied schema attestation digest: %w", err)
	}
	if !strings.EqualFold(digest, supplied.AttestationDigest) {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{},
			errors.New(
				"supplied schema attestation digest does not match its content",
			)
	}
	verified, err := dependencies.runner.VerifyCanonicalSchema(
		ctx,
		supplied,
		dependencies.binding,
	)
	if err != nil {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{}, err
	}
	if verified != supplied {
		return infrastructure.CanonicalPrivateSchemaAttestationV1{},
			errors.New(
				"live schema verification changed the sealed attestation",
			)
	}

	return verified, nil
}

func decodeSessionEnvelope(
	raw []byte,
) (string, json.RawMessage, error) {
	fields, err := decodeJSONObject(raw)
	if err != nil {
		return "", nil, err
	}
	actionRaw, ok := fields["operation"]
	if !ok {
		return "", nil, errors.New("session envelope is missing field \"operation\"")
	}
	var action string
	if err := decodeStrictInput(actionRaw, &action); err != nil {
		return "", nil, errors.New("session envelope operation must be a string")
	}

	switch action {
	case maintenanceSessionAudit, maintenanceSessionReset:
	default:
		return "", nil, fmt.Errorf(
			"session envelope operation %q is not allowlisted",
			action,
		)
	}
	if len(fields) != 2 {
		return "", nil, fmt.Errorf(
			"session envelope for %s must contain exactly operation and payload",
			action,
		)
	}
	payload, ok := fields["payload"]
	if !ok {
		return "", nil, fmt.Errorf(
			"session envelope for %s is missing field \"payload\"",
			action,
		)
	}

	return action, payload, nil
}

func validatePreparedManifest(
	request infrastructure.SecureContentResetAuditRequestV1,
	manifest infrastructure.SecureContentResetManifestV1,
) error {
	if manifest.SchemaVersion != infrastructure.SecureContentResetSchemaVersion ||
		manifest.ResetID != request.ResetID ||
		manifest.ResetIntent != request.ResetIntent ||
		manifest.SourceCommit != request.SourceCommit ||
		manifest.WorkspaceID != request.WorkspaceID ||
		manifest.ProfileID != request.ProfileID ||
		manifest.DeploymentEnvironment != request.DeploymentEnvironment ||
		manifest.DestructiveScope != request.DestructiveScope {
		return errors.New(
			"Secure Content maintenance manifest does not match PREPARE",
		)
	}
	calculated, err := manifest.CalculatedDigest()
	if err != nil {
		return fmt.Errorf("calculate Secure Content reset manifest digest: %w", err)
	}
	if !strings.EqualFold(calculated, manifest.ManifestDigest) {
		return errors.New(
			"Secure Content maintenance manifest digest does not match its content",
		)
	}

	return nil
}

func validateInvocationForSession(
	invocation infrastructure.SecureContentResetInvocationV1,
	state sessionState,
	now time.Time,
	rawInvocation []byte,
) error {
	request := state.request
	manifest := state.manifest
	if err := infrastructure.ValidateResetInvocation(
		invocation,
		infrastructure.ResetInvocationBinding{
			SourceCommit:          request.SourceCommit,
			WorkspaceID:           request.WorkspaceID,
			ProfileID:             request.ProfileID,
			DeploymentEnvironment: request.DeploymentEnvironment,
			DestructiveScope:      request.DestructiveScope,
			DeclarationDigest:     request.DeclarationDigest,
		},
		now,
		rawInvocation,
	); err != nil {
		return err
	}
	if invocation.ResetID != request.ResetID ||
		invocation.ResetIntent != request.ResetIntent ||
		invocation.ResetManifestDigest != manifest.ManifestDigest ||
		invocation.PlanID != request.PlanID ||
		invocation.TaskID != request.TaskID ||
		invocation.DeclarationDigest != request.DeclarationDigest ||
		invocation.SourceCommit != request.SourceCommit ||
		invocation.WorkspaceID != request.WorkspaceID ||
		invocation.ProfileID != request.ProfileID ||
		invocation.DeploymentEnvironment != request.DeploymentEnvironment ||
		invocation.DestructiveScope != request.DestructiveScope {
		return errors.New(
			"Secure Content maintenance INVOKE does not match PREPARE",
		)
	}

	return nil
}

func validateExecutionResult(
	invocation infrastructure.SecureContentResetInvocationV1,
	manifest infrastructure.SecureContentResetManifestV1,
	result infrastructure.ResetExecutionResult,
) error {
	journal := result.Journal
	if result.SchemaVersion != infrastructure.SecureContentResetSchemaVersion ||
		result.ResetID != invocation.ResetID ||
		result.State != journal.CurrentState ||
		journal.SchemaVersion != infrastructure.SecureContentResetSchemaVersion ||
		journal.ResetID != invocation.ResetID ||
		journal.ResetManifestDigest != invocation.ResetManifestDigest ||
		journal.AcceptedInvocations == nil ||
		journal.Transitions == nil {
		return errors.New(
			"Secure Content maintenance runner returned an invalid journal result",
		)
	}
	accepted := false
	for _, candidate := range journal.AcceptedInvocations {
		if candidate.InvocationID == invocation.InvocationID &&
			candidate.InvocationDigest == invocation.InvocationDigest {
			accepted = true
			break
		}
	}
	if !accepted &&
		(result.State != infrastructure.ResetStateComplete || !result.ExactReplay) {
		return errors.New(
			"Secure Content maintenance journal omitted the current invocation",
		)
	}
	switch result.State {
	case infrastructure.ResetStateObjectsDeleted:
		if !result.NeedsDeployment || result.Attestation != nil {
			return errors.New(
				"OBJECTS_DELETED result must require deployment without attestation",
			)
		}
	case infrastructure.ResetStateComplete:
		if result.NeedsDeployment || result.Attestation == nil {
			return errors.New(
				"COMPLETE result must include attestation without deployment",
			)
		}
	case infrastructure.ResetStateSuperseded:
		if !result.ExactReplay ||
			result.NeedsDeployment ||
			result.Attestation != nil ||
			journal.Failure == nil ||
			journal.Failure.Code != infrastructure.ResetCodeSourceSuperseded ||
			len(journal.Transitions) != 1 ||
			journal.Transitions[0].FromState != infrastructure.ResetStatePrepared ||
			journal.Transitions[0].ToState != infrastructure.ResetStateSuperseded {
			return errors.New(
				"SUPERSEDED result must be an exact terminal replay",
			)
		}
	case infrastructure.ResetStateRecoveryReplaced:
		if !result.ExactReplay ||
			result.NeedsDeployment ||
			result.Attestation != nil ||
			len(journal.Transitions) == 0 {
			return errors.New(
				"RECOVERY_REPLACED result must be an exact terminal replay",
			)
		}
		lastTransition := journal.Transitions[len(journal.Transitions)-1]
		validRecovery := journal.Failure != nil &&
			lastTransition.ToState ==
				infrastructure.ResetStateRecoveryReplaced &&
			((lastTransition.FromState ==
				infrastructure.ResetStateObjectsDeleted &&
				journal.Failure.Code ==
					infrastructure.ResetCodeSourceSuperseded) ||
				(lastTransition.FromState ==
					infrastructure.ResetStateStationDeployed &&
					journal.Failure.Code ==
						infrastructure.ResetCodeSchemaTargetUnreviewed))
		if !validRecovery {
			return errors.New(
				"RECOVERY_REPLACED result has an invalid predecessor boundary",
			)
		}
	default:
		return errors.New(
			"Secure Content maintenance result is not externally actionable",
		)
	}
	calculated, err := journal.CalculatedDigest()
	if err != nil {
		return fmt.Errorf("calculate Secure Content reset journal digest: %w", err)
	}
	if !strings.EqualFold(calculated, result.JournalDigest) {
		return errors.New(
			"Secure Content maintenance runner returned a mismatched journal digest",
		)
	}
	if result.Attestation != nil {
		attestation := result.Attestation
		var attestationFailures []string
		if attestation.SchemaVersion != infrastructure.SecureContentResetSchemaVersion {
			attestationFailures = append(attestationFailures, fmt.Sprintf("schema_version: got %d, want %d", attestation.SchemaVersion, infrastructure.SecureContentResetSchemaVersion))
		}
		if attestation.ResetManifestDigest != invocation.ResetManifestDigest {
			attestationFailures = append(attestationFailures, fmt.Sprintf("reset_manifest_digest: got %q, want %q", attestation.ResetManifestDigest, invocation.ResetManifestDigest))
		}
		if attestation.ResetIntent != invocation.ResetIntent {
			attestationFailures = append(attestationFailures, fmt.Sprintf("reset_intent: got %q, want %q", attestation.ResetIntent, invocation.ResetIntent))
		}
		if attestation.SourceCommit != invocation.SourceCommit {
			attestationFailures = append(attestationFailures, fmt.Sprintf("source_commit: got %q, want %q", attestation.SourceCommit, invocation.SourceCommit))
		}
		if attestation.WorkspaceID != invocation.WorkspaceID {
			attestationFailures = append(attestationFailures, "workspace_id mismatch")
		}
		if attestation.ProfileID != invocation.ProfileID {
			attestationFailures = append(attestationFailures, "profile_id mismatch")
		}
		if attestation.DeploymentEnvironment != invocation.DeploymentEnvironment {
			attestationFailures = append(attestationFailures, "deployment_environment mismatch")
		}
		if attestation.DestructiveScope != invocation.DestructiveScope {
			attestationFailures = append(attestationFailures, "destructive_scope mismatch")
		}
		if attestation.CompletedJournalDigest != result.JournalDigest {
			attestationFailures = append(attestationFailures, fmt.Sprintf("completed_journal_digest: got %q, want %q", attestation.CompletedJournalDigest, result.JournalDigest))
		}
		if attestation.PublicSnapshotDigest != manifest.PublicSnapshotBefore.SnapshotDigest {
			attestationFailures = append(attestationFailures, "public_snapshot_digest mismatch")
		}
		if !attestation.RetiredColumnsAbsent {
			attestationFailures = append(attestationFailures, "retired_columns_absent is false")
		}
		if !isSHA256(attestation.CanonicalSchemaDigest) {
			attestationFailures = append(attestationFailures, fmt.Sprintf("canonical_schema_digest invalid: %q", attestation.CanonicalSchemaDigest))
		}
		if !validNonempty(attestation.StationServiceID) {
			attestationFailures = append(attestationFailures, fmt.Sprintf("station_service_id invalid: %q", attestation.StationServiceID))
		}
		if !validNonempty(attestation.StationPeerID) {
			attestationFailures = append(attestationFailures, fmt.Sprintf("station_peer_id invalid: %q", attestation.StationPeerID))
		}
		if !validNonempty(attestation.StationRuntimeIdentity) {
			attestationFailures = append(attestationFailures, fmt.Sprintf("station_runtime_identity invalid: %q", attestation.StationRuntimeIdentity))
		}
		if !isSHA256(attestation.ServiceAttestationDigest) {
			attestationFailures = append(attestationFailures, fmt.Sprintf("service_attestation_digest invalid: %q", attestation.ServiceAttestationDigest))
		}
		if len(attestationFailures) > 0 {
			return fmt.Errorf(
				"Secure Content maintenance runner returned an invalid schema attestation: %s",
				strings.Join(attestationFailures, "; "),
			)
		}
		digest, err := attestation.CalculatedDigest()
		if err != nil {
			return fmt.Errorf(
				"calculate canonical private schema attestation digest: %w",
				err,
			)
		}
		if !strings.EqualFold(digest, attestation.AttestationDigest) {
			return errors.New(
				"Secure Content maintenance schema attestation digest does not match its content",
			)
		}
	}

	return nil
}

func decodeStrictInput(raw []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("decode Secure Content maintenance input: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New(
				"Secure Content maintenance input contains multiple JSON values",
			)
		}

		return fmt.Errorf("decode trailing Secure Content maintenance input: %w", err)
	}

	return nil
}

func decodeJSONObject(raw []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	if delimiter, ok := token.(json.Delim); !ok || delimiter != '{' {
		return nil, errors.New("session envelope must be a JSON object")
	}
	fields := make(map[string]json.RawMessage)
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return nil, err
		}
		field, ok := token.(string)
		if !ok {
			return nil, errors.New("session envelope field is not a string")
		}
		if _, exists := fields[field]; exists {
			return nil, fmt.Errorf("session envelope repeats field %q", field)
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		fields[field] = value
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("session envelope contains multiple JSON values")
		}

		return nil, err
	}

	return fields, nil
}

func requireJSONFields(
	raw []byte,
	required []string,
	optional []string,
) error {
	fields, err := decodeJSONObject(raw)
	if err != nil {
		return err
	}
	allowed := make(map[string]struct{}, len(required)+len(optional))
	for _, field := range required {
		allowed[field] = struct{}{}
		if _, ok := fields[field]; !ok {
			return fmt.Errorf("JSON object is missing field %q", field)
		}
	}
	for _, field := range optional {
		allowed[field] = struct{}{}
	}
	for field := range fields {
		if _, ok := allowed[field]; !ok {
			return fmt.Errorf("JSON object contains unknown field %q", field)
		}
	}

	return nil
}

func encodeOutput(output io.Writer, value any) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return fmt.Errorf("encode Secure Content maintenance output: %w", err)
	}

	return nil
}

func bindingFromEnvironment() (infrastructure.ResetInvocationBinding, error) {
	binding := infrastructure.ResetInvocationBinding{
		SourceCommit:          strings.TrimSpace(appmeta.BuildCommit),
		WorkspaceID:           strings.TrimSpace(os.Getenv(workspaceIDEnvironment)),
		ProfileID:             strings.TrimSpace(os.Getenv(profileIDEnvironment)),
		DeploymentEnvironment: strings.TrimSpace(os.Getenv(deploymentEnvironment)),
		DestructiveScope:      strings.TrimSpace(os.Getenv(destructiveScopeEnvironment)),
		DeclarationDigest:     strings.TrimSpace(os.Getenv(declarationDigestEnvironment)),
	}
	if !isGitCommit(binding.SourceCommit) {
		return infrastructure.ResetInvocationBinding{}, errors.New(
			"Secure Content maintenance binary has no compiled source commit",
		)
	}
	if binding.WorkspaceID == "" ||
		binding.ProfileID == "" ||
		binding.DeploymentEnvironment == "" ||
		binding.DestructiveScope == "" ||
		(binding.DeclarationDigest != "" &&
			!isSHA256(binding.DeclarationDigest)) {
		return infrastructure.ResetInvocationBinding{}, errors.New(
			"Secure Content maintenance process binding is incomplete",
		)
	}

	return binding, nil
}

func productionConfigFromEnvironment(
	getenv func(string) string,
) (productionConfig, error) {
	if getenv == nil {
		return productionConfig{}, errors.New(
			"Secure Content maintenance environment reader is unavailable",
		)
	}
	required := func(key string) (string, error) {
		value := strings.TrimSpace(getenv(key))
		if value == "" {
			return "", fmt.Errorf(
				"required Secure Content maintenance environment %s is missing",
				key,
			)
		}

		return value, nil
	}

	dsn, err := required(postgresDSNEnvironment)
	if err != nil {
		return productionConfig{}, err
	}
	socialRoot, err := required(socialObjectRootEnvironment)
	if err != nil {
		return productionConfig{}, err
	}
	ossBackend, err := required(ossBackendEnvironment)
	if err != nil {
		return productionConfig{}, err
	}
	ossRoot, err := required(ossLocalRootEnvironment)
	if err != nil {
		return productionConfig{}, err
	}
	attestationFile, err := required(serviceAttestationEnvironment)
	if err != nil {
		return productionConfig{}, err
	}
	quiesceCommandJSON, err := required(stationQuiesceEnvironment)
	if err != nil {
		return productionConfig{}, err
	}
	var quiesceCommand []string
	if err := json.Unmarshal(
		[]byte(quiesceCommandJSON),
		&quiesceCommand,
	); err != nil ||
		len(quiesceCommand) == 0 {
		return productionConfig{}, fmt.Errorf(
			"%s must be a non-empty JSON string array",
			stationQuiesceEnvironment,
		)
	}
	for _, argument := range quiesceCommand {
		if !validNonempty(argument) {
			return productionConfig{}, fmt.Errorf(
				"%s contains an invalid argument",
				stationQuiesceEnvironment,
			)
		}
	}

	socialRoot, err = validateAbsolutePath(
		socialObjectRootEnvironment,
		socialRoot,
	)
	if err != nil {
		return productionConfig{}, err
	}
	ossRoot, err = validateAbsolutePath(ossLocalRootEnvironment, ossRoot)
	if err != nil {
		return productionConfig{}, err
	}
	attestationFile, err = validateAbsolutePath(
		serviceAttestationEnvironment,
		attestationFile,
	)
	if err != nil {
		return productionConfig{}, err
	}
	ossBackend = strings.ToLower(ossBackend)
	if ossBackend != string(storage.DriverLocal) {
		return productionConfig{}, fmt.Errorf(
			"%s must explicitly select the local backend",
			ossBackendEnvironment,
		)
	}
	if socialRoot == ossRoot {
		return productionConfig{}, errors.New(
			"Social private and OSS local object roots must be distinct",
		)
	}

	return productionConfig{
		PostgresDSN:            dsn,
		SocialObjectRoot:       socialRoot,
		OSSBackend:             ossBackend,
		OSSLocalRoot:           ossRoot,
		ServiceAttestationFile: attestationFile,
		StationQuiesceCommand:  quiesceCommand,
	}, nil
}

func validateAbsolutePath(key string, value string) (string, error) {
	cleaned := filepath.Clean(value)
	if !filepath.IsAbs(cleaned) || cleaned == string(filepath.Separator) {
		return "", fmt.Errorf(
			"%s must be an explicit absolute non-root path",
			key,
		)
	}

	return cleaned, nil
}

func productionResetRunner(ctx context.Context) (resetRunner, error) {
	config, err := productionConfigFromEnvironment(os.Getenv)
	if err != nil {
		return nil, err
	}
	verifier := &fileDeploymentVerifier{path: config.ServiceAttestationFile}
	if _, err := verifier.read(); err != nil {
		return nil, err
	}

	database, err := gorm.Open(postgres.Open(config.PostgresDSN), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
		NamingStrategy: schema.NamingStrategy{
			NameReplacer: strings.NewReplacer(
				"SPKID", "SpkId",
				"OPKID", "OpkId",
				"ULID", "Ulid",
				"PTID", "Ptid",
				"MIME", "Mime",
				"DID", "Did",
				"CID", "Cid",
				"URL", "Url",
			),
		},
	})
	if err != nil {
		return nil, fmt.Errorf(
			"open Secure Content maintenance PostgreSQL database: %w",
			err,
		)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		return nil, fmt.Errorf(
			"resolve Secure Content maintenance PostgreSQL connection: %w",
			err,
		)
	}
	if err := sqlDatabase.PingContext(ctx); err != nil {
		return nil, fmt.Errorf(
			"ping Secure Content maintenance PostgreSQL database: %w",
			err,
		)
	}

	store, err := infrastructure.NewGORMSecureContentResetStore(database)
	if err != nil {
		return nil, err
	}
	socialBackend, err := storage.New(storage.Config{
		Driver: storage.DriverLocal,
		Local:  &storage.LocalConfig{Root: config.SocialObjectRoot},
	})
	if err != nil {
		return nil, fmt.Errorf(
			"construct Social private local object backend: %w",
			err,
		)
	}
	if err := socialBackend.Healthz(ctx); err != nil {
		return nil, fmt.Errorf(
			"verify Social private local object root: %w",
			err,
		)
	}
	socialObjects, err := infrastructure.NewSocialPrivateObjectResetOwner(
		socialBackend,
	)
	if err != nil {
		return nil, err
	}

	ossBackend, err := storage.New(storage.Config{
		Driver: storage.Driver(config.OSSBackend),
		Local:  &storage.LocalConfig{Root: config.OSSLocalRoot},
	})
	if err != nil {
		return nil, fmt.Errorf("construct OSS local backend: %w", err)
	}
	if err := ossBackend.Healthz(ctx); err != nil {
		return nil, fmt.Errorf("verify OSS local root: %w", err)
	}
	legacyObjects, err := ossservice.NewPrivateSocialResetOwner(
		ossservice.PrivateSocialResetOwnerConfig{
			Database:    database,
			Backend:     ossBackend,
			BackendName: config.OSSBackend,
		},
	)
	if err != nil {
		return nil, err
	}
	owner, err := socialapplication.NewSecureContentResetOwner(
		store,
		socialObjects,
		legacyObjects,
		verifier,
	)
	if err != nil {
		return nil, err
	}

	return &productionRunner{
		owner:          owner,
		store:          store,
		quiesceCommand: config.StationQuiesceCommand,
	}, nil
}

func (r *productionRunner) Audit(
	ctx context.Context,
	request infrastructure.SecureContentResetAuditRequestV1,
	binding infrastructure.ResetInvocationBinding,
) (infrastructure.SecureContentResetManifestV1, error) {
	if !r.resetPrepared {
		state, found, err := r.store.ExistingResetState(
			ctx,
			request.ResetID,
		)
		if err != nil {
			return infrastructure.SecureContentResetManifestV1{}, err
		}
		requiresQuiescence, err := resetRequiresQuiescence(state, found)
		if err != nil {
			return infrastructure.SecureContentResetManifestV1{}, err
		}
		if requiresQuiescence {
			if err := runStationQuiesce(ctx, r.quiesceCommand); err != nil {
				return infrastructure.SecureContentResetManifestV1{}, err
			}
			if err := r.store.MigrateControlSchema(ctx); err != nil {
				return infrastructure.SecureContentResetManifestV1{}, err
			}
		}
		r.resetPrepared = true
	}

	return r.owner.Audit(ctx, request, binding)
}

func resetRequiresQuiescence(
	state infrastructure.ResetState,
	found bool,
) (bool, error) {
	if !found {
		return true, nil
	}
	switch state {
	case infrastructure.ResetStateStationDeployed,
		infrastructure.ResetStatePostAuditPassed,
		infrastructure.ResetStateComplete,
		infrastructure.ResetStateSuperseded,
		infrastructure.ResetStateRecoveryReplaced:
		return false, nil
	case infrastructure.ResetStatePrepared,
		infrastructure.ResetStateDatabaseSchemaCommitted,
		infrastructure.ResetStateObjectsDeleted:
		return true, nil
	default:
		return false, fmt.Errorf(
			"Secure Content reset has unsupported state %q",
			state,
		)
	}
}

func (r *productionRunner) Execute(
	ctx context.Context,
	invocation infrastructure.SecureContentResetInvocationV1,
	binding infrastructure.ResetInvocationBinding,
) (infrastructure.ResetExecutionResult, error) {
	if !r.resetPrepared {
		return infrastructure.ResetExecutionResult{},
			errors.New(
				"Secure Content reset execution requires schema_audit first",
			)
	}

	return r.owner.Execute(ctx, invocation, binding)
}

func (r *productionRunner) VerifyCanonicalSchema(
	ctx context.Context,
	attestation infrastructure.CanonicalPrivateSchemaAttestationV1,
	binding infrastructure.ResetInvocationBinding,
) (infrastructure.CanonicalPrivateSchemaAttestationV1, error) {
	return r.owner.VerifyCanonicalSchema(ctx, attestation, binding)
}

func runStationQuiesce(ctx context.Context, command []string) error {
	if len(command) == 0 {
		return errors.New("Station quiescence command is required")
	}
	completed := exec.CommandContext(ctx, command[0], command[1:]...)
	output, err := completed.CombinedOutput()
	if err != nil {
		diagnostic := strings.TrimSpace(string(output))
		if len(diagnostic) > 2000 {
			diagnostic = diagnostic[len(diagnostic)-2000:]
		}
		return fmt.Errorf(
			"quiesce Station before Secure Content reset: %w: %s",
			err,
			diagnostic,
		)
	}

	return nil
}

func (v *fileDeploymentVerifier) VerifyResetDeployment(
	ctx context.Context,
	manifest infrastructure.SecureContentResetManifestV1,
) (infrastructure.ResetDeploymentProof, error) {
	attestation, err := v.read()
	if err != nil {
		return infrastructure.ResetDeploymentProof{}, err
	}
	if err := validateServiceAttestation(attestation, manifest); err != nil {
		return infrastructure.ResetDeploymentProof{}, err
	}
	if err := v.verifyLiveService(ctx, attestation); err != nil {
		return infrastructure.ResetDeploymentProof{}, err
	}
	digest, err := serviceAttestationBindingDigest(attestation)
	if err != nil {
		return infrastructure.ResetDeploymentProof{}, err
	}

	return infrastructure.ResetDeploymentProof{
		SourceCommit:             attestation.Commit,
		StationServiceID:         attestation.ServiceID,
		StationPeerID:            attestation.RuntimeIdentity,
		StationRuntimeIdentity:   attestation.RuntimeIdentity,
		ServiceAttestationDigest: digest,
		CapturedAt:               attestation.CapturedAt.UTC(),
	}, nil
}

func (v *fileDeploymentVerifier) verifyLiveService(
	ctx context.Context,
	attestation serviceDeploymentAttestation,
) error {
	endpoint, err := url.Parse(strings.TrimRight(attestation.Endpoint, "/"))
	if err != nil ||
		(endpoint.Scheme != "http" && endpoint.Scheme != "https") ||
		endpoint.Host == "" {
		return errors.New(
			"Secure Content service attestation endpoint is invalid",
		)
	}
	client := v.client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	version, err := readLiveServiceIdentity(
		ctx,
		client,
		endpoint.String()+"/app-meta/version",
	)
	if err != nil {
		return fmt.Errorf("read live Station version: %w", err)
	}
	buildCommit, _ := version["build_commit"].(string)
	runtimeIdentity := firstNonemptyString(
		version,
		"peer_id",
		"station_peer_id",
		"service_id",
	)
	if runtimeIdentity == "" {
		identity, err := readLiveServiceIdentity(
			ctx,
			client,
			endpoint.String()+"/sub-bootstrap/info",
		)
		if err != nil {
			return fmt.Errorf("read live Station runtime identity: %w", err)
		}
		runtimeIdentity = firstNonemptyString(
			identity,
			"peer_id",
			"station_peer_id",
			"service_id",
		)
	}
	if !matchesLiveBuildCommit(buildCommit, attestation.Commit) ||
		runtimeIdentity != attestation.RuntimeIdentity {
		return errors.New(
			"live Station identity does not match the service attestation",
		)
	}

	return nil
}

func readLiveServiceIdentity(
	ctx context.Context,
	client *http.Client,
	endpoint string,
) (map[string]any, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		endpoint,
		nil,
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = response.Body.Close()
	}()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"Station identity endpoint returned status %d",
			response.StatusCode,
		)
	}
	raw, err := io.ReadAll(
		io.LimitReader(response.Body, maximumMaintenanceInput+1),
	)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw) > maximumMaintenanceInput {
		return nil, errors.New("Station identity response has an invalid size")
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if data, ok := payload["data"].(map[string]any); ok {
		return data, nil
	}

	return payload, nil
}

func firstNonemptyString(
	payload map[string]any,
	fields ...string,
) string {
	for _, field := range fields {
		value, _ := payload[field].(string)
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}

func (v *fileDeploymentVerifier) read() (serviceDeploymentAttestation, error) {
	if v == nil || strings.TrimSpace(v.path) == "" {
		return serviceDeploymentAttestation{}, errors.New(
			"Secure Content service attestation file is not configured",
		)
	}
	info, err := os.Lstat(v.path)
	if err != nil {
		return serviceDeploymentAttestation{}, fmt.Errorf(
			"stat Secure Content service attestation: %w",
			err,
		)
	}
	if !info.Mode().IsRegular() {
		return serviceDeploymentAttestation{}, errors.New(
			"Secure Content service attestation must be a regular file",
		)
	}
	file, err := os.Open(v.path)
	if err != nil {
		return serviceDeploymentAttestation{}, fmt.Errorf(
			"open Secure Content service attestation: %w",
			err,
		)
	}
	defer func() {
		_ = file.Close()
	}()
	raw, err := io.ReadAll(io.LimitReader(file, maximumMaintenanceInput+1))
	if err != nil {
		return serviceDeploymentAttestation{}, fmt.Errorf(
			"read Secure Content service attestation: %w",
			err,
		)
	}
	if len(raw) == 0 || len(raw) > maximumMaintenanceInput {
		return serviceDeploymentAttestation{}, errors.New(
			"Secure Content service attestation has an invalid size",
		)
	}
	var attestation serviceDeploymentAttestation
	if err := decodeStrictInput(raw, &attestation); err != nil {
		return serviceDeploymentAttestation{}, fmt.Errorf(
			"decode Secure Content service attestation: %w",
			err,
		)
	}

	return attestation, nil
}

func validateServiceAttestation(
	attestation serviceDeploymentAttestation,
	manifest infrastructure.SecureContentResetManifestV1,
) error {
	if attestation.ArtifactKind != serviceAttestationKind ||
		attestation.ServiceKind != stationServiceKind ||
		attestation.WorkspaceDigest != cleanWorkspaceDigest ||
		attestation.DeploymentEnvironment != manifest.DeploymentEnvironment ||
		attestation.Commit != manifest.SourceCommit ||
		attestation.LiveMetadata.BuildCommit != attestation.Commit ||
		attestation.CapturedAt.IsZero() ||
		!isGitCommit(attestation.Commit) ||
		!isSHA256(attestation.ProtocolDigest) ||
		!validNonempty(attestation.ServiceID) ||
		!validNonempty(attestation.EnvironmentID) ||
		!validNonempty(attestation.Endpoint) ||
		!validNonempty(attestation.Producer) ||
		!validNonempty(attestation.LiveMetadata.BuildTime) ||
		!validNonempty(attestation.RuntimeIdentity) {
		return errors.New(
			"Secure Content service attestation does not match the reset deployment",
		)
	}

	return nil
}

func serviceAttestationBindingDigest(
	attestation serviceDeploymentAttestation,
) (string, error) {
	content := map[string]any{
		"artifactKind":          serviceAttestationKind,
		"serviceId":             attestation.ServiceID,
		"serviceKind":           attestation.ServiceKind,
		"deploymentEnvironment": attestation.DeploymentEnvironment,
		"endpoint":              attestation.Endpoint,
		"commit":                attestation.Commit,
		"workspaceDigest":       attestation.WorkspaceDigest,
		"protocolDigest":        attestation.ProtocolDigest,
		"runtimeIdentity":       attestation.RuntimeIdentity,
	}
	encoded, err := json.Marshal(content)
	if err != nil {
		return "", fmt.Errorf(
			"encode Secure Content service attestation binding: %w",
			err,
		)
	}
	digest := sha256.Sum256(encoded)

	return hex.EncodeToString(digest[:]), nil
}

func validNonempty(value string) bool {
	return strings.TrimSpace(value) == value && value != "" &&
		!strings.ContainsRune(value, '\x00')
}

func isSHA256(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)

	return err == nil && len(decoded) == sha256.Size
}

func isGitCommit(value string) bool {
	if len(value) != 40 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)

	return err == nil && len(decoded) == 20
}

func matchesLiveBuildCommit(actual string, expected string) bool {
	if !isGitCommit(expected) || strings.ToLower(actual) != actual {
		return false
	}
	if len(actual) != 12 && len(actual) != 40 {
		return false
	}
	if _, err := hex.DecodeString(actual); err != nil {
		return false
	}

	return strings.HasPrefix(expected, actual)
}
