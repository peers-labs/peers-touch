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

func TestAggregateCreationContentionClassification(t *testing.T) {
	for _, err := range []error{
		gorm.ErrDuplicatedKey,
		postgresStateError{code: "23505"},
		errors.Join(
			errors.New("wrapped persistence failure"),
			postgresStateError{code: "40001"},
		),
		postgresStateError{code: "40P01"},
		errors.New("ERROR: duplicate key (SQLSTATE 23505)"),
		errors.New("UNIQUE constraint failed: conversations.conversation_id"),
	} {
		if !isAggregateCreationContention(err) {
			t.Fatalf("contention error was not recognized: %v", err)
		}
	}

	for _, err := range []error{
		nil,
		errors.New("generic persistence failure"),
		postgresStateError{code: "22000"},
	} {
		if isAggregateCreationContention(err) {
			t.Fatalf("non-contention error was accepted: %v", err)
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

	contention := aggregateCreationChildrenError(
		aggregateCreationStepError(
			"insert_devices",
			"insert devices",
			postgresStateError{code: "40001"},
		),
	)
	if !conversationdomain.IsCode(
		contention,
		conversationdomain.ErrorCodeCommandConflict,
	) {
		t.Fatalf("child contention was not mapped: %v", contention)
	}
}
