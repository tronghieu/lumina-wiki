package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

func (service *Service) DeactivateWorkspace(ctx context.Context, reference SessionReferenceDTO) error {
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return err
	}
	service.consentCommitMu.Lock()
	finishCleanup, err := service.sessions.BeginDeactivate(window, reference.sessionReference())
	if errors.Is(err, session.ErrInvalidSession) {
		service.consentCommitMu.Unlock()
		return ErrSessionRejected
	}
	if err != nil {
		service.consentCommitMu.Unlock()
		return ErrSessionCleanup
	}
	service.activations.Invalidate(window)
	service.consentCommitMu.Unlock()
	err = finishCleanup()
	if errors.Is(err, session.ErrInvalidSession) {
		return ErrSessionRejected
	}
	if err != nil {
		return ErrSessionCleanup
	}
	return nil
}

func (service *Service) CancelChat(ctx context.Context, reference SessionReferenceDTO, requestID string) error {
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return err
	}
	err = service.sessions.CancelRequest(window, reference.sessionReference(), requestID)
	if err == nil {
		return nil
	}
	if errors.Is(err, session.ErrInvalidInput) {
		return ErrInvalidInput
	}
	return ErrSessionRejected
}

func CloseWindow(service *Service, window session.WindowID) error {
	if service == nil || service.sessions == nil || service.activations == nil || window == 0 {
		return ErrInvalidInput
	}
	service.consentCommitMu.Lock()
	service.activations.CloseWindow(window)
	service.consentCommitMu.Unlock()
	if err := service.sessions.CloseWindow(window); err != nil {
		return ErrSessionCleanup
	}
	return nil
}

func Close(service *Service) error {
	if service == nil || service.sessions == nil || service.activations == nil {
		return ErrInvalidInput
	}
	service.consentCommitMu.Lock()
	service.activations.Close()
	service.consentCommitMu.Unlock()
	if err := service.sessions.Close(); err != nil {
		return ErrSessionCleanup
	}
	return nil
}

func (reference SessionReferenceDTO) sessionReference() session.Reference {
	return session.Reference{SessionID: reference.SessionID, Generation: reference.Generation}
}
