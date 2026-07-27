package ai

import (
	"context"
	"errors"
)

func (service *Service) WorkspaceTree(ctx context.Context, reference SessionReferenceDTO) (WorkspaceTreeDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, reference)
	if err != nil {
		return WorkspaceTreeDTO{}, managementResolveError(err, ErrWorkspaceTreeUnavailable)
	}
	defer lease.Finish()
	tree, err := runtime.WorkspaceTree(ctx)
	if err != nil {
		return WorkspaceTreeDTO{}, managementCallError(ctx, ErrWorkspaceTreeUnavailable, err)
	}
	dto, err := workspaceTreeDTO(tree)
	if err != nil {
		return WorkspaceTreeDTO{}, ErrWorkspaceTreeUnavailable
	}
	return dto, nil
}

func (service *Service) HistoryStatus(ctx context.Context, reference SessionReferenceDTO) (HistoryStatusDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, reference)
	if err != nil {
		return HistoryStatusDTO{}, managementResolveError(err, ErrHistoryUnavailable)
	}
	defer lease.Finish()
	enabled, err := runtime.HistoryEnabled(ctx)
	if err != nil {
		return HistoryStatusDTO{}, managementCallError(ctx, ErrHistoryUnavailable, err)
	}
	return HistoryStatusDTO{Enabled: enabled}, nil
}

func (service *Service) SetHistoryEnabled(ctx context.Context, request SetHistoryEnabledRequestDTO) (HistoryStatusDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, request.Session)
	if err != nil {
		return HistoryStatusDTO{}, managementResolveError(err, ErrHistoryUnavailable)
	}
	defer lease.Finish()
	if err := runtime.SetHistoryEnabled(ctx, request.Enabled); err != nil {
		return HistoryStatusDTO{}, managementCallError(ctx, ErrHistoryUnavailable, err)
	}
	return HistoryStatusDTO{Enabled: request.Enabled}, nil
}

func (service *Service) ListHistory(ctx context.Context, reference SessionReferenceDTO) (HistoryListDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, reference)
	if err != nil {
		return HistoryListDTO{}, managementResolveError(err, ErrHistoryUnavailable)
	}
	defer lease.Finish()
	metadata, err := runtime.ListHistory(ctx)
	if err != nil {
		return HistoryListDTO{}, managementCallError(ctx, ErrHistoryUnavailable, err)
	}
	dto, err := historyListDTO(metadata)
	if err != nil {
		return HistoryListDTO{}, ErrHistoryUnavailable
	}
	return dto, nil
}

func (service *Service) LoadHistory(ctx context.Context, request HistoryConversationRequestDTO) (HistoryRecordsDTO, error) {
	if !validFacadeID(request.ConversationID) {
		return HistoryRecordsDTO{}, ErrInvalidInput
	}
	runtime, lease, err := service.resolveManagement(ctx, request.Session)
	if err != nil {
		return HistoryRecordsDTO{}, managementResolveError(err, ErrHistoryUnavailable)
	}
	defer lease.Finish()
	records, err := runtime.LoadHistory(ctx, request.ConversationID)
	if err != nil {
		return HistoryRecordsDTO{}, managementCallError(ctx, ErrHistoryUnavailable, err)
	}
	dto, err := historyRecordsDTO(records, request.ConversationID)
	if err != nil {
		return HistoryRecordsDTO{}, ErrHistoryUnavailable
	}
	return dto, nil
}

func (service *Service) DeleteHistory(ctx context.Context, request HistoryConversationRequestDTO) (HistoryDeleteResultDTO, error) {
	if !validFacadeID(request.ConversationID) {
		return HistoryDeleteResultDTO{}, ErrInvalidInput
	}
	runtime, lease, err := service.resolveManagement(ctx, request.Session)
	if err != nil {
		return HistoryDeleteResultDTO{}, managementResolveError(err, ErrHistoryUnavailable)
	}
	defer lease.Finish()
	result, err := runtime.DeleteHistory(ctx, request.ConversationID)
	if validateHistoryDeleteOutcome(result, err != nil) != nil {
		return HistoryDeleteResultDTO{}, ErrHistoryUnavailable
	}
	dto := HistoryDeleteResultDTO{Removed: result.Removed, Durable: result.Durable}
	if err != nil {
		return dto, managementCallError(ctx, ErrHistoryUnavailable, err)
	}
	return dto, nil
}

func (service *Service) DeleteAllHistory(ctx context.Context, reference SessionReferenceDTO) (HistoryDeleteAllResultDTO, error) {
	runtime, lease, err := service.resolveManagement(ctx, reference)
	if err != nil {
		return HistoryDeleteAllResultDTO{}, managementResolveError(err, ErrHistoryUnavailable)
	}
	defer lease.Finish()
	result, callErr := runtime.DeleteAllHistory(ctx)
	dto, convertErr := historyDeleteAllDTO(result, callErr != nil)
	if convertErr != nil {
		if errors.Is(convertErr, errHistoryDeleteOutcomeMismatch) {
			return HistoryDeleteAllResultDTO{}, ErrHistoryUnavailable
		}
		if callErr != nil {
			return HistoryDeleteAllResultDTO{}, managementCallError(ctx, ErrHistoryUnavailable, callErr)
		}
		return HistoryDeleteAllResultDTO{}, ErrHistoryUnavailable
	}
	if callErr != nil {
		return dto, managementCallError(ctx, ErrHistoryUnavailable, callErr)
	}
	return dto, nil
}

func managementResolveError(err, unavailable error) error {
	if err == ErrHistoryUnavailable {
		return unavailable
	}
	return err
}
