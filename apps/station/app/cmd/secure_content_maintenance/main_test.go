package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
)

type resetRunnerFixture struct {
	auditCalls         int
	resetCalls         int
	verifyCalls        int
	includeAttestation bool
	exactReplay        bool
	omitCurrent        bool
	mutateVerification bool
	states             []infrastructure.ResetState
	accepted           []infrastructure.ResetInvocationAcceptance
}

func (f *resetRunnerFixture) Audit(
	_ context.Context,
	request infrastructure.SecureContentResetAuditRequestV1,
	_ infrastructure.ResetInvocationBinding,
) (infrastructure.SecureContentResetManifestV1, error) {
	f.auditCalls++
	snapshot := infrastructure.PublicSocialSnapshotV1{
		SchemaVersion:              infrastructure.SecureContentResetSchemaVersion,
		ProfileID:                  request.ProfileID,
		PublicPostSchemaDigest:     strings.Repeat("1", 64),
		PublicPostRowsDigest:       strings.Repeat("2", 64),
		PublicCommentRowsDigest:    strings.Repeat("3", 64),
		PublicReactionRowsDigest:   strings.Repeat("4", 64),
		PublicObjectMetadataDigest: strings.Repeat("5", 64),
		PublicObjectBytesDigest:    strings.Repeat("6", 64),
	}
	snapshot.SnapshotDigest, _ = snapshot.CalculatedDigest()
	manifest := infrastructure.SecureContentResetManifestV1{
		SchemaVersion:                 infrastructure.SecureContentResetSchemaVersion,
		ResetID:                       request.ResetID,
		ResetIntent:                   request.ResetIntent,
		SourceCommit:                  request.SourceCommit,
		WorkspaceID:                   request.WorkspaceID,
		ProfileID:                     request.ProfileID,
		DeploymentEnvironment:         request.DeploymentEnvironment,
		DestructiveScope:              request.DestructiveScope,
		DatabaseIdentityDigest:        strings.Repeat("7", 64),
		PublicSnapshotBefore:          snapshot,
		DatabaseTargets:               infrastructure.CanonicalDatabaseResetTargets(),
		CanonicalPrivateObjectTargets: []infrastructure.ObjectResetTarget{},
		LegacyOSSObjectTargets:        []infrastructure.ObjectResetTarget{},
		OutOfScopeTableNames:          []string{"accounts"},
		CreatedAt:                     request.IssuedAt,
	}
	manifest.ManifestDigest, _ = manifest.CalculatedDigest()

	return manifest, nil
}

