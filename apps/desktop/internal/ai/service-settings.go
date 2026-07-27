package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func (service *Service) ListAIProfiles(ctx context.Context) (AIProfilesDTO, error) {
	if err := validFacadeContext(ctx); err != nil {
		return AIProfilesDTO{}, err
	}
	service.settingsMu.Lock()
	if err := ctx.Err(); err != nil {
		service.settingsMu.Unlock()
		return AIProfilesDTO{}, err
	}
	defer service.settingsMu.Unlock()
	config, err := service.settings.Load()
	if err != nil {
		return AIProfilesDTO{}, facadeError(ctx, ErrSettingsUnavailable)
	}
	if err := ctx.Err(); err != nil {
		return AIProfilesDTO{}, err
	}
	normalized, err := config.Normalized()
	if err != nil {
		return AIProfilesDTO{}, ErrSettingsUnavailable
	}
	return AIProfilesDTO{Chat: profileDTO(normalized.Chat), Embedding: profileDTO(normalized.Embedding)}, nil
}

func (service *Service) SaveAIProfile(ctx context.Context, request SaveAIProfileRequestDTO) (AIProfileDTO, error) {
	if err := validFacadeContext(ctx); err != nil {
		return AIProfileDTO{}, err
	}
	if !validCredentialReference(request.CredentialRef, true) {
		return AIProfileDTO{}, ErrInvalidInput
	}
	profile, err := request.profile().Normalized()
	if err != nil {
		return AIProfileDTO{}, ErrInvalidInput
	}
	service.settingsMu.Lock()
	if err := ctx.Err(); err != nil {
		service.settingsMu.Unlock()
		return AIProfileDTO{}, err
	}
	defer service.settingsMu.Unlock()
	config, err := service.settings.Load()
	if err != nil {
		return AIProfileDTO{}, facadeError(ctx, ErrSettingsUnavailable)
	}
	if err := ctx.Err(); err != nil {
		return AIProfileDTO{}, err
	}
	config, err = config.Normalized()
	if err != nil {
		return AIProfileDTO{}, ErrSettingsUnavailable
	}
	switch profile.Role {
	case settings.RoleChat:
		config.Chat = &profile
	case settings.RoleEmbedding:
		config.Embedding = &profile
	default:
		return AIProfileDTO{}, ErrInvalidInput
	}
	normalized, err := config.Normalized()
	if err != nil {
		return AIProfileDTO{}, ErrInvalidInput
	}
	if err := ctx.Err(); err != nil {
		return AIProfileDTO{}, err
	}
	if err := service.settings.Save(normalized); err != nil {
		return AIProfileDTO{}, facadeError(ctx, ErrSettingsUnavailable)
	}
	if profile.Role == settings.RoleChat {
		return *profileDTO(normalized.Chat), nil
	}
	return *profileDTO(normalized.Embedding), nil
}

func (service *Service) DeleteAIProfile(ctx context.Context, request DeleteAIProfileRequestDTO) (ProfileDeleteResultDTO, error) {
	result := ProfileDeleteResultDTO{Role: request.Role, ID: request.ID}
	if err := validFacadeContext(ctx); err != nil {
		return ProfileDeleteResultDTO{}, err
	}
	if !profileIDPattern.MatchString(request.ID) || request.Role != string(settings.RoleChat) && request.Role != string(settings.RoleEmbedding) {
		return ProfileDeleteResultDTO{}, ErrInvalidInput
	}
	service.settingsMu.Lock()
	if err := ctx.Err(); err != nil {
		service.settingsMu.Unlock()
		return ProfileDeleteResultDTO{}, err
	}
	defer service.settingsMu.Unlock()
	config, err := service.settings.Load()
	if err != nil {
		return ProfileDeleteResultDTO{}, facadeError(ctx, ErrSettingsUnavailable)
	}
	if err := ctx.Err(); err != nil {
		return ProfileDeleteResultDTO{}, err
	}
	config, err = config.Normalized()
	if err != nil {
		return ProfileDeleteResultDTO{}, ErrSettingsUnavailable
	}
	slot := config.Chat
	if request.Role == string(settings.RoleEmbedding) {
		slot = config.Embedding
	}
	if slot == nil || slot.ID != request.ID {
		return result, nil
	}
	if request.Role == string(settings.RoleChat) {
		config.Chat = nil
	} else {
		config.Embedding = nil
	}
	if err := ctx.Err(); err != nil {
		return ProfileDeleteResultDTO{}, err
	}
	if err := service.settings.Save(config); err != nil {
		return ProfileDeleteResultDTO{}, facadeError(ctx, ErrSettingsUnavailable)
	}
	result.Removed = true
	return result, nil
}

func validFacadeContext(ctx context.Context) error {
	if ctx == nil {
		return ErrInvalidInput
	}
	return ctx.Err()
}

func facadeError(ctx context.Context, fallback error) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	return fallback
}
