package ai

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

var ErrEmbeddingConsentUnavailable = errors.New("embedding consent is unavailable")

func defaultNow(now func() time.Time) func() time.Time {
	if now == nil {
		return time.Now
	}
	return now
}

func (service *Service) EmbeddingConsentStatus(ctx context.Context, request EmbeddingConsentRequestDTO) (EmbeddingConsentResultDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, request.Session)
	if err != nil {
		return EmbeddingConsentResultDTO{}, consentResolveError(err)
	}
	defer lease.Finish()
	if !validIndexProfileID(request.EmbeddingProfileID) {
		return EmbeddingConsentResultDTO{}, ErrInvalidInput
	}
	subject, err := runtime.EmbeddingConsentSubject(ctx, request.EmbeddingProfileID)
	if err != nil || !validConsentSubject(subject, request.EmbeddingProfileID) {
		return EmbeddingConsentResultDTO{}, consentCallError(ctx, err)
	}
	return consentResult(subject), nil
}

func (service *Service) GrantEmbeddingConsent(ctx context.Context, request EmbeddingConsentRequestDTO) (EmbeddingConsentResultDTO, error) {
	window, err := service.resolveConsentMutationWindow(ctx, request)
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	gate, err := service.activations.Acquire(ctx, window)
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	defer gate.Finish()
	runtime, runtimeLease, err := service.resolveManagementWindow(gate.Context(), window, request.Session)
	if err != nil {
		return EmbeddingConsentResultDTO{}, consentResolveError(err)
	}
	subject, err := runtime.EmbeddingConsentSubject(gate.Context(), request.EmbeddingProfileID)
	runtimeLease.Finish()
	if err != nil || !validConsentSubject(subject, request.EmbeddingProfileID) {
		return EmbeddingConsentResultDTO{}, consentCallError(gate.Context(), err)
	}
	if subject.Granted {
		return consentResult(subject), nil
	}
	disclosure, err := nativeConsentDisclosure(subject)
	if err != nil {
		return EmbeddingConsentResultDTO{}, ErrEmbeddingConsentUnavailable
	}
	approved, err := service.native.ConfirmEmbeddingDisclosure(gate.Context(), window, disclosure)
	if leaseErr := gate.Validate(); leaseErr != nil {
		return EmbeddingConsentResultDTO{}, leaseErr
	}
	if err != nil {
		return EmbeddingConsentResultDTO{}, ErrNativeAuthority
	}
	if !approved {
		return consentResult(subject), nil
	}
	runtime, runtimeLease, err = service.resolveManagementWindow(gate.Context(), window, request.Session)
	if err != nil {
		return EmbeddingConsentResultDTO{}, consentResolveError(err)
	}
	current, err := runtime.EmbeddingConsentSubject(gate.Context(), request.EmbeddingProfileID)
	runtimeLease.Finish()
	if err != nil || !sameConsentSubject(subject, current) {
		return EmbeddingConsentResultDTO{}, ErrSessionRejected
	}
	return service.persistEmbeddingGrant(gate, subject)
}

func (service *Service) RevokeEmbeddingConsent(ctx context.Context, request EmbeddingConsentRequestDTO) (EmbeddingConsentResultDTO, error) {
	window, err := service.resolveConsentMutationWindow(ctx, request)
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	gate, err := service.activations.Acquire(ctx, window)
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	defer gate.Finish()
	runtime, lease, err := service.resolveManagementWindow(gate.Context(), window, request.Session)
	if err != nil {
		return EmbeddingConsentResultDTO{}, consentResolveError(err)
	}
	defer lease.Finish()
	release, err := runtime.BeginConsentMutation(gate.Context(), request.EmbeddingProfileID)
	if err != nil {
		return EmbeddingConsentResultDTO{}, consentCallError(gate.Context(), err)
	}
	defer release()
	subject, err := runtime.EmbeddingConsentSubject(gate.Context(), request.EmbeddingProfileID)
	if err != nil || !validConsentSubject(subject, request.EmbeddingProfileID) {
		return EmbeddingConsentResultDTO{}, consentCallError(gate.Context(), err)
	}
	finishMutation, err := service.consentAccess.BeginMutation(gate.Context())
	if err != nil {
		return EmbeddingConsentResultDTO{}, consentCallError(gate.Context(), err)
	}
	defer finishMutation()
	return service.persistEmbeddingRevoke(gate, runtime, subject)
}

func (service *Service) resolveConsentMutationWindow(ctx context.Context, request EmbeddingConsentRequestDTO) (session.WindowID, error) {
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return 0, err
	}
	_, lease, err := service.resolveManagementWindow(ctx, window, request.Session)
	if err != nil {
		return 0, consentResolveError(err)
	}
	lease.Finish()
	if !validIndexProfileID(request.EmbeddingProfileID) {
		return 0, ErrInvalidInput
	}
	return window, nil
}

func consentResult(subject embeddingConsentSubject) EmbeddingConsentResultDTO {
	return EmbeddingConsentResultDTO{ProfileID: subject.Profile.ID, Granted: subject.Granted,
		Kind: string(subject.Disclosure.Kind), DisclosureVersion: subject.Disclosure.Version}
}

func nativeConsentDisclosure(subject embeddingConsentSubject) (EmbeddingDisclosure, error) {
	u, err := url.Parse(subject.Profile.BaseURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return EmbeddingDisclosure{}, ErrEmbeddingConsentUnavailable
	}
	origin := (&url.URL{Scheme: u.Scheme, Host: u.Host}).String()
	return EmbeddingDisclosure{ProfileID: subject.Profile.ID, ProviderLabel: subject.Profile.Label,
		ProviderKind: string(subject.Profile.Kind), Model: subject.Profile.Model, EndpointOrigin: origin,
		Kind: string(subject.Disclosure.Kind), DisclosureVersion: subject.Disclosure.Version}, nil
}

func validConsentSubject(subject embeddingConsentSubject, profileID string) bool {
	if !subject.WorkspaceID.Valid() || subject.Profile.ID != profileID || subject.Profile.Role != settings.RoleEmbedding {
		return false
	}
	disclosure, err := index.ConsentFingerprint(subject.WorkspaceID, subject.Profile)
	return err == nil && disclosure == subject.Disclosure
}

func sameConsentSubject(first, second embeddingConsentSubject) bool {
	return validConsentSubject(second, first.Profile.ID) && first.WorkspaceID == second.WorkspaceID && first.Profile == second.Profile && first.Disclosure == second.Disclosure
}

func consentResolveError(err error) error {
	if errors.Is(err, ErrSessionRejected) || errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrWindowUnavailable) {
		return err
	}
	return ErrEmbeddingConsentUnavailable
}

func consentCallError(ctx context.Context, err error) error {
	return managementCallError(ctx, ErrEmbeddingConsentUnavailable, err)
}
