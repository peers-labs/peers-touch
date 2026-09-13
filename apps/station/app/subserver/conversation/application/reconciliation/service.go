package reconciliation

import (
	"bytes"
	"context"
	"crypto/sha256"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const MaxBatchSize = 64

type State string

const (
	StateHomePending      State = "home_pending"
	StateAccepted         State = "accepted"
	StateTerminalRejected State = "terminal_rejected"
	StateNotFound         State = "not_found"
)

type Reference struct {
	ConversationID valueobject.ConversationID
	CommandID      valueobject.CommandID
	CommandHash    valueobject.Hash
}

type Resolution struct {
	Reference
	State             State
	AuthorityEvent    *domainevent.Record
	CanonicalResult   []byte
	TerminalErrorCode conversationdomain.ErrorCode
}

type Reader interface {
	Resolve(
		ctx context.Context,
		caller valueobject.Endpoint,
		reference Reference,
	) (Resolution, error)
}

type Service struct {
	reader Reader
}

func NewService(reader Reader) (*Service, error) {
	if reader == nil {
		return nil, invalid("reconciliation.new", "reader", "is required")
	}
	return &Service{reader: reader}, nil
}

func (s *Service) Resolve(
	ctx context.Context,
	caller valueobject.Endpoint,
	references []Reference,
) ([]Resolution, error) {
	if err := caller.Validate(); err != nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"reconciliation.resolve",
			"caller",
			"is not a valid authenticated endpoint",
		)
	}
	if len(references) == 0 || len(references) > MaxBatchSize {
		return nil, invalid(
			"reconciliation.resolve",
			"commands",
			"must contain between 1 and 64 exact command references",
		)
	}

	results := make([]Resolution, 0, len(references))
	for _, reference := range references {
		if err := validateReference(reference); err != nil {
			return nil, err
		}
		resolved, err := s.reader.Resolve(ctx, caller, reference)
		if err != nil {
			return nil, err
		}
		if err := validateResolution(reference, resolved); err != nil {
			return nil, err
		}
		results = append(results, cloneResolution(resolved))
	}
	return results, nil
}

func validateReference(reference Reference) error {
	if _, err := valueobject.NewConversationID(string(reference.ConversationID)); err != nil {
		return err
	}
	if _, err := valueobject.NewCommandID(string(reference.CommandID)); err != nil {
		return err
	}
	if len(reference.CommandHash.Bytes()) != sha256.Size {
		return invalid("reconciliation.validate_reference", "command_sha256", "must be SHA-256")
	}
	return nil
}

func validateResolution(reference Reference, resolved Resolution) error {
	if resolved.ConversationID != reference.ConversationID ||
		resolved.CommandID != reference.CommandID ||
		!bytes.Equal(resolved.CommandHash[:], reference.CommandHash[:]) {
		return integrity("result identity does not match the requested exact command")
	}
	switch resolved.State {
	case StateHomePending, StateNotFound:
		if resolved.AuthorityEvent != nil ||
			len(resolved.CanonicalResult) != 0 ||
			resolved.TerminalErrorCode != "" {
			return integrity("non-final result carries terminal outcome data")
		}
	case StateAccepted:
		if (resolved.AuthorityEvent == nil) == (len(resolved.CanonicalResult) == 0) ||
			resolved.TerminalErrorCode != "" {
			return integrity("accepted result does not carry exactly one canonical event result")
		}
	case StateTerminalRejected:
		if resolved.AuthorityEvent != nil ||
			(len(resolved.CanonicalResult) == 0) == (resolved.TerminalErrorCode == "") {
			return integrity("terminal result does not carry exactly one rejection")
		}
	default:
		return integrity("result state is not canonical")
	}
	return nil
}

func cloneResolution(value Resolution) Resolution {
	cloned := value
	if value.AuthorityEvent != nil {
		event := value.AuthorityEvent.Clone()
		cloned.AuthorityEvent = &event
	}
	cloned.CanonicalResult = append([]byte(nil), value.CanonicalResult...)
	return cloned
}

func invalid(operation string, field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		operation,
		field,
		message,
	)
}

func integrity(message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"reconciliation.validate_result",
		"result",
		message,
	)
}