func (f *resetRunnerFixture) Execute(
	_ context.Context,
	invocation infrastructure.SecureContentResetInvocationV1,
	_ infrastructure.ResetInvocationBinding,
) (infrastructure.ResetExecutionResult, error) {
	f.resetCalls++
	now := invocation.IssuedAt.UTC()
	state := infrastructure.ResetStateComplete
	if len(f.states) >= f.resetCalls {
		state = f.states[f.resetCalls-1]
	}
	states := []infrastructure.ResetState{
		infrastructure.ResetStatePrepared,
		infrastructure.ResetStateDatabaseSchemaCommitted,
		infrastructure.ResetStateObjectsDeleted,
		infrastructure.ResetStateStationDeployed,
		infrastructure.ResetStatePostAuditPassed,
		infrastructure.ResetStateComplete,
	}
	terminalIndex := 0
	for index, candidate := range states {
		if candidate == state {
			terminalIndex = index
			break
		}
	}
	transitions := make([]infrastructure.ResetJournalTransition, 0, terminalIndex)
	for index := 0; index < terminalIndex; index++ {
		transitions = append(transitions, infrastructure.ResetJournalTransition{
			Ordinal:      int64(index + 1),
			FromState:    states[index],
			ToState:      states[index+1],
			TransitionAt: now.Add(time.Duration(index+1) * time.Second),
		})
	}
	if !f.omitCurrent {
		f.accepted = append(f.accepted, infrastructure.ResetInvocationAcceptance{
			InvocationID:     invocation.InvocationID,
			InvocationDigest: invocation.InvocationDigest,
			AcceptedAt:       now,
		})
	}
	journal := infrastructure.ResetJournalV1{
		SchemaVersion:       infrastructure.SecureContentResetSchemaVersion,
		ResetID:             invocation.ResetID,
		ResetManifestDigest: invocation.ResetManifestDigest,
		CurrentState:        state,
		AcceptedInvocations: append([]infrastructure.ResetInvocationAcceptance(nil), f.accepted...),
		Transitions:         transitions,
		Failure:             nil,
	}
	journalDigest, _ := journal.CalculatedDigest()
	var attestation *infrastructure.CanonicalPrivateSchemaAttestationV1
	if f.includeAttestation && state == infrastructure.ResetStateComplete {
		snapshot := infrastructure.PublicSocialSnapshotV1{
			SchemaVersion:              infrastructure.SecureContentResetSchemaVersion,
			ProfileID:                  invocation.ProfileID,
			PublicPostSchemaDigest:     strings.Repeat("1", 64),
			PublicPostRowsDigest:       strings.Repeat("2", 64),
			PublicCommentRowsDigest:    strings.Repeat("3", 64),
			PublicReactionRowsDigest:   strings.Repeat("4", 64),
			PublicObjectMetadataDigest: strings.Repeat("5", 64),
			PublicObjectBytesDigest:    strings.Repeat("6", 64),
		}
		snapshot.SnapshotDigest, _ = snapshot.CalculatedDigest()
		value := infrastructure.CanonicalPrivateSchemaAttestationV1{
			SchemaVersion:            infrastructure.SecureContentResetSchemaVersion,
			SourceCommit:             invocation.SourceCommit,
			WorkspaceID:              invocation.WorkspaceID,
			ProfileID:                invocation.ProfileID,
			DeploymentEnvironment:    invocation.DeploymentEnvironment,
			DestructiveScope:         invocation.DestructiveScope,
			StationServiceID:         "station-four",
			StationPeerID:            "peer-four",
			StationRuntimeIdentity:   "peer-four",
			ServiceAttestationDigest: strings.Repeat("8", 64),
			ResetIntent:              invocation.ResetIntent,
			ResetManifestDigest:      invocation.ResetManifestDigest,
			CompletedJournalDigest:   journalDigest,
			CanonicalSchemaDigest:    strings.Repeat("9", 64),
			RetiredColumnsAbsent:     true,
			PublicSnapshotDigest:     snapshot.SnapshotDigest,
			CreatedAt:                now.Add(time.Minute),
		}
		value.AttestationDigest, _ = value.CalculatedDigest()
		attestation = &value
	}

	return infrastructure.ResetExecutionResult{
		SchemaVersion:   infrastructure.SecureContentResetSchemaVersion,
		ResetID:         invocation.ResetID,
		State:           journal.CurrentState,
		ExactReplay:     f.exactReplay,
		NeedsDeployment: state == infrastructure.ResetStateObjectsDeleted,
		Journal:         journal,
		JournalDigest:   journalDigest,
		Attestation:     attestation,
	}, nil
}

func (f *resetRunnerFixture) VerifyCanonicalSchema(
	_ context.Context,
	attestation infrastructure.CanonicalPrivateSchemaAttestationV1,
	_ infrastructure.ResetInvocationBinding,
) (infrastructure.CanonicalPrivateSchemaAttestationV1, error) {
	f.verifyCalls++
	if f.mutateVerification {
		attestation.StationPeerID += "-changed"
		attestation.AttestationDigest, _ = attestation.CalculatedDigest()
	}

	return attestation, nil
}

