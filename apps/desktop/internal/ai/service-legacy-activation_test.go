package ai

import "context"

// These test-only adapters preserve coverage of the retired activation path
// without making raw filesystem activation available to renderer bindings.
func (service *Service) ChooseAndActivateWorkspace(ctx context.Context) (ActivationResult, error) {
	return service.chooseAndActivateWorkspace(ctx)
}

func (service *Service) ConfirmAndActivateWorkspace(
	ctx context.Context,
	typedRoot string,
) (ActivationResult, error) {
	return service.confirmAndActivateWorkspace(ctx, typedRoot)
}
