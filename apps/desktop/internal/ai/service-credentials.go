package ai

import (
	"context"
	"errors"
	"regexp"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
)

var (
	challengeNoncePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,256}$`)
)

func (service *Service) CredentialStatus(ctx context.Context, request CredentialReferenceDTO) (CredentialStatusDTO, error) {
	if err := validCredentialCall(ctx, request.CredentialRef); err != nil {
		return CredentialStatusDTO{}, err
	}
	status, err := service.credentials.Status(ctx, request.CredentialRef)
	if err != nil {
		return CredentialStatusDTO{}, credentialBackendError(ctx, err)
	}
	if !knownCredentialStatus(status) {
		return CredentialStatusDTO{}, ErrCredentialUnavailable
	}
	return CredentialStatusDTO{Status: string(status)}, nil
}

func (service *Service) SaveCredential(ctx context.Context, request SaveCredentialRequestDTO) (CredentialSaveResultDTO, error) {
	defer zeroSecret(request.Secret)
	if err := validCredentialCall(ctx, request.CredentialRef); err != nil {
		return CredentialSaveResultDTO{}, err
	}
	secret, err := copiedSecret(request.Secret)
	if err != nil {
		return CredentialSaveResultDTO{}, err
	}
	defer zeroSecret(secret)
	result, err := service.credentials.Save(ctx, request.CredentialRef, secret)
	if err != nil {
		return CredentialSaveResultDTO{}, credentialBackendError(ctx, err)
	}
	return credentialSaveDTO(result)
}

func (service *Service) ConfirmSessionCredential(ctx context.Context, request ConfirmSessionCredentialRequestDTO) (CredentialStatusDTO, error) {
	defer zeroSecret(request.Secret)
	if err := validFacadeContext(ctx); err != nil {
		return CredentialStatusDTO{}, err
	}
	if !challengeNoncePattern.MatchString(request.Nonce) {
		return CredentialStatusDTO{}, ErrInvalidInput
	}
	secret, err := copiedSecret(request.Secret)
	if err != nil {
		return CredentialStatusDTO{}, err
	}
	defer zeroSecret(secret)
	if err := service.credentials.ConfirmSessionCredential(ctx, request.Nonce, secret); err != nil {
		return CredentialStatusDTO{}, credentialBackendError(ctx, err)
	}
	return CredentialStatusDTO{Status: string(secrets.StatusSessionOnly)}, nil
}

func (service *Service) DeleteCredential(ctx context.Context, request CredentialReferenceDTO) (CredentialDeleteResultDTO, error) {
	if err := validCredentialCall(ctx, request.CredentialRef); err != nil {
		return CredentialDeleteResultDTO{}, err
	}
	if err := service.credentials.Delete(ctx, request.CredentialRef); err != nil {
		return CredentialDeleteResultDTO{}, credentialBackendError(ctx, err)
	}
	return CredentialDeleteResultDTO{Deleted: true, Status: string(secrets.StatusMissing)}, nil
}

func credentialSaveDTO(result secrets.SaveResult) (CredentialSaveResultDTO, error) {
	dto := CredentialSaveResultDTO{Disposition: string(result.Disposition)}
	switch result.Disposition {
	case secrets.SavePersisted:
		if result.Challenge != nil {
			return CredentialSaveResultDTO{}, ErrCredentialUnavailable
		}
	case secrets.SaveSessionConfirmationRequired:
		challenge := result.Challenge
		if challenge == nil || !challengeNoncePattern.MatchString(challenge.Nonce) || !challengeReasonAllowed(challenge.Reason) || challenge.ExpiresAt.IsZero() {
			return CredentialSaveResultDTO{}, ErrCredentialUnavailable
		}
		dto.Challenge = &CredentialChallengeDTO{Nonce: challenge.Nonce, Reason: string(challenge.Reason), ExpiresAt: challenge.ExpiresAt}
	default:
		return CredentialSaveResultDTO{}, ErrCredentialUnavailable
	}
	return dto, nil
}

func validCredentialCall(ctx context.Context, ref string) error {
	if err := validFacadeContext(ctx); err != nil {
		return err
	}
	if !validCredentialReference(ref, false) {
		return ErrInvalidInput
	}
	return nil
}

func copiedSecret(source []byte) ([]byte, error) {
	if len(source) == 0 || len(source) > secrets.MaxSecretBytes {
		return nil, ErrInvalidInput
	}
	return append([]byte(nil), source...), nil
}

func zeroSecret(secret []byte) {
	for index := range secret {
		secret[index] = 0
	}
}

func credentialBackendError(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return ErrCredentialUnavailable
}

func knownCredentialStatus(status secrets.CredentialStatus) bool {
	switch status {
	case secrets.StatusMissing, secrets.StatusPersisted, secrets.StatusSessionOnly, secrets.StatusLocked,
		secrets.StatusDenied, secrets.StatusUnavailable, secrets.StatusUnsupported, secrets.StatusFailure:
		return true
	default:
		return false
	}
}

func challengeReasonAllowed(status secrets.CredentialStatus) bool {
	return status == secrets.StatusLocked || status == secrets.StatusDenied ||
		status == secrets.StatusUnavailable || status == secrets.StatusUnsupported
}
