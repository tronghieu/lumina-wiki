package providers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

const MaxUsageTokens = 1_000_000_000

func streamResponse(ctx context.Context, client SafeClient, request *http.Request, sink StreamSink, callback func(SSEEvent) error, gemini bool, now func() time.Time) error {
	if sink == nil {
		return NewSafeError("invalid_sink", "The provider stream sink is invalid.", nil)
	}
	var response *http.Response
	var err error
	if gemini {
		response, err = client.doGeminiSSE(request)
	} else {
		response, err = client.Do(request)
	}
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		drainAndClose(response.Body)
		if now == nil {
			now = time.Now
		}
		return statusErrorAt(response.StatusCode, response.Header.Get("Retry-After"), now())
	}
	defer response.Body.Close()
	mediaType, _, parseErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if parseErr != nil || !strings.EqualFold(mediaType, "text/event-stream") {
		return NewSafeError("invalid_content_type", "The provider returned an invalid stream response.", nil)
	}
	if err = ParseSSE(ctx, response.Body, Limits{}, callback); err != nil {
		return sanitizeAdapterError(err)
	}
	return nil
}

func emit(ctx context.Context, sink StreamSink, event StreamEvent) error {
	if err := sink.OnEvent(ctx, event); err != nil {
		return err
	}
	return ctx.Err()
}

func malformed() error {
	return NewSafeError("malformed_stream", "The provider returned a malformed stream.", nil)
}
func incomplete() error {
	return NewSafeError("incomplete_response", "The provider response was incomplete.", nil)
}
func providerFailure() error {
	return NewSafeError("provider_failed", "The provider could not complete the response.", nil)
}
func emptyCompletion() error {
	return NewSafeError("empty_completion", "The provider returned no usable text.", nil)
}
func sanitizeAdapterError(err error) error {
	var safe *SafeError
	if errors.As(err, &safe) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if errors.Is(err, io.EOF) {
		return incomplete()
	}
	return NewSafeError("stream_handler", "The provider stream could not be processed.", err)
}

func decodeStrict(data string, target any) error {
	d := json.NewDecoder(strings.NewReader(data))
	if err := d.Decode(target); err != nil {
		return malformed()
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return malformed()
	}
	return nil
}

func nonnegative(values ...int) bool {
	for _, value := range values {
		if value < 0 {
			return false
		}
	}
	return true
}
func validUsageCounts(input, output, total *int) bool {
	if input == nil || output == nil || total == nil || !nonnegative(*input, *output, *total) || *input > MaxUsageTokens || *output > MaxUsageTokens || *total > MaxUsageTokens {
		return false
	}
	return *input <= int(^uint(0)>>1)-*output && *total == *input+*output
}

func boundedUsageValue(value int) bool { return value >= 0 && value <= MaxUsageTokens }
func checkedUsageTotal(input, output int) (int, bool) {
	if !boundedUsageValue(input) || !boundedUsageValue(output) || input > MaxUsageTokens-output {
		return 0, false
	}
	return input + output, true
}
func validSequence(previous *int, current *int) bool {
	if current == nil {
		return true
	}
	if *current < 0 || *previous >= 0 && *current <= *previous {
		return false
	}
	*previous = *current
	return true
}
