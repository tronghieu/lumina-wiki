package providers

import (
	"context"
	"strings"
)

type compatibleAdapter struct{ config adapterConfig }
type compatibleMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type compatibleRequest struct {
	Model         string `json:"model"`
	Stream        bool   `json:"stream"`
	StreamOptions struct {
		IncludeUsage bool `json:"include_usage"`
	} `json:"stream_options"`
	Messages  []compatibleMessage `json:"messages"`
	MaxTokens int                 `json:"max_tokens,omitempty"`
}

func (a *compatibleAdapter) Stream(ctx context.Context, request ProviderRequest, sink StreamSink) error {
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
	endpoint, err := a.config.endpoint("/chat/completions")
	if err != nil {
		return err
	}
	body := compatibleRequest{Model: request.Model, Stream: true, MaxTokens: request.MaxOutputTokens}
	body.StreamOptions.IncludeUsage = true
	if request.System != "" {
		body.Messages = append(body.Messages, compatibleMessage{Role: "system", Content: request.System})
	}
	for _, turn := range request.Turns {
		body.Messages = append(body.Messages, compatibleMessage{Role: turn.Role, Content: turn.Content})
	}
	httpRequest, err := a.config.request(ctx, endpoint, body, "Authorization", "Bearer ", true)
	if err != nil {
		return err
	}
	state := compatibleState{ctx: ctx, sink: sink}
	err = streamResponse(ctx, a.config.client, httpRequest, sink, state.accept, false)
	if err != nil {
		return err
	}
	if !state.done || !state.finished {
		return incomplete()
	}
	if !state.output {
		return emptyCompletion()
	}
	return nil
}

type compatibleState struct {
	ctx       context.Context
	sink      StreamSink
	done      bool
	finished  bool
	usageSeen bool
	output    bool
}
type compatibleChunk struct {
	Choices *[]struct {
		Delta *struct {
			Content *string `json:"content"`
			Refusal *string `json:"refusal"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		Input  *int `json:"prompt_tokens"`
		Output *int `json:"completion_tokens"`
		Total  *int `json:"total_tokens"`
	} `json:"usage"`
}

func (s *compatibleState) accept(event SSEEvent) error {
	if s.done {
		return malformed()
	}
	if strings.TrimSpace(event.Data) == "[DONE]" {
		s.done = true
		return nil
	}
	var chunk compatibleChunk
	if jsonUnmarshal(event.Data, &chunk) != nil || chunk.Choices == nil && chunk.Usage == nil || chunk.Choices != nil && len(*chunk.Choices) > 8 {
		return malformed()
	}
	if s.usageSeen {
		return malformed()
	}
	next := *s
	var buffered []StreamEvent
	if s.finished {
		if chunk.Usage == nil || chunk.Choices != nil && len(*chunk.Choices) != 0 {
			return malformed()
		}
		usage, ok := normalizedCompatibleUsage(chunk.Usage)
		if !ok {
			return malformed()
		}
		next.usageSeen = true
		buffered = append(buffered, usage)
		return s.commit(buffered, next)
	}
	finishInChunk := false
	if chunk.Choices != nil {
		for _, choice := range *chunk.Choices {
			if finishInChunk || choice.Delta == nil {
				return malformed()
			}
			if choice.Delta.Content != nil && *choice.Delta.Content != "" {
				next.output = true
				buffered = append(buffered, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: *choice.Delta.Content}})
			}
			if choice.Delta.Refusal != nil && *choice.Delta.Refusal != "" {
				next.output = true
				buffered = append(buffered, StreamEvent{Kind: EventRefusal, Refusal: &Refusal{Message: *choice.Delta.Refusal}})
			}
			if choice.FinishReason != nil {
				if *choice.FinishReason == "" {
					return malformed()
				}
				next.finished, finishInChunk = true, true
			}
		}
	}
	if chunk.Usage != nil {
		if !next.finished {
			return malformed()
		}
		usage, ok := normalizedCompatibleUsage(chunk.Usage)
		if !ok {
			return malformed()
		}
		next.usageSeen = true
		buffered = append(buffered, usage)
	}
	return s.commit(buffered, next)
}

func normalizedCompatibleUsage(usage *struct {
	Input  *int `json:"prompt_tokens"`
	Output *int `json:"completion_tokens"`
	Total  *int `json:"total_tokens"`
}) (StreamEvent, bool) {
	if !validUsageCounts(usage.Input, usage.Output, usage.Total) {
		return StreamEvent{}, false
	}
	return StreamEvent{Kind: EventUsage, Usage: &Usage{InputTokens: *usage.Input, OutputTokens: *usage.Output, TotalTokens: *usage.Total}}, true
}

func (s *compatibleState) commit(events []StreamEvent, next compatibleState) error {
	for _, event := range events {
		if err := emit(s.ctx, s.sink, event); err != nil {
			return err
		}
	}
	*s = next
	return nil
}
