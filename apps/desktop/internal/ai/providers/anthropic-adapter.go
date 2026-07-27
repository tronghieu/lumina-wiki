package providers

import "context"

type anthropicAdapter struct{ config adapterConfig }
type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	Stream    bool               `json:"stream"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
}

func (a *anthropicAdapter) Stream(ctx context.Context, request ProviderRequest, sink StreamSink) error {
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
	endpoint, err := a.config.endpoint("/messages")
	if err != nil {
		return err
	}
	body := anthropicRequest{Model: request.Model, MaxTokens: request.MaxOutputTokens, Stream: true, System: request.System}
	if body.MaxTokens == 0 {
		body.MaxTokens = a.config.profile.MaxOutputTokens
	}
	for _, turn := range request.Turns {
		body.Messages = append(body.Messages, anthropicMessage{Role: turn.Role, Content: turn.Content})
	}
	httpRequest, err := a.config.request(ctx, endpoint, body, "X-Api-Key", "", false)
	if err != nil {
		return err
	}
	httpRequest.Header.Set("Anthropic-Version", "2023-06-01")
	httpRequest.Header.Del("Anthropic-Beta")
	state := anthropicState{ctx: ctx, sink: sink, blocks: map[int]bool{}}
	err = streamResponse(ctx, a.config.client, httpRequest, sink, state.accept, false, a.config.now)
	if err != nil {
		return err
	}
	if !state.started || state.terminals != 1 || len(state.blocks) != 0 {
		return incomplete()
	}
	return nil
}

type anthropicState struct {
	ctx                                  context.Context
	sink                                 StreamSink
	started, deltaSeen, messageDelta     bool
	terminals, inputTokens, outputTokens int
	blocks                               map[int]bool
}
type anthropicEnvelope struct {
	Type string `json:"type"`
}
type anthropicStart struct {
	Type    string `json:"type"`
	Message struct {
		Usage struct {
			InputTokens *int `json:"input_tokens"`
		} `json:"usage"`
	} `json:"message"`
}
type anthropicBlock struct {
	Type         string `json:"type"`
	Index        *int   `json:"index"`
	ContentBlock *struct {
		Type string `json:"type"`
	} `json:"content_block"`
}
type anthropicDelta struct {
	Type  string `json:"type"`
	Index *int   `json:"index"`
	Delta *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"delta"`
}
type anthropicMessageDelta struct {
	Type  string `json:"type"`
	Delta *struct {
		StopReason *string `json:"stop_reason"`
	} `json:"delta"`
	Usage *struct {
		OutputTokens *int `json:"output_tokens"`
	} `json:"usage"`
}

func (s *anthropicState) accept(event SSEEvent) error {
	if event.Event != "message" && !knownAnthropicEvent(event.Event) {
		return nil
	}
	var envelope anthropicEnvelope
	if jsonUnmarshal(event.Data, &envelope) != nil || envelope.Type == "" {
		return malformed()
	}
	if event.Event == "error" || envelope.Type == "error" {
		return providerFailure()
	}
	if event.Event != "message" && event.Event != envelope.Type {
		return malformed()
	}
	if s.terminals > 0 {
		return malformed()
	}
	switch envelope.Type {
	case "message_start":
		var value anthropicStart
		if s.started || jsonUnmarshal(event.Data, &value) != nil || value.Message.Usage.InputTokens == nil || !boundedUsageValue(*value.Message.Usage.InputTokens) {
			return malformed()
		}
		s.started = true
		s.inputTokens = *value.Message.Usage.InputTokens
	case "content_block_start":
		var value anthropicBlock
		if !s.started || jsonUnmarshal(event.Data, &value) != nil || value.Index == nil || *value.Index < 0 || *value.Index > 1024 || value.ContentBlock == nil || value.ContentBlock.Type == "" || s.blocks[*value.Index] {
			return malformed()
		}
		s.blocks[*value.Index] = true
	case "content_block_delta":
		var value anthropicDelta
		if !s.started || jsonUnmarshal(event.Data, &value) != nil || value.Index == nil || value.Delta == nil || !s.blocks[*value.Index] {
			return malformed()
		}
		if value.Delta.Type == "" {
			return malformed()
		}
		if value.Delta.Type == "text_delta" {
			if value.Delta.Text == "" {
				return malformed()
			}
			s.deltaSeen = true
			return emit(s.ctx, s.sink, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: value.Delta.Text}})
		}
	case "content_block_stop":
		var value anthropicBlock
		if !s.started || jsonUnmarshal(event.Data, &value) != nil || value.Index == nil || !s.blocks[*value.Index] {
			return malformed()
		}
		delete(s.blocks, *value.Index)
	case "message_delta":
		var value anthropicMessageDelta
		if !s.started || s.messageDelta || len(s.blocks) != 0 || jsonUnmarshal(event.Data, &value) != nil || value.Delta == nil || value.Delta.StopReason == nil || *value.Delta.StopReason == "" || value.Usage == nil || value.Usage.OutputTokens == nil || !boundedUsageValue(*value.Usage.OutputTokens) {
			return malformed()
		}
		s.messageDelta = true
		s.outputTokens = *value.Usage.OutputTokens
		if value.Delta.StopReason != nil && *value.Delta.StopReason == "refusal" {
			return emit(s.ctx, s.sink, StreamEvent{Kind: EventRefusal, Refusal: &Refusal{Message: "The provider refused the request."}})
		}
	case "message_stop":
		if !s.started || !s.messageDelta || len(s.blocks) != 0 {
			return malformed()
		}
		total, ok := checkedUsageTotal(s.inputTokens, s.outputTokens)
		if !ok {
			return malformed()
		}
		s.terminals++
		return emit(s.ctx, s.sink, StreamEvent{Kind: EventUsage, Usage: &Usage{InputTokens: s.inputTokens, OutputTokens: s.outputTokens, TotalTokens: total}})
	default:
		// Ping and future event types are ignored.
	}
	return nil
}

func knownAnthropicEvent(value string) bool {
	switch value {
	case "message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop", "error":
		return true
	default:
		return false
	}
}
