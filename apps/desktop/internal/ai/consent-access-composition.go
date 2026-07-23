package ai

type consentAccessGateProvider interface {
	ConsentAccessGate() *ConsentAccessGate
}

func validateConsentAccessComposition(dependencies Dependencies) error {
	if nilLike(dependencies.ConsentAccess) {
		return ErrInvalidInput
	}
	provider, exposed := dependencies.Runtimes.(consentAccessGateProvider)
	if exposed && provider.ConsentAccessGate() != dependencies.ConsentAccess {
		return ErrInvalidInput
	}
	return nil
}
