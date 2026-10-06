package delivery

import (
	"context"
	"errors"
	"testing"
)

type receiptPostgresStateError struct {
	code string
}

func (e receiptPostgresStateError) Error() string {
	return "receipt postgres test error"
}

func (e receiptPostgresStateError) SQLState() string {
	return e.code
}

func TestReceiptRecorderTransactionRetriesPostgresContention(t *testing.T) {
	attempts := 0
	err := executeReceiptTransaction(context.Background(), func() error {
		attempts++
		if attempts < receiptTransactionMaxAttempts {
			return receiptPostgresStateError{code: "40P01"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("retry transaction: %v", err)
	}
	if attempts != receiptTransactionMaxAttempts {
		t.Fatalf("transaction attempts = %d", attempts)
	}

	attempts = 0
	expected := errors.New("non-retryable persistence failure")
	err = executeReceiptTransaction(context.Background(), func() error {
		attempts++
		return expected
	})
	if !errors.Is(err, expected) {
		t.Fatalf("non-retryable result = %v", err)
	}
	if attempts != 1 {
		t.Fatalf("non-retryable transaction attempts = %d", attempts)
	}
}
