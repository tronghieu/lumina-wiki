package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type LegacyWorkspaceValidator interface {
	Validate(string) (workspace.ValidationResult, error)
}

type trustedWorkspaceValidatorBackend interface {
	LegacyWorkspaceValidator
	ValidateTrusted(context.Context, string, rootproof.RootProof) (workspace.ValidationResult, error)
}

type WorkspaceValidatorAdapter struct {
	legacy LegacyWorkspaceValidator
}

func (adapter *WorkspaceValidatorAdapter) ValidateTrusted(ctx context.Context, root string,
	proof rootproof.RootProof) (WorkspaceShape, error) {
	if adapter == nil || !hasValue(adapter.legacy) || ctx == nil || ctx.Err() != nil {
		return WorkspaceShape{}, ErrInvalidWorkspace
	}
	trusted, ok := adapter.legacy.(trustedWorkspaceValidatorBackend)
	if !ok {
		return WorkspaceShape{}, ErrInvalidWorkspace
	}
	result, err := trusted.ValidateTrusted(ctx, root, proof)
	if err != nil || ctx.Err() != nil {
		return WorkspaceShape{}, ErrInvalidWorkspace
	}
	return WorkspaceShape{Valid: result.Valid}, nil
}

var _ TrustedWorkspaceValidator = (*WorkspaceValidatorAdapter)(nil)

func NewWorkspaceValidatorAdapter(legacy LegacyWorkspaceValidator) (*WorkspaceValidatorAdapter, error) {
	if !hasValue(legacy) {
		return nil, ErrInvalidInput
	}
	return &WorkspaceValidatorAdapter{legacy: legacy}, nil
}

func (adapter *WorkspaceValidatorAdapter) Validate(ctx context.Context, root string) (WorkspaceShape, error) {
	if adapter == nil || !hasValue(adapter.legacy) || ctx == nil || ctx.Err() != nil {
		return WorkspaceShape{}, ErrInvalidWorkspace
	}
	result, err := adapter.legacy.Validate(root)
	if err != nil || ctx.Err() != nil {
		return WorkspaceShape{}, ErrInvalidWorkspace
	}
	return WorkspaceShape{Valid: result.Valid}, nil
}
