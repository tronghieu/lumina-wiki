package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type LegacyWorkspaceValidator interface {
	Validate(string) (workspace.ValidationResult, error)
}

type WorkspaceValidatorAdapter struct {
	legacy LegacyWorkspaceValidator
}

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
