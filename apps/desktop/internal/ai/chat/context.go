package chat

import (
	"encoding/json"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func (builder ContextBuilder) Build(input BuildInput) (BuiltContext, error) {
	profile, err := input.Profile.Normalized()
	if err != nil || profile.Role != settings.RoleChat || !utf8.ValidString(profile.Model) || !validTurnText(input.Question) ||
		utf8.RuneCountInString(input.Question) > profile.MaxInputChars ||
		utf8.RuneCountInString(input.Question) > providers.MaxProviderTurnChars || len(input.History) > providers.MaxProviderTurns-1 {
		return BuiltContext{}, ErrInvalidContext
	}
	for _, turn := range input.History {
		if (turn.Role != "user" && turn.Role != "assistant") || !validTurnText(turn.Content) || utf8.RuneCountInString(turn.Content) > providers.MaxProviderTurnChars {
			return BuiltContext{}, ErrInvalidContext
		}
	}
	entries := []evidenceEntry{}
	if input.Evidence != nil {
		entries, err = input.Evidence.snapshotEntries()
		if err != nil {
			return BuiltContext{}, err
		}
	}
	system := emptyEvidenceSystem()
	if utf8.RuneCountInString(system) > profile.MaxEvidenceChars {
		return BuiltContext{}, ErrContextBudget
	}
	limit := providers.MaxProviderRequestBytes
	if builder.RequestByteLimit > 0 && builder.RequestByteLimit < limit {
		limit = builder.RequestByteLimit
	}
	request := providers.ProviderRequest{Model: profile.Model, System: system,
		Turns: []providers.ChatMessage{{Role: "user", Content: input.Question}}, MaxOutputTokens: profile.MaxOutputTokens}
	if !requestFits(request, limit) {
		return BuiltContext{}, ErrContextBudget
	}

	selected, historyRunes := []providers.ChatMessage{}, 0
	for i := len(input.History) - 1; i >= 0; i-- {
		turn := input.History[i]
		turnRunes := utf8.RuneCountInString(turn.Content)
		if historyRunes+turnRunes > profile.MaxHistoryChars {
			break
		}
		candidate := append([]providers.ChatMessage{{Role: turn.Role, Content: turn.Content}}, selected...)
		candidate = append(candidate, providers.ChatMessage{Role: "user", Content: input.Question})
		request.Turns = candidate
		if !requestFits(request, limit) {
			break
		}
		selected, historyRunes = candidate[:len(candidate)-1], historyRunes+turnRunes
	}
	request.Turns = append(selected, providers.ChatMessage{Role: "user", Content: input.Question})

	lines, ids := []string{}, []string{}
	for _, entry := range entries {
		line := evidenceJSONLine(entry)
		candidateLines := append(append([]string{}, lines...), line)
		request.System = evidenceSystem(candidateLines)
		if utf8.RuneCountInString(request.System) > profile.MaxEvidenceChars || !requestFits(request, limit) {
			break
		}
		lines, ids = candidateLines, append(ids, entry.ModelID)
	}
	request.System = evidenceSystem(lines)
	if err := request.Validate(); err != nil {
		return BuiltContext{}, ErrContextBudget
	}
	result := BuiltContext{Request: request, EvidenceIDs: ids, HistoryIncluded: len(selected), HistorySkipped: len(input.History) - len(selected),
		EvidenceIncluded: len(ids), EvidenceSkipped: len(entries) - len(ids), BudgetStatus: BudgetComplete}
	if result.HistorySkipped > 0 || result.EvidenceSkipped > 0 {
		result.BudgetStatus = BudgetReduced
	}
	return result, nil
}

func validTurnText(value string) bool {
	if value == "" || !utf8.ValidString(value) {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) && char != '\n' && char != '\r' && char != '\t' {
			return false
		}
	}
	return true
}

func requestFits(request providers.ProviderRequest, limit int) bool {
	raw, err := json.Marshal(request)
	return err == nil && len(raw) <= limit
}