func TestSessionProtocolUsesCanonicalManifestAndResultSchemas(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	runner := &resetRunnerFixture{includeAttestation: true}
	request := validAuditRequest(t, binding, now)
	invocation := validInvocation(t, request, now, manifestForRequest(t, request))
	input := ndjson(t,
		map[string]any{"operation": "schema_audit", "payload": request},
		map[string]any{"operation": "reset", "payload": invocation},
	)
	var output bytes.Buffer
	if err := run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSession},
		bytes.NewReader(input),
		&output,
		commandDependencies{
			runner:  runner,
			binding: binding,
			now:     func() time.Time { return now },
		},
	); err != nil {
		t.Fatal(err)
	}
	if runner.auditCalls != 1 || runner.resetCalls != 1 {
		t.Fatalf("runner calls audit=%d reset=%d", runner.auditCalls, runner.resetCalls)
	}

	decoder := json.NewDecoder(&output)
	var prepared map[string]any
	var result map[string]any
	if err := decoder.Decode(&prepared); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&result); err != nil {
		t.Fatal(err)
	}
	assertKeys(t, prepared, []string{
		"schema_version", "reset_id", "reset_intent", "source_commit",
		"workspace_id", "profile_id", "deployment_environment",
		"destructive_scope", "database_identity_digest",
		"public_snapshot_before", "database_targets",
		"canonical_private_object_targets", "legacy_oss_object_targets",
		"out_of_scope_table_names", "created_at", "manifest_digest",
	})
	assertKeys(t, result, []string{
		"schema_version", "reset_id", "state", "exact_replay",
		"needs_deployment", "journal", "journal_digest", "attestation",
	})
	journal := result["journal"].(map[string]any)
	assertKeys(t, journal, []string{
		"schema_version", "reset_manifest_digest", "current_state",
		"accepted_invocations", "transitions", "failure",
	})
	if journal["current_state"] != string(infrastructure.ResetStateComplete) {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestReadOnlyOperationVerifiesLiveCanonicalSchema(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	runner := &resetRunnerFixture{includeAttestation: true}
	request := validAuditRequest(t, binding, now)
	manifest := manifestForRequest(t, request)
	invocation := validInvocation(t, request, now, manifest)
	result, err := runner.Execute(context.Background(), invocation, binding)
	if err != nil {
		t.Fatal(err)
	}
	runner.resetCalls = 0
	runner.accepted = nil
	binding.DeclarationDigest = ""

	var output bytes.Buffer
	if err := run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSchemaVerify},
		bytes.NewReader(mustJSON(t, result.Attestation)),
		&output,
		commandDependencies{
			runner:  runner,
			binding: binding,
			now:     func() time.Time { return now },
		},
	); err != nil {
		t.Fatal(err)
	}
	if runner.verifyCalls != 1 ||
		runner.auditCalls != 0 ||
		runner.resetCalls != 0 {
		t.Fatalf(
			"unexpected calls: verify=%d audit=%d reset=%d",
			runner.verifyCalls,
			runner.auditCalls,
			runner.resetCalls,
		)
	}
	var verified infrastructure.CanonicalPrivateSchemaAttestationV1
	if err := json.Unmarshal(output.Bytes(), &verified); err != nil {
		t.Fatal(err)
	}
	if verified != *result.Attestation {
		t.Fatalf("schema verification changed attestation: %#v", verified)
	}
}

func TestReadOnlyOperationRejectsChangedLiveSchemaVerification(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	runner := &resetRunnerFixture{
		includeAttestation: true,
		mutateVerification: true,
	}
	request := validAuditRequest(t, binding, now)
	manifest := manifestForRequest(t, request)
	invocation := validInvocation(t, request, now, manifest)
	result, err := runner.Execute(context.Background(), invocation, binding)
	if err != nil {
		t.Fatal(err)
	}
	runner.resetCalls = 0
	runner.accepted = nil
	binding.DeclarationDigest = ""

	err = run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSchemaVerify},
		bytes.NewReader(mustJSON(t, result.Attestation)),
		&bytes.Buffer{},
		commandDependencies{
			runner:  runner,
			binding: binding,
			now:     func() time.Time { return now },
		},
	)
	if err == nil || !strings.Contains(err.Error(), "changed the sealed attestation") {
		t.Fatalf("changed live attestation error = %v", err)
	}
}

func TestReadOnlyOperationRejectsResetDeclarationAuthority(t *testing.T) {
	err := run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSchemaVerify},
		bytes.NewReader([]byte("{}")),
		&bytes.Buffer{},
		commandDependencies{
			runner:  &resetRunnerFixture{},
			binding: testBinding(),
		},
	)
	if err == nil || !strings.Contains(err.Error(), "cannot inherit reset authority") {
		t.Fatalf("read-only declaration authority error = %v", err)
	}
}

func TestResetSessionRequiresDeclarationAuthority(t *testing.T) {
	binding := testBinding()
	binding.DeclarationDigest = ""
	err := run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSession},
		bytes.NewReader([]byte("{}")),
		&bytes.Buffer{},
		commandDependencies{
			runner:  &resetRunnerFixture{},
			binding: binding,
		},
	)
	if err == nil || !strings.Contains(err.Error(), "requires a declaration digest") {
		t.Fatalf("reset declaration authority error = %v", err)
	}
}

