package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func (service *Service) IndexStatus(ctx context.Context, request IndexRequestDTO) (IndexStatusDTO, error) {
	return service.indexStatusCall(ctx, request, true, func(runtime managementCapableRuntime) (index.IndexStatus, error) {
		return runtime.IndexStatus(ctx, request.EmbeddingProfileID)
	})
}

func (service *Service) BuildIndex(ctx context.Context, request IndexRequestDTO) (IndexStatusDTO, error) {
	return service.indexStatusCall(ctx, request, false, func(runtime managementCapableRuntime) (index.IndexStatus, error) {
		return runtime.BuildIndex(ctx, request.EmbeddingProfileID)
	})
}

func (service *Service) ClearIndex(ctx context.Context, request IndexRequestDTO) (IndexStatusDTO, error) {
	return service.indexStatusCall(ctx, request, false, func(runtime managementCapableRuntime) (index.IndexStatus, error) {
		return runtime.ClearIndex(ctx, request.EmbeddingProfileID)
	})
}

func (service *Service) CancelIndex(ctx context.Context, request IndexRequestDTO) (IndexCancelResultDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, request.Session)
	if err != nil {
		return IndexCancelResultDTO{}, managementResolveError(err, ErrIndexUnavailable)
	}
	defer lease.Finish()
	if !validIndexProfileID(request.EmbeddingProfileID) {
		return IndexCancelResultDTO{}, ErrInvalidInput
	}
	cancelled, err := runtime.CancelIndex(ctx, request.EmbeddingProfileID)
	if err != nil {
		return IndexCancelResultDTO{}, indexCallError(ctx, err)
	}
	return IndexCancelResultDTO{Cancelled: cancelled}, nil
}

func (service *Service) indexStatusCall(ctx context.Context, request IndexRequestDTO, allowEmpty bool,
	call func(managementCapableRuntime) (index.IndexStatus, error)) (IndexStatusDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, request.Session)
	if err != nil {
		return IndexStatusDTO{}, managementResolveError(err, ErrIndexUnavailable)
	}
	defer lease.Finish()
	if request.EmbeddingProfileID == "" && !allowEmpty || request.EmbeddingProfileID != "" && !validIndexProfileID(request.EmbeddingProfileID) {
		return IndexStatusDTO{}, ErrInvalidInput
	}
	status, err := call(runtime)
	if err != nil {
		return IndexStatusDTO{}, indexCallError(ctx, err)
	}
	if !validIndexStatus(status, status.Chunks, status.Dimensions) {
		return IndexStatusDTO{}, ErrIndexUnavailable
	}
	return IndexStatusDTO{State: string(status.State), Chunks: status.Chunks, Vectors: status.Vectors, Dimensions: status.Dimensions}, nil
}

func validIndexProfileID(value string) bool {
	return len(value) <= settings.MaxProfileIDBytes && profileIDPattern.MatchString(value)
}

func indexCallError(ctx context.Context, err error) error {
	if errors.Is(err, ErrIndexBuildActive) {
		return ErrIndexBuildActive
	}
	return managementCallError(ctx, ErrIndexUnavailable, err)
}
