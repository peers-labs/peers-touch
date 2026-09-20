package auth

import (
	"context"
	"strings"
)

type BearerCredentialStatus string

const (
	BearerCredentialAbsent        BearerCredentialStatus = "absent"
	BearerCredentialAuthenticated BearerCredentialStatus = "authenticated"
	BearerCredentialMalformed     BearerCredentialStatus = "malformed"
	BearerCredentialInvalid       BearerCredentialStatus = "invalid"
	BearerCredentialRevoked       BearerCredentialStatus = "revoked"
)

type BearerCredentialResult struct {
	Status           BearerCredentialStatus
	Subject          *Subject
	RevocationReason string
	SessionValidator SessionValidator
}

// ValidateBearerCredential applies the common strict Bearer policy used by the
// HTTP adapters. An absent header is distinct from every supplied bad value so
// optional authentication can continue anonymously without downgrading an
// invalid credential.
func ValidateBearerCredential(
	ctx context.Context,
	authorization string,
	provider Provider,
	sessionValidators ...SessionValidator,
) BearerCredentialResult {
	if authorization == "" {
		return BearerCredentialResult{Status: BearerCredentialAbsent}
	}
	if len(authorization) <= len("Bearer ") ||
		!strings.HasPrefix(authorization, "Bearer ") {
		return BearerCredentialResult{Status: BearerCredentialMalformed}
	}

	token := authorization[len("Bearer "):]
	if token == "" || strings.TrimSpace(token) != token ||
		strings.ContainsAny(token, " \t\r\n") {
		return BearerCredentialResult{Status: BearerCredentialMalformed}
	}
	if provider == nil {
		return BearerCredentialResult{Status: BearerCredentialInvalid}
	}

	subject, err := provider.Validate(ctx, token)
	if err != nil || subject == nil || subject.ID == "" ||
		strings.TrimSpace(subject.ID) != subject.ID {
		return BearerCredentialResult{Status: BearerCredentialInvalid}
	}

	validator := selectedSessionValidator(sessionValidators)
	if validator != nil && subject.SessionID != "" {
		valid, reason := validator.CheckSessionValid(ctx, subject.SessionID)
		if !valid {
			return BearerCredentialResult{
				Status:           BearerCredentialRevoked,
				Subject:          subject,
				RevocationReason: reason,
				SessionValidator: validator,
			}
		}
	}

	return BearerCredentialResult{
		Status:           BearerCredentialAuthenticated,
		Subject:          subject,
		SessionValidator: validator,
	}
}

func selectedSessionValidator(validators []SessionValidator) SessionValidator {
	if len(validators) > 0 && validators[0] != nil {
		return validators[0]
	}
	return GetGlobalSessionValidator()
}