func TestSessionAllowsFreshInvocationAfterDeploymentBoundary(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	runner := &resetRunnerFixture{
		includeAttestation: true,
		states: []infrastructure.ResetState{
			infrastructure.ResetStateObjectsDeleted,
			infrastructure.ResetStateComplete,
		},
	}
	request := validAuditRequest(t, binding, now)
	manifest := manifestForRequest(t, request)
	first := validInvocation(t, request, now, manifest)
	second := validInvocation(t, request, now.Add(time.Second), manifest)
	second.InvocationID = "invoke-four-2"
	second.InvocationDigest, _ = second.CalculatedDigest()

	var output bytes.Buffer
	err := run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSession},
		bytes.NewReader(ndjson(t,
			map[string]any{"operation": "schema_audit", "payload": request},
			map[string]any{"operation": "reset", "payload": first},
			map[string]any{"operation": "reset", "payload": second},
		)),
		&output,
		commandDependencies{
			runner:  runner,
			binding: binding,
			now:     func() time.Time { return now },
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if runner.resetCalls != 2 {
		t.Fatalf("reset calls = %d, want 2", runner.resetCalls)
	}

	decoder := json.NewDecoder(&output)
	var manifestResult map[string]any
	var firstResult map[string]any
	var secondResult map[string]any
	if err := decoder.Decode(&manifestResult); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&firstResult); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&secondResult); err != nil {
		t.Fatal(err)
	}
	if firstResult["state"] != string(infrastructure.ResetStateObjectsDeleted) ||
		firstResult["needs_deployment"] != true ||
		secondResult["state"] != string(infrastructure.ResetStateComplete) ||
		secondResult["needs_deployment"] != false {
		t.Fatalf(
			"unexpected two-phase results: first=%#v second=%#v",
			firstResult,
			secondResult,
		)
	}
}

func TestSessionAllowsTerminalExactReplayAfterLostResponse(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	request := validAuditRequest(t, binding, now)
	manifest := manifestForRequest(t, request)
	invocation := validInvocation(t, request, now, manifest)
	acceptedBeforeReplay := infrastructure.ResetInvocationAcceptance{
		InvocationID:     "invoke-four-before-response-loss",
		InvocationDigest: strings.Repeat("c", 64),
		AcceptedAt:       now.Add(-time.Minute),
	}
	runner := &resetRunnerFixture{
		includeAttestation: true,
		exactReplay:        true,
		omitCurrent:        true,
		accepted: []infrastructure.ResetInvocationAcceptance{
			acceptedBeforeReplay,
		},
	}

	var output bytes.Buffer
	err := run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSession},
		bytes.NewReader(ndjson(t,
			map[string]any{"operation": "schema_audit", "payload": request},
			map[string]any{"operation": "reset", "payload": invocation},
		)),
		&output,
		commandDependencies{
			runner:  runner,
			binding: binding,
			now:     func() time.Time { return now },
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	decoder := json.NewDecoder(&output)
	var prepared infrastructure.SecureContentResetManifestV1
	var result infrastructure.ResetExecutionResult
	if err := decoder.Decode(&prepared); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&result); err != nil {
		t.Fatal(err)
	}
	if !result.ExactReplay ||
		result.State != infrastructure.ResetStateComplete ||
		len(result.Journal.AcceptedInvocations) != 1 ||
		result.Journal.AcceptedInvocations[0] != acceptedBeforeReplay {
		t.Fatalf("terminal replay mutated or replaced the sealed journal: %#v", result)
	}
}

