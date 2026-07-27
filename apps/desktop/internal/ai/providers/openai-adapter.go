package providers

import (
	"context"
)

type openAIAdapter struct{ config adapterConfig }

type openAIInput struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type openAIRequest struct {
	Model           string        `json:"model"`
	Stream          bool          `json:"stream"`
	Store           bool          `json:"store"`
	Instructions    string        `json:"instructions,omitempty"`
	Input           []openAIInput `json:"input"`
	MaxOutputTokens int           `json:"max_output_tokens,omitempty"`
}

func (a *openAIAdapter) Stream(ctx context.Context, request ProviderRequest, sink StreamSink) error {
	var cancel context.CancelFunc
	var err error
	ctx, cancel, err = a.config.streamContext(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	if err := a.config.validateRequest(request); err != nil {
		return err
	}
	endpoint, err := a.config.endpoint("/responses")
	if err != nil {
		return err
	}
	body := openAIRequest{Model: request.Model, Stream: true, Store: false, Instructions: request.System, MaxOutputTokens: request.MaxOutputTokens}
	for _, turn := range request.Turns {
		body.Input = append(body.Input, openAIInput{Role: turn.Role, Content: turn.Content})
	}
	httpRequest, err := a.config.request(ctx, endpoint, body, "Authorization", "Bearer ", false)
	if err != nil {
		return err
	}
	state := openAIState{ctx: ctx, sink: sink, sequence: -1}
	err = streamResponse(ctx, a.config.client, httpRequest, sink, state.accept, false, a.config.now)
	if err != nil {
		return err
	}
	if state.terminals != 1 {
		return incomplete()
	}
	return nil
}

type openAIState struct {
	ctx                 context.Context
	sink                StreamSink
	sequence, terminals int
}
type openAIEnvelope struct {
	Type string `json:"type"`
}
type openAIDelta struct {
	Type     string `json:"type"`
	Sequence *int   `json:"sequence_number,omitempty"`
	Delta    string `json:"delta"`
}
type openAIUsage struct {
	InputTokens  *int `json:"input_tokens"`
	OutputTokens *int `json:"output_tokens"`
	TotalTokens  *int `json:"total_tokens"`
}
type openAITerminal struct {
	Type     string `json:"type"`
	Sequence *int   `json:"sequence_number"`
}
type openAICompleted struct {
	Type     string `json:"type"`
	Sequence *int   `json:"sequence_number,omitempty"`
	Response *struct {
		Usage *openAIUsage `json:"usage"`
	} `json:"response"`
}

func (s *openAIState) accept(event SSEEvent) error {
	var envelope openAIEnvelope
	if err := decodeKnownEnvelope(event.Data, &envelope); err != nil {
		return err
	}
	if s.terminals > 0 {
		return malformed()
	}
	switch envelope.Type {
	case "response.output_text.delta", "response.refusal.delta":
		var value openAIDelta
		if err := decodeStrict(event.Data, &value); err != nil || value.Sequence == nil || value.Delta == "" || !validSequence(&s.sequence, value.Sequence) {
			return malformed()
		}
		if envelope.Type == "response.output_text.delta" {
			return emit(s.ctx, s.sink, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: value.Delta}})
		}
		return emit(s.ctx, s.sink, StreamEvent{Kind: EventRefusal, Refusal: &Refusal{Message: value.Delta}})
	case "response.completed":
		var value openAICompleted
		if err := decodeStrict(event.Data, &value); err != nil || value.Sequence == nil || value.Response == nil || value.Response.Usage == nil || !validSequence(&s.sequence, value.Sequence) || !validUsageCounts(value.Response.Usage.InputTokens, value.Response.Usage.OutputTokens, value.Response.Usage.TotalTokens) {
			return malformed()
		}
		s.terminals++
		u := value.Response.Usage
		return emit(s.ctx, s.sink, StreamEvent{Kind: EventUsage, Usage: &Usage{InputTokens: *u.InputTokens, OutputTokens: *u.OutputTokens, TotalTokens: *u.TotalTokens}})
	case "response.failed", "error":
		var value openAITerminal
		if decodeStrict(event.Data, &value) != nil || value.Sequence == nil || !validSequence(&s.sequence, value.Sequence) {
			return malformed()
		}
		s.terminals++
		return providerFailure()
	case "response.incomplete":
		var value openAITerminal
		if decodeStrict(event.Data, &value) != nil || value.Sequence == nil || !validSequence(&s.sequence, value.Sequence) {
			return malformed()
		}
		s.terminals++
		return incomplete()
	default:
		return nil
	}
}

func decodeKnownEnvelope(data string, target *openAIEnvelope) error {
	// Unknown fields are intentionally ignored until a known event selects its strict schema.
	if err := jsonUnmarshal(data, target); err != nil || target.Type == "" {
		return malformed()
	}
	return nil
}
