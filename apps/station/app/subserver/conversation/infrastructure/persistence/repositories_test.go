package persistence

import (
	"errors"
	"testing"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"gorm.io/gorm"
)

type postgresStateError struct {
	code string
}

func (e postgresStateError) Error() string {
	return "postgres test error"
}

func (e postgresStateError) SQLState() string {
	return e.code
}

func TestAggregateCreationConflictClassification(t *testing.T) {
	for _, err := range []error{
		gorm.ErrDuplicatedKey,
		postgresStateError{code: "23505"},
		errors.New("ERROR: duplicate key (SQLSTATE 23505)"),
		errors.New("UNIQUE constraint failed: conversations.conversation_id"),
	} {
		if !isAggregateCreationConflict(err) {
			t.Fatalf("unique conflict was not recognized: %v", err)
		}
	}

	for _, err := range []error{
		nil,
		errors.New("generic persistence failure"),
		postgresStateError{code: "40001"},
		postgresStateError{code: "40P01"},
		postgresStateError{code: "22000"},
	} {
		if isAggregateCreationConflict(err) {
			t.Fatalf("non-unique error was accepted: %v", err)
		}
	}
}

func TestRetryableTransactionContentionClassification(t *testing.T) {
	for _, err := range []error{
		postgresStateError{code: "40001"},
		errors.Join(
			errors.New("wrapped persistence failure"),
			postgresStateError{code: "40P01"},
		),
		errors.New("ERROR: deadlock detected (SQLSTATE 40P01)"),
	} {
		if !IsRetryableTransactionContention(err) {
			t.Fatalf("retryable transaction error was not recognized: %v", err)
		}
	}

	for _, err := range []error{
		nil,
		gorm.ErrDuplicatedKey,
		postgresStateError{code: "23505"},
		postgresStateError{code: "22000"},
	} {
		if IsRetryableTransactionContention(err) {
			t.Fatalf("non-retryable transaction error was accepted: %v", err)
		}
	}
}

func TestAggregateCreationContentionMapsToSpecificConflict(t *testing.T) {
	cause := postgresStateError{code: "23505"}
	err := aggregateCreationPersistenceError(cause)

	var typed *conversationdomain.Error
	if !errors.As(err, &typed) {
		t.Fatalf("mapped error type = %T", err)
	}
	if typed.Code != conversationdomain.ErrorCodeCommandConflict {
		t.Fatalf("mapped error code = %q", typed.Code)
	}
	if typed.Operation != "persistence.create_aggregate" {
		t.Fatalf("mapped error operation = %q", typed.Operation)
	}
	if typed.Field != "aggregate" {
		t.Fatalf("mapped error field = %q", typed.Field)
	}
	if !errors.Is(err, cause) {
		t.Fatal("mapped error did not preserve its cause")
	}

	generic := errors.New("generic persistence failure")
	err = aggregateCreationPersistenceError(generic)
	if conversationdomain.CodeOf(err) != "" {
		t.Fatalf("generic error unexpectedly mapped to %q", conversationdomain.CodeOf(err))
	}
	if !errors.Is(err, generic) {
		t.Fatal("generic error did not preserve its cause")
	}
}

func TestAggregateCreationStepPreservesSafeStage(t *testing.T) {
	cause := errors.New("private persistence failure")
	err := aggregateCreationStepError(
		"insert_members",
		"insert members",
		cause,
	)

	var staged interface {
		PersistenceFailureStage() string
	}
	if !errors.As(err, &staged) {
		t.Fatalf("staged error type = %T", err)
	}
	if staged.PersistenceFailureStage() != "insert_members" {
		t.Fatalf(
			"persistence stage = %q",
			staged.PersistenceFailureStage(),
		)
	}
	if !errors.Is(err, cause) {
		t.Fatal("staged error did not preserve its cause")
	}

	sqlStateStage := aggregateCreationStepError(
		"insert_aggregate",
		"create aggregate",
		postgresStateError{code: "23502"},
	)
	if !errors.As(sqlStateStage, &staged) {
		t.Fatalf("SQLSTATE staged error type = %T", sqlStateStage)
	}
	if staged.PersistenceFailureStage() !=
		"insert_aggregate_sqlstate_23502" {
		t.Fatalf(
			"SQLSTATE persistence stage = %q",
			staged.PersistenceFailureStage(),
		)
	}

	retryable := aggregateCreationChildrenError(
		aggregateCreationStepError(
			"insert_devices",
			"insert devices",
			postgresStateError{code: "40001"},
		),
	)
	if conversationdomain.CodeOf(retryable) != "" {
		t.Fatalf(
			"retryable transaction error was mapped to domain code %q",
			conversationdomain.CodeOf(retryable),
		)
	}
	var marker interface {
		RetryablePersistence() bool
	}
	if !errors.As(retryable, &marker) || !marker.RetryablePersistence() {
		t.Fatalf("retryable transaction marker was lost: %v", retryable)
	}
}