func TestValidateExecutionResultAllowsSupersededExactReplay(t *testing.T) {
	now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
	binding := testBinding()
	request := validAuditRequest(t, binding, now)
	manifest := manifestForRequest(t, request)
	invocation := validInvocation(t, request, now, manifest)
	journal := infrastructure.ResetJournalV1{
		SchemaVersion:       infrastructure.SecureContentResetSchemaVersion,
		ResetID:             invocation.ResetID,
		ResetManifestDigest: invocation.ResetManifestDigest,
		CurrentState:        infrastructure.ResetStateSuperseded,
		AcceptedInvocations: []infrastructure.ResetInvocationAcceptance{
			{
				InvocationID:     invocation.InvocationID,
				InvocationDigest: invocation.InvocationDigest,
				AcceptedAt:       now,
			},
		},
		Transitions: []infrastructure.ResetJournalTransition{
			{
				Ordinal:      1,
				FromState:    infrastructure.ResetStatePrepared,
				ToState:      infrastructure.ResetStateSuperseded,
				TransitionAt: now.Add(time.Minute),
			},
		},
		Failure: &infrastructure.ResetJournalFailure{
			Code:       infrastructure.ResetCodeSourceSuperseded,
			RecordedAt: now.Add(time.Minute),
		},
	}
	journalDigest, err := journal.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}
	result := infrastructure.ResetExecutionResult{
		SchemaVersion: infrastructure.SecureContentResetSchemaVersion,
		ResetID:       invocation.ResetID,
		State:         infrastructure.ResetStateSuperseded,
		ExactReplay:   true,
		Journal:       journal,
		JournalDigest: journalDigest,
	}
	if err := validateExecutionResult(invocation, manifest, result); err != nil {
		t.Fatalf("superseded exact replay rejected: %v", err)
	}
	result.ExactReplay = false
	if err := validateExecutionResult(invocation, manifest, result); err == nil {
		t.Fatal("non-replay SUPERSEDED result was accepted")
	}

	journal.CurrentState = infrastructure.ResetStateRecoveryReplaced
	journal.Transitions = []infrastructure.ResetJournalTransition{
		{
			Ordinal:      1,
			FromState:    infrastructure.ResetStateStationDeployed,
			ToState:      infrastructure.ResetStateRecoveryReplaced,
			TransitionAt: now.Add(time.Minute),
		},
	}
	journal.Failure.Code = infrastructure.ResetCodeSchemaTargetUnreviewed
	journalDigest, err = journal.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}
	result.State = infrastructure.ResetStateRecoveryReplaced
	result.ExactReplay = true
	result.Journal = journal
	result.JournalDigest = journalDigest
	if err := validateExecutionResult(invocation, manifest, result); err != nil {
		t.Fatalf("recovery-replaced exact replay rejected: %v", err)
	}
	result.ExactReplay = false
	if err := validateExecutionResult(invocation, manifest, result); err == nil {
		t.Fatal("non-replay RECOVERY_REPLACED result was accepted")
	}
}

func TestSessionRejectsCurrentInvocationOmissionOutsideTerminalExactReplay(
	t *testing.T,
) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	request := validAuditRequest(t, binding, now)
	manifest := manifestForRequest(t, request)
	invocation := validInvocation(t, request, now, manifest)
	acceptedBeforeReplay := infrastructure.ResetInvocationAcceptance{
		InvocationID:     "invoke-four-prior",
		InvocationDigest: strings.Repeat("c", 64),
		AcceptedAt:       now.Add(-time.Minute),
	}
	tests := []struct {
		name               string
		state              infrastructure.ResetState
		exactReplay        bool
		includeAttestation bool
	}{
		{
			name:               "complete non-replay",
			state:              infrastructure.ResetStateComplete,
			includeAttestation: true,
		},
		{
			name:        "nonterminal exact replay",
			state:       infrastructure.ResetStateObjectsDeleted,
			exactReplay: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runner := &resetRunnerFixture{
				includeAttestation: test.includeAttestation,
				exactReplay:        test.exactReplay,
				omitCurrent:        true,
				states:             []infrastructure.ResetState{test.state},
				accepted: []infrastructure.ResetInvocationAcceptance{
					acceptedBeforeReplay,
				},
			}
			err := run(
				context.Background(),
				[]string{"--operation", maintenanceOperationSession},
				bytes.NewReader(ndjson(t,
					map[string]any{
						"operation": maintenanceSessionAudit,
						"payload":   request,
					},
					map[string]any{
						"operation": maintenanceSessionReset,
						"payload":   invocation,
					},
				)),
				&bytes.Buffer{},
				commandDependencies{
					runner:  runner,
					binding: binding,
					now:     func() time.Time { return now },
				},
			)
			if err == nil ||
				!strings.Contains(err.Error(), "omitted the current invocation") {
				t.Fatalf("current invocation omission error = %v", err)
			}
		})
	}
}

func TestSessionRejectsCompleteResultWithoutAttestation(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	request := validAuditRequest(t, binding, now)
	invocation := validInvocation(t, request, now, manifestForRequest(t, request))
	var output bytes.Buffer
	err := run(
		context.Background(),
		[]string{"--operation", maintenanceOperationSession},
		bytes.NewReader(ndjson(t,
			map[string]any{"operation": "schema_audit", "payload": request},
			map[string]any{"operation": "reset", "payload": invocation},
		)),
		&output,
		commandDependencies{
			runner:  &resetRunnerFixture{},
			binding: binding,
			now:     func() time.Time { return now },
		},
	)
	if err == nil {
		t.Fatal("COMPLETE result without attestation unexpectedly passed")
	}
}

