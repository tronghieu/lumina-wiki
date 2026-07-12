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
	if err := service.sessions.Deactivate(window, reference.sessionReference()); err != nil {
		if errors.Is(err, session.ErrInvalidSession) {
			return ErrSessionRejected
		}
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
	if service == nil || service.sessions == nil || window == 0 {
		return ErrInvalidInput
	}
	if err := service.sessions.CloseWindow(window); err != nil {
		return ErrSessionCleanup
	}
	return nil
}

func Close(service *Service) error {
	if service == nil || service.sessions == nil {
		return ErrInvalidInput
	}
	if err := service.sessions.Close(); err != nil {
		return ErrSessionCleanup
	}
	return nil
}

func (reference SessionReferenceDTO) sessionReference() session.Reference {
	return session.Reference{SessionID: reference.SessionID, Generation: reference.Generation}
}
