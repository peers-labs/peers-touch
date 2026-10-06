package command

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
)

type scriptedUnitOfWork struct {
	outcomes []error
	attempts int
}

type testPersistenceStageError struct {
	stage string
	cause error
}

func (e *testPersistenceStageError) Error() string {
	return e.cause.Error()
}

func (e *testPersistenceStageError) Unwrap() error {
	return e.cause
}

func (e *testPersistenceStageError) PersistenceFailureStage() string {
	return e.stage
}

func (u *scriptedUnitOfWork) Execute(
	_ context.Context,
	_ func(ports.Transaction) error,
) error {
	return errors.New("unexpected non-serialized transaction")
}

func (u *scriptedUnitOfWork) ExecuteSerialized(
	_ context.Context,
	_ string,
	transaction func(ports.Transaction) error,
) error {
	index := u.attempts
	u.attempts++
	if index >= len(u.outcomes) {
		index = len(u.outcomes) - 1
	}
	if u.outcomes[index] != nil {
		return u.outcomes[index]
	}
	return transaction(ports.Transaction{})
}

func TestForwardableCommandKindIncludesMemberAuthority(t *testing.T) {
	if !forwardableCommandKind(domainevent.KindMemberAuthority) {
		t.Fatal("member-authority command is not admitted by SubmitForwarded")
	}
}

func TestDirectCreationFailureStagePreservesCause(t *testing.T) {
	cause := errors.New("private persistence failure")
	staged := directCreationStage("persist_transition", cause)

	stage, ok := DirectCreationFailureStage(staged)
	if !ok || stage != "persist_transition" {
		t.Fatalf("stage = %q, ok = %v", stage, ok)
	}
	if !errors.Is(staged, cause) {
		t.Fatal("staged error did not retain its cause")
	}
	if stage, ok := DirectCreationFailureStage(cause); ok || stage != "" {
		t.Fatalf("unstaged error returned stage = %q, ok = %v", stage, ok)
	}

	persisted := directPersistTransitionStage(
		transitionPersistenceStage("enqueue_device_inbox", cause),
	)
	stage, ok = DirectCreationFailureStage(persisted)
	if !ok || stage != "persist_transition_enqueue_device_inbox" {
		t.Fatalf("persistence stage = %q, ok = %v", stage, ok)
	}
	if !errors.Is(persisted, cause) {
		t.Fatal("persistence stage did not retain its cause")
	}

	persisted = directPersistTransitionStage(
		transitionPersistenceStage(
			"create_authority",
			&testPersistenceStageError{
				stage: "insert_members",
				cause: cause,
			},
		),
	)
	stage, ok = DirectCreationFailureStage(persisted)
	if !ok ||
		stage != "persist_transition_create_authority_insert_members" {
		t.Fatalf("nested persistence stage = %q, ok = %v", stage, ok)
	}
	if !errors.Is(persisted, cause) {
		t.Fatal("nested persistence stage did not retain its cause")
	}
}

func TestExecuteDirectGenesisTransactionRetriesSpecificContentionOnce(t *testing.T) {
	contention := directCreationStage(
		"persist_transition_create_authority",
		&conversationdomain.Error{
			Code:      conversationdomain.ErrorCodeCommandConflict,
			Operation: "persistence.create_aggregate",
			Field:     "aggregate",
			Message:   "creation contended with a concurrent transaction",
			Cause:     errors.New("database contention"),
		},
	)
	unitOfWork := &scriptedUnitOfWork{outcomes: []error{contention, nil}}
	err := executeDirectGenesisTransaction(
		context.Background(),
		unitOfWork,
		"direct-conversation",
		func(ports.Transaction) error {
			return nil
		},
	)
	if err != nil {
		t.Fatalf("retry returned error: %v", err)
	}
	if unitOfWork.attempts != 2 {
		t.Fatalf("attempts = %d, want 2", unitOfWork.attempts)
	}
}

func TestExecuteDirectGenesisTransactionBoundsAndScopesRetry(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		attempts int
	}{
		{
			name: "persistent aggregate contention",
			err: conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"persistence.create_aggregate",
				"aggregate",
				"creation contended with a concurrent transaction",
			),
			attempts: 2,
		},
		{
			name: "different conflict operation",
			err: conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"application.create_direct",
				"authority_station",
				"does not match the local authority",
			),
			attempts: 1,
		},
		{
			name: "different code",
			err: conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"persistence.create_aggregate",
				"aggregate",
				"was not found",
			),
			attempts: 1,
		},
		{
			name:     "untyped error",
			err:      errors.New("generic failure"),
			attempts: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			unitOfWork := &scriptedUnitOfWork{
				outcomes: []error{test.err, test.err},
			}
			err := executeDirectGenesisTransaction(
				context.Background(),
				unitOfWork,
				"direct-conversation",
				func(ports.Transaction) error {
					return nil
				},
			)
			if !errors.Is(err, test.err) {
				t.Fatalf("returned error = %v, want %v", err, test.err)
			}
			if unitOfWork.attempts != test.attempts {
				t.Fatalf(
					"attempts = %d, want %d",
					unitOfWork.attempts,
					test.attempts,
				)
			}
		})
	}
}