func TestSessionRejectsStrictEnvelopeViolations(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	binding := testBinding()
	request := validAuditRequest(t, binding, now)
	tests := map[string]string{
		"unknown envelope field": `{"operation":"schema_audit","payload":{},"extra":true}` + "\n",
		"duplicate operation":    `{"operation":"schema_audit","operation":"schema_audit","payload":{}}` + "\n",
		"unknown operation":      `{"operation":"unknown","payload":{}}` + "\n",
		"reset first":            `{"operation":"reset","payload":{}}` + "\n",
		"unknown request field": string(mustJSON(t, map[string]any{
			"operation": "schema_audit",
			"payload": map[string]any{
				"schema_version": 1,
				"unknown":        true,
			},
		})) + "\n",
		"prepare only": string(mustJSON(t, map[string]any{
			"operation": "schema_audit",
			"payload":   request,
		})) + "\n",
		"prepare twice": string(ndjson(t,
			map[string]any{"operation": "schema_audit", "payload": request},
			map[string]any{"operation": "schema_audit", "payload": request},
		)),
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			err := run(
				context.Background(),
				[]string{"--operation", maintenanceOperationSession},
				strings.NewReader(input),
				&bytes.Buffer{},
				commandDependencies{
					runner:  &resetRunnerFixture{},
					binding: binding,
					now:     func() time.Time { return now },
				},
			)
			if err == nil {
				t.Fatal("expected strict session rejection")
			}
		})
	}
}

func TestSessionRejectsLegacyDirectOperations(t *testing.T) {
	for _, operation := range []string{"schema_audit", "reset", ""} {
		err := run(
			context.Background(),
			[]string{"--operation", operation},
			strings.NewReader("{}"),
			&bytes.Buffer{},
			commandDependencies{runner: &resetRunnerFixture{}},
		)
		if err == nil {
			t.Fatalf("operation %q unexpectedly accepted", operation)
		}
	}
}

func TestProductionConfigRejectsMissingAndUnsafeValues(t *testing.T) {
	valid := map[string]string{
		postgresDSNEnvironment:        "postgres://station.invalid/db",
		socialObjectRootEnvironment:   "/srv/peers/social-private",
		ossBackendEnvironment:         "local",
		ossLocalRootEnvironment:       "/srv/peers/oss",
		serviceAttestationEnvironment: "/srv/peers/attestation.json",
		stationQuiesceEnvironment:     `["/usr/bin/true"]`,
	}
	getenv := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}
	if _, err := productionConfigFromEnvironment(getenv(valid)); err != nil {
		t.Fatal(err)
	}
	for key := range valid {
		t.Run("missing_"+key, func(t *testing.T) {
			values := cloneStrings(valid)
			delete(values, key)
			if _, err := productionConfigFromEnvironment(getenv(values)); err == nil {
				t.Fatalf("missing %s unexpectedly accepted", key)
			}
		})
	}
	for name, mutate := range map[string]func(map[string]string){
		"relative social root": func(values map[string]string) {
			values[socialObjectRootEnvironment] = "relative/social"
		},
		"non-local OSS": func(values map[string]string) {
			values[ossBackendEnvironment] = "s3"
		},
		"shared owner root": func(values map[string]string) {
			values[ossLocalRootEnvironment] = values[socialObjectRootEnvironment]
		},
		"root filesystem": func(values map[string]string) {
			values[ossLocalRootEnvironment] = "/"
		},
		"invalid quiesce command": func(values map[string]string) {
			values[stationQuiesceEnvironment] = `[]`
		},
	} {
		t.Run(name, func(t *testing.T) {
			values := cloneStrings(valid)
			mutate(values)
			if _, err := productionConfigFromEnvironment(getenv(values)); err == nil {
				t.Fatal("unsafe configuration unexpectedly accepted")
			}
		})
	}
}

func TestRunStationQuiesceRequiresSuccessfulCommand(t *testing.T) {
	if err := runStationQuiesce(
		context.Background(),
		[]string{"/usr/bin/true"},
	); err != nil {
		t.Fatal(err)
	}
	if err := runStationQuiesce(
		context.Background(),
		[]string{"/usr/bin/false"},
	); err == nil {
		t.Fatal("failing Station quiescence command unexpectedly passed")
	}
}

