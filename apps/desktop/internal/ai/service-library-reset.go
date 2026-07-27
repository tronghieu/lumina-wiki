package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"
)

const resetConfirmationTokenBytes = 32

type resetConfirmationCoordinator struct {
	mu     sync.Mutex
	tokens map[string]session.WindowID
}

func newResetConfirmationCoordinator() *resetConfirmationCoordinator {
	return &resetConfirmationCoordinator{tokens: make(map[string]session.WindowID)}
}

func (coordinator *resetConfirmationCoordinator) issue(window session.WindowID) (string, error) {
	if coordinator == nil || window == 0 {
		return "", ErrLibraryUnavailable
	}
	raw := make([]byte, resetConfirmationTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", ErrLibraryUnavailable
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	coordinator.tokens[token] = window
	return token, nil
}

func (coordinator *resetConfirmationCoordinator) consume(token string, window session.WindowID) bool {
	if coordinator == nil || token == "" || window == 0 {
		return false
	}
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	owner, ok := coordinator.tokens[token]
	if ok {
		delete(coordinator.tokens, token)
	}
	return ok && owner == window
}

func (service *Service) BeginResetRecentViewState(
	ctx context.Context,
) (ResetRecentViewStateConfirmationDTO, error) {
	if service == nil || service.libraryState == nil || service.resetTokens == nil {
		return ResetRecentViewStateConfirmationDTO{}, ErrLibraryUnavailable
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ResetRecentViewStateConfirmationDTO{}, err
	}
	authority, ok := service.native.(RecentActivityNativeAuthority)
	if !ok {
		return ResetRecentViewStateConfirmationDTO{}, ErrLibraryUnavailable
	}
	approved, err := authority.ConfirmResetRecentActivity(ctx, window)
	if err != nil {
		return ResetRecentViewStateConfirmationDTO{}, ErrNativeAuthority
	}
	if !approved {
		return ResetRecentViewStateConfirmationDTO{Status: ResetConfirmationCancelled}, nil
	}
	token, err := service.resetTokens.issue(window)
	if err != nil {
		return ResetRecentViewStateConfirmationDTO{}, err
	}
	return ResetRecentViewStateConfirmationDTO{Status: ResetConfirmationReady, Token: token}, nil
}

func (service *Service) ResetRecentViewState(
	ctx context.Context,
	token string,
) (ResetRecentViewStateResultDTO, error) {
	if service == nil || service.libraryState == nil || service.resetTokens == nil || token == "" {
		return ResetRecentViewStateResultDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ResetRecentViewStateResultDTO{}, err
	}
	if !service.resetTokens.consume(token, window) {
		return ResetRecentViewStateResultDTO{}, ErrLibraryCapability
	}
	outcome, err := service.libraryState.ResetRecentViewState(ctx)
	if err != nil && outcome == "" {
		return ResetRecentViewStateResultDTO{Status: appstate.ResetUnavailable}, nil
	}
	return ResetRecentViewStateResultDTO{Status: outcome}, nil
}
