// Package v1 provides the core L1 interfaces for Peers-Touch architecture.
// These interfaces define the four fundamental elements: Identity, Connection, Communication, Discovery.
// All interfaces are designed to be orthogonal and only depend on L0 infrastructure modules.
package v1

import (
	"context"

	identitypb "github.com/dirty-bro-tech/peers-touch-go/model/v2/identity"
)

// Resolver resolves identity IDs to their metadata.
type Resolver interface {
	// Resolve returns the metadata for the given identity IDs.
	Resolve(ctx context.Context, ids []*identitypb.IdentityID) (*identitypb.IdentityResolveResponse, error)
}

// Signer provides cryptographic signing capabilities.
type Signer interface {
	// Sign creates a signature for the given payload.
	Sign(ctx context.Context, payload []byte) (*identitypb.SignResponse, error)
	
	// Verify verifies a signature against the given payload and identity.
	Verify(ctx context.Context, payload []byte, signature *identitypb.Signature, identityID *identitypb.IdentityID) (*identitypb.VerifyResponse, error)
}

// CredentialManager manages verifiable credentials.
type CredentialManager interface {
	// Issue creates a new credential for the given subject.
	Issue(ctx context.Context, req *identitypb.CredentialIssueRequest) (*identitypb.Credential, error)
	
	// Verify verifies the authenticity and validity of a credential.
	Verify(ctx context.Context, req *identitypb.CredentialVerifyRequest) (*identitypb.CredentialVerifyResponse, error)
	
	// List returns credentials for the given subject.
	List(ctx context.Context, req *identitypb.CredentialListRequest) (*identitypb.CredentialListResponse, error)
	
	// Revoke revokes a credential.
	Revoke(ctx context.Context, credentialID string) error
}

// IdentityManager provides comprehensive identity management capabilities.
type IdentityManager interface {
	// Create creates a new identity.
	Create(ctx context.Context, req *identitypb.IdentityCreateRequest) (*identitypb.IdentityMeta, error)
	
	// Update updates identity metadata.
	Update(ctx context.Context, req *identitypb.IdentityUpdateRequest) (*identitypb.IdentityMeta, error)
	
	// Delete removes an identity.
	Delete(ctx context.Context, id *identitypb.IdentityID) error
	
	// GetResolver returns the resolver component.
	GetResolver() Resolver
	
	// GetSigner returns the signer component.
	GetSigner() Signer
	
	// GetCredentialManager returns the credential manager component.
	GetCredentialManager() CredentialManager
}