func TestResetQuiescencePolicyPreservesLivePostDeploymentState(t *testing.T) {
	tests := []struct {
		name      string
		state     infrastructure.ResetState
		found     bool
		quiesce   bool
		wantError bool
	}{
		{name: "new reset", found: false, quiesce: true},
		{
			name:    "prepared",
			state:   infrastructure.ResetStatePrepared,
			found:   true,
			quiesce: true,
		},
		{
			name:    "objects deleted",
			state:   infrastructure.ResetStateObjectsDeleted,
			found:   true,
			quiesce: true,
		},
		{
			name:  "station deployed",
			state: infrastructure.ResetStateStationDeployed,
			found: true,
		},
		{
			name:  "post audit",
			state: infrastructure.ResetStatePostAuditPassed,
			found: true,
		},
		{
			name:  "complete",
			state: infrastructure.ResetStateComplete,
			found: true,
		},
		{
			name:  "superseded",
			state: infrastructure.ResetStateSuperseded,
			found: true,
		},
		{
			name:  "recovery replaced",
			state: infrastructure.ResetStateRecoveryReplaced,
			found: true,
		},
		{
			name:      "invalid",
			state:     infrastructure.ResetState("INVALID"),
			found:     true,
			wantError: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			quiesce, err := resetRequiresQuiescence(
				test.state,
				test.found,
			)
			if (err != nil) != test.wantError {
				t.Fatalf("error = %v", err)
			}
			if quiesce != test.quiesce {
				t.Fatalf("quiesce = %t, want %t", quiesce, test.quiesce)
			}
		})
	}
}

