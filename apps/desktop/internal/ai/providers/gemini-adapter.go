package providers

import (
	"context"
	"net/url"
	"regexp"
)

var geminiModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`)

type geminiAdapter struct{ config adapterConfig }
type geminiPart struct {
	Text string `json:"text"`
}
type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}
type geminiRequest struct {
	SystemInstruction *geminiContent  `json:"system_instruction,omitempty"`
	Contents          []geminiContent `json:"contents"`
	GenerationConfig  struct {
		MaxOutputTokens int `json:"maxOutputTokens,omitempty"`
	} `json:"generationConfig"`
}

func (a *geminiAdapter) Stream(ctx context.Context, request ProviderRequest, sink StreamSink) error {
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
	if !geminiModelPattern.MatchString(request.Model) {
		return NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	endpoint, err := a.config.endpoint("/models/" + url.PathEscape(request.Model) + ":streamGenerateContent")
	if err != nil {
		return err
	}
	endpoint += "?alt=sse"
	body := geminiRequest{}
	body.GenerationConfig.MaxOutputTokens = request.MaxOutputTokens
	if request.System != "" {
		body.SystemInstruction = &geminiContent{Parts: []geminiPart{{Text: request.System}}}
	}
	for _, turn := range request.Turns {
		role := turn.Role
		if role == "assistant" {
			role = "model"
		}
		body.Contents = append(body.Contents, geminiContent{Role: role, Parts: []geminiPart{{Text: turn.Content}}})
	}
	httpRequest, err := a.config.request(ctx, endpoint, body, "X-Goog-Api-Key", "", false)
	if err != nil {
		return err
	}
	state := geminiState{ctx: ctx, sink: sink}
	err = streamResponse(ctx, a.config.client, httpRequest, sink, state.accept, true)
	if err != nil {
		return err
	}
	if state.terminals != 1 {
		return incomplete()
	}
	return nil
}

type geminiState struct {
	ctx       context.Context
	sink      StreamSink
	terminals int
}
type geminiCandidate struct {
	Content struct {
		Parts []struct {
			Text *string `json:"text"`
		} `json:"parts"`
	} `json:"content"`
	FinishReason string `json:"finishReason"`
}
type geminiUsage struct {
	Input    *int `json:"promptTokenCount"`
	Output   *int `json:"candidatesTokenCount"`
	Total    *int `json:"totalTokenCount"`
	Thoughts *int `json:"thoughtsTokenCount"`
	ToolUse  *int `json:"toolUsePromptTokenCount"`
	Cached   *int `json:"cachedContentTokenCount"`
}
type geminiResponse struct {
	Candidates     *[]geminiCandidate `json:"candidates"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	Usage *geminiUsage `json:"usageMetadata"`
}

func (s *geminiState) accept(event SSEEvent) error {
	if s.terminals > 0 {
		return malformed()
	}
	var value geminiResponse
	if jsonUnmarshal(event.Data, &value) != nil || value.Candidates == nil && value.PromptFeedback == nil && value.Usage == nil || value.Candidates != nil && len(*value.Candidates) > 8 || value.Usage != nil && !validGeminiUsage(value.Usage) {
		return malformed()
	}
	if value.PromptFeedback != nil && value.PromptFeedback.BlockReason != "" {
		s.terminals++
		if blockedGeminiReason(value.PromptFeedback.BlockReason) {
			return emit(s.ctx, s.sink, StreamEvent{Kind: EventRefusal, Refusal: &Refusal{Message: "The provider blocked the request."}})
		}
		return incomplete()
	}
	if value.Candidates == nil || len(*value.Candidates) == 0 {
		return nil
	}
	candidate := (*value.Candidates)[0]
	if len(candidate.Content.Parts) > 128 {
		return malformed()
	}
	for _, part := range candidate.Content.Parts {
		if part.Text != nil {
			if *part.Text == "" {
				continue
			}
			if err := emit(s.ctx, s.sink, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: *part.Text}}); err != nil {
				return err
			}
		}
	}
	if candidate.FinishReason == "" {
		return nil
	}
	s.terminals++
	if blockedGeminiReason(candidate.FinishReason) {
		return emit(s.ctx, s.sink, StreamEvent{Kind: EventRefusal, Refusal: &Refusal{Message: "The provider refused the request."}})
	}
	if candidate.FinishReason != "STOP" && candidate.FinishReason != "MAX_TOKENS" {
		return incomplete()
	}
	if value.Usage == nil {
		return malformed()
	}
	return emit(s.ctx, s.sink, StreamEvent{Kind: EventUsage, Usage: &Usage{InputTokens: *value.Usage.Input, OutputTokens: *value.Usage.Output, TotalTokens: *value.Usage.Total}})
}

func validGeminiUsage(usage *geminiUsage) bool {
	if usage == nil || usage.Input == nil || usage.Output == nil || usage.Total == nil {
		return false
	}
	values := []*int{usage.Input, usage.Output, usage.Total, usage.Thoughts, usage.ToolUse, usage.Cached}
	for _, value := range values {
		if value != nil && (*value < 0 || *value > MaxUsageTokens) {
			return false
		}
	}
	minimum := *usage.Input
	for _, value := range []*int{usage.Output, usage.Thoughts, usage.ToolUse} {
		if value != nil {
			if minimum > int(^uint(0)>>1)-*value {
				return false
			}
			minimum += *value
		}
	}
	return *usage.Total >= minimum
}

func blockedGeminiReason(reason string) bool {
	switch reason {
	case "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION":
		return true
	default:
		return false
	}
}
