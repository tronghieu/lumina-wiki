package ai

import (
	"context"
	"errors"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func (service *Service) persistEmbeddingGrant(gate *activationLease, subject embeddingConsentSubject) (EmbeddingConsentResultDTO, error) {
	finishMutation, err := service.consentAccess.BeginMutation(gate.Context())
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	defer finishMutation()
	service.settingsMu.Lock()
	defer service.settingsMu.Unlock()
	if err := gate.Validate(); err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	config, err := service.currentConsentConfig(gate.Context(), subject)
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	now := service.now().UTC()
	if index.RequireConsent(config, subject.WorkspaceID, subject.Profile, now) == nil {
		subject.Granted = true
		return consentResult(subject), nil
	}
	original := cloneConsentConfig(config)
	config, err = index.StageConsent(config, subject.WorkspaceID, subject.Profile, now, time.Time{})
	if err != nil {
		return EmbeddingConsentResultDTO{}, ErrEmbeddingConsentUnavailable
	}
	if err := service.settings.Save(config); err != nil {
		return EmbeddingConsentResultDTO{}, facadeError(gate.Context(), ErrSettingsUnavailable)
	}
	if err := gate.Validate(); err != nil {
		return EmbeddingConsentResultDTO{}, restoreConsentConfig(service.settings, original, err)
	}
	config, err = index.CommitConsent(config, subject.WorkspaceID, subject.Profile)
	if err != nil {
		return EmbeddingConsentResultDTO{}, ErrEmbeddingConsentUnavailable
	}
	service.consentCommitMu.Lock()
	defer service.consentCommitMu.Unlock()
	if err := gate.Validate(); err != nil {
		return EmbeddingConsentResultDTO{}, restoreConsentConfig(service.settings, original, err)
	}
	finishCommit, err := gate.BeginCommit()
	if err != nil {
		return EmbeddingConsentResultDTO{}, restoreConsentConfig(service.settings, original, err)
	}
	if err := service.settings.Save(config); err != nil {
		finishCommit()
		return EmbeddingConsentResultDTO{}, ErrSettingsUnavailable
	}
	finishCommit()
	subject.Granted = true
	return consentResult(subject), nil
}

func (service *Service) persistEmbeddingRevoke(gate *activationLease, runtime managementCapableRuntime, subject embeddingConsentSubject) (EmbeddingConsentResultDTO, error) {
	ctx := gate.Context()
	service.settingsMu.Lock()
	defer service.settingsMu.Unlock()
	if err := gate.Validate(); err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	config, err := service.currentConsentConfig(ctx, subject)
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	original := cloneConsentConfig(config)
	if _, err := runtime.ClearIndexForConsent(ctx, subject.Profile.ID); err != nil {
		return EmbeddingConsentResultDTO{}, consentCallError(ctx, err)
	}
	if err := gate.Validate(); err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	now := service.now().UTC()
	if index.RequireConsent(config, subject.WorkspaceID, subject.Profile, now) != nil {
		subject.Granted = false
		return consentResult(subject), nil
	}
	config, err = index.RevokeConsent(config, subject.WorkspaceID, subject.Profile, now)
	if errors.Is(err, index.ErrConsentRequired) {
		subject.Granted = false
		return consentResult(subject), nil
	}
	if err != nil {
		return EmbeddingConsentResultDTO{}, ErrEmbeddingConsentUnavailable
	}
	if err := ctx.Err(); err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	finishCommit, err := gate.BeginCommit()
	if err != nil {
		return EmbeddingConsentResultDTO{}, err
	}
	if err := service.settings.Save(config); err != nil {
		finishCommit()
		return EmbeddingConsentResultDTO{}, facadeError(ctx, ErrSettingsUnavailable)
	}
	disposition := gate.CommitDisposition()
	finishCommit()
	if disposition != activationCommitDeliver {
		if err := service.settings.Save(original); err != nil {
			return EmbeddingConsentResultDTO{}, ErrSettingsUnavailable
		}
		if disposition == activationCommitWindowClosed {
			return EmbeddingConsentResultDTO{}, ErrWindowUnavailable
		}
		if err := gate.parent.Err(); err != nil {
			return EmbeddingConsentResultDTO{}, err
		}
		return EmbeddingConsentResultDTO{}, context.Canceled
	}
	subject.Granted = false
	return consentResult(subject), nil
}

func cloneConsentConfig(config settings.Config) settings.Config {
	config.EmbeddingConsents = append([]settings.EmbeddingConsentGrant(nil), config.EmbeddingConsents...)
	return config
}

func restoreConsentConfig(repository SettingsRepository, original settings.Config, cause error) error {
	if err := repository.Save(original); err != nil {
		return ErrSettingsUnavailable
	}
	return cause
}

func (service *Service) currentConsentConfig(ctx context.Context, subject embeddingConsentSubject) (settings.Config, error) {
	if err := ctx.Err(); err != nil {
		return settings.Config{}, err
	}
	config, err := service.settings.Load()
	if err != nil {
		return settings.Config{}, facadeError(ctx, ErrSettingsUnavailable)
	}
	config, err = config.Normalized()
	if err != nil || config.Embedding == nil || *config.Embedding != subject.Profile {
		return settings.Config{}, ErrEmbeddingConsentUnavailable
	}
	disclosure, err := index.ConsentFingerprint(subject.WorkspaceID, *config.Embedding)
	if err != nil || disclosure != subject.Disclosure {
		return settings.Config{}, ErrEmbeddingConsentUnavailable
	}
	return config, nil
}