func TestFileDeploymentVerifier(t *testing.T) {
	commit := strings.Repeat("a", 40)
	var runtimeIdentity atomic.Value
	runtimeIdentity.Store("peer-four")
	server := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			if request.URL.Path != "/app-meta/version" {
				http.NotFound(response, request)
				return
			}
			response.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(response).Encode(map[string]any{
				"data": map[string]any{
					"build_commit": commit[:12],
					"build_time":   "2026-09-19T07:59:00Z",
					"peer_id":      runtimeIdentity.Load().(string),
				},
			})
		},
	))
	defer server.Close()
	attestation := map[string]any{
		"artifactKind":          serviceAttestationKind,
		"capturedAt":            "2026-09-19T08:00:00Z",
		"serviceId":             "station-four",
		"serviceKind":           stationServiceKind,
		"environmentId":         "four",
		"deploymentEnvironment": "station-four",
		"endpoint":              server.URL,
		"commit":                commit,
		"workspaceDigest":       cleanWorkspaceDigest,
		"protocolDigest":        strings.Repeat("b", 64),
		"producer":              "station-deployment",
		"liveMetadata": map[string]any{
			"buildCommit": commit,
			"buildTime":   "2026-09-19T07:59:00Z",
		},
		"runtimeIdentity": "peer-four",
	}
	path := filepath.Join(t.TempDir(), "attestation.json")
	if err := os.WriteFile(path, mustJSON(t, attestation), 0o600); err != nil {
		t.Fatal(err)
	}
	proof, err := (&fileDeploymentVerifier{path: path}).VerifyResetDeployment(
		context.Background(),
		infrastructure.SecureContentResetManifestV1{
			SourceCommit:          commit,
			DeploymentEnvironment: "station-four",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if proof.StationServiceID != "station-four" ||
		proof.StationPeerID != "peer-four" ||
		!isSHA256(proof.ServiceAttestationDigest) {
		t.Fatalf("unexpected deployment proof: %#v", proof)
	}

	attestation["unknown"] = true
	if err := os.WriteFile(path, mustJSON(t, attestation), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := (&fileDeploymentVerifier{path: path}).VerifyResetDeployment(
		context.Background(),
		infrastructure.SecureContentResetManifestV1{
			SourceCommit:          commit,
			DeploymentEnvironment: "station-four",
		},
	); err == nil {
		t.Fatal("unknown attestation field unexpectedly accepted")
	}

	delete(attestation, "unknown")
	if err := os.WriteFile(path, mustJSON(t, attestation), 0o600); err != nil {
		t.Fatal(err)
	}
	runtimeIdentity.Store("replacement-peer")
	if _, err := (&fileDeploymentVerifier{path: path}).VerifyResetDeployment(
		context.Background(),
		infrastructure.SecureContentResetManifestV1{
			SourceCommit:          commit,
			DeploymentEnvironment: "station-four",
		},
	); err == nil {
		t.Fatal("replaced live Station unexpectedly passed verification")
	}

	if matchesLiveBuildCommit("aaaaaaaaaaa", commit) ||
		matchesLiveBuildCommit(strings.Repeat("b", 12), commit) {
		t.Fatal("invalid or mismatched abbreviated commit was accepted")
	}
}

func testBinding() infrastructure.ResetInvocationBinding {
	return infrastructure.ResetInvocationBinding{
		SourceCommit:          strings.Repeat("a", 40),
		WorkspaceID:           "workspace-1",
		ProfileID:             "four",
		DeploymentEnvironment: "station-four",
		DestructiveScope:      "station-four-social-private",
		DeclarationDigest:     strings.Repeat("b", 64),
	}
}

func validAuditRequest(
	t *testing.T,
	binding infrastructure.ResetInvocationBinding,
	now time.Time,
) infrastructure.SecureContentResetAuditRequestV1 {
	t.Helper()
	request := infrastructure.SecureContentResetAuditRequestV1{
		SchemaVersion:         infrastructure.SecureContentResetSchemaVersion,
		RequestID:             "audit-four-1",
		PlanID:                infrastructure.SecureContentResetPlanID,
		TaskID:                "W12A",
		ResetID:               "reset-four-1",
		ResetIntent:           infrastructure.ResetIntentSchemaActivation,
		SourceCommit:          binding.SourceCommit,
		WorkspaceID:           binding.WorkspaceID,
		ProfileID:             binding.ProfileID,
		DeploymentEnvironment: binding.DeploymentEnvironment,
		DestructiveScope:      binding.DestructiveScope,
		DeclarationDigest:     binding.DeclarationDigest,
		IssuedAt:              now,
		ExpiresAt:             now.Add(10 * time.Minute),
	}
	var err error
	request.RequestDigest, err = request.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}

	return request
}

func manifestForRequest(
	t *testing.T,
	request infrastructure.SecureContentResetAuditRequestV1,
) infrastructure.SecureContentResetManifestV1 {
	t.Helper()
	runner := &resetRunnerFixture{}
	manifest, err := runner.Audit(
		context.Background(),
		request,
		infrastructure.ResetInvocationBinding{},
	)
	if err != nil {
		t.Fatal(err)
	}

	return manifest
}

func validInvocation(
	t *testing.T,
	request infrastructure.SecureContentResetAuditRequestV1,
	now time.Time,
	manifest infrastructure.SecureContentResetManifestV1,
) infrastructure.SecureContentResetInvocationV1 {
	t.Helper()
	invocation := infrastructure.SecureContentResetInvocationV1{
		SchemaVersion:         infrastructure.SecureContentResetSchemaVersion,
		InvocationID:          "invoke-four-1",
		ResetID:               request.ResetID,
		ResetIntent:           request.ResetIntent,
		ResetManifestDigest:   manifest.ManifestDigest,
		PlanID:                request.PlanID,
		TaskID:                request.TaskID,
		DeclarationDigest:     request.DeclarationDigest,
		SourceCommit:          request.SourceCommit,
		WorkspaceID:           request.WorkspaceID,
		ProfileID:             request.ProfileID,
		DeploymentEnvironment: request.DeploymentEnvironment,
		DestructiveScope:      request.DestructiveScope,
		IssuedAt:              now.Add(-time.Minute),
		ExpiresAt:             now.Add(10 * time.Minute),
	}
	var err error
	invocation.InvocationDigest, err = invocation.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}

	return invocation
}

func ndjson(t *testing.T, values ...any) []byte {
	t.Helper()
	var result []byte
	for _, value := range values {
		result = append(result, mustJSON(t, value)...)
		result = append(result, '\n')
	}

	return result
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}

	return raw
}

func assertKeys(t *testing.T, value map[string]any, expected []string) {
	t.Helper()
	actual := make([]string, 0, len(value))
	for key := range value {
		actual = append(actual, key)
	}
	if !sameStringSet(actual, expected) {
		t.Fatalf("keys=%v want=%v", actual, expected)
	}
}

func sameStringSet(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	leftSet := make(map[string]struct{}, len(left))
	for _, value := range left {
		leftSet[value] = struct{}{}
	}
	for _, value := range right {
		if _, ok := leftSet[value]; !ok {
			return false
		}
	}

	return true
}

func cloneStrings(value map[string]string) map[string]string {
	cloned := make(map[string]string, len(value))
	for key, item := range value {
		cloned[key] = item
	}

	return cloned
}
