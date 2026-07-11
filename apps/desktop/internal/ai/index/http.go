package index

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func (adapter *embeddingAdapter) post(ctx context.Context, body any, header, prefix string, required bool) (*http.Response, error) {
	raw, err := json.Marshal(body)
	if err != nil || len(raw) > MaxEmbeddingRequestBytes {
		return nil, invalidRequest()
	}
	var secret []byte
	if adapter.profile.CredentialRef != "" {
		secret, err = adapter.options.Credentials.Get(ctx, adapter.profile.CredentialRef)
		defer zero(secret)
		if err != nil {
			return nil, sanitizedFailure("credential_unavailable", "The embedding credential is unavailable.", err)
		}
	}
	if required && len(secret) == 0 {
		return nil, providers.NewSafeError("credential_unavailable", "The embedding credential is unavailable.", nil)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, adapter.endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, invalidRequest()
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if len(secret) > 0 {
		request.Header.Set(header, prefix+string(secret))
	}
	response, err := adapter.options.Client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32<<10))
		_ = response.Body.Close()
		return nil, providers.NewSafeError("embedding_provider_status", "The embedding provider rejected the request.", nil)
	}
	return response, nil
}

func decodeJSON(ctx context.Context, body io.Reader, target any) error {
	raw, err := io.ReadAll(body)
	if err != nil {
		var safe *providers.SafeError
		if errors.As(err, &safe) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		return malformedResponse()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if rejectDuplicateJSONKeys(raw) != nil {
		return malformedResponse()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return malformedResponse()
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return malformedResponse()
	}
	return ctx.Err()
}

func zero(secret []byte) {
	for i := range secret {
		secret[i] = 0
	}
}

func sanitizedFailure(code, message string, err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return providers.NewSafeError(code, message, nil)
}
