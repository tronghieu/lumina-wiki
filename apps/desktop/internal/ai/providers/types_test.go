package providers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestLimitsDefaultsAndValidation(t *testing.T) {
	l := (Limits{}).WithDefaults()
	if l.MaxLineBytes == 0 || l.MaxEventBytes == 0 || l.MaxTotalBytes == 0 || l.MaxEvents == 0 {
		t.Fatal("defaults must be bounded")
	}
	if err := l.Validate(); err != nil {
		t.Fatal(err)
	}
	l.MaxLineBytes = MaxSSELineBytes + 1
	if err := l.Validate(); err == nil {
		t.Fatal("expected excessive line limit rejection")
	}
}

func TestSafeErrorNeverIncludesCause(t *testing.T) {
	err := NewSafeError("endpoint_rejected", "The provider endpoint is not allowed.", errors.New("secret https://private.invalid?q=token"))
	if err.Code != "endpoint_rejected" || err.Message == "" {
		t.Fatalf("unexpected safe error: %#v", err)
	}
	for _, forbidden := range []string{"secret", "private.invalid", "token"} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("error leaked %q: %v", forbidden, err)
		}
	}
	if err.Cause() != nil {
		t.Fatal("safe error must not retain an unsafe cause")
	}
	canceled := NewSafeError("canceled", "Canceled.", context.Canceled)
	if !errors.Is(canceled, context.Canceled) {
		t.Fatal("context cancellation identity must be preserved")
	}
}

type contractProvider struct{}

func (contractProvider) Stream(ctx context.Context, _ ChatRequest, sink StreamSink) error {
	return sink.OnEvent(ctx, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: "ok"}})
}

func TestProviderContractsAreContextAware(t *testing.T) {
	var _ ChatProvider = contractProvider{}
	var got string
	sink := StreamSinkFunc(func(_ context.Context, event StreamEvent) error { got = event.Delta.Text; return nil })
	if err := (contractProvider{}).Stream(context.Background(), ChatRequest{}, sink); err != nil || got != "ok" {
		t.Fatal("contract failed")
	}
}

func TestSafeFailureCanonicalizesWrappedContextErrors(t *testing.T) {
	for _, cause := range []error{fmt.Errorf("secret: %w", context.Canceled), fmt.Errorf("secret: %w", context.DeadlineExceeded)} {
		err := safeFailure("x", "safe", cause)
		if err != context.Canceled && err != context.DeadlineExceeded {
			t.Fatalf("not canonical: %#v", err)
		}
		if strings.Contains(err.Error(), "secret") {
			t.Fatal("leaked wrapper")
		}
	}
}
