package chat

import (
	"context"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

const (
	MaxRequestIDBytes          = 64
	DefaultFinalizationTimeout = 2 * time.Second
)

type HistoryAppender interface {
	Append(context.Context, history.ConversationRecord) (history.AppendOutcome, error)
}

type RetrievalRunner interface {
	Retrieve(context.Context, string, retrieval.SearchOptions) (HybridResult, error)
	Lexical() *retrieval.Lexical
}

type OrchestratorConfig struct {
	Retriever   RetrievalRunner
	Builder     ContextBuilder
	Provider    providers.ChatProvider
	History     HistoryAppender
	Clock       func() time.Time
	GuardLimits GuardLimits
	Citations   *CitationLeaseRegistry
	// FinalizationTimeout bounds each start/history/terminal I/O stage.
	FinalizationTimeout time.Duration
}

type Request struct {
	RequestID        string
	ConversationID   string
	AttemptID        string
	RetryOfAttemptID string
	Question         string
	Profile          settings.Profile
	History          []Turn
	SelectedPath     string
	LinkedPaths      []string
	HistoryEnabled   bool
}

type Orchestrator struct{ config OrchestratorConfig }

func NewOrchestrator(config OrchestratorConfig) *Orchestrator {
	if config.Clock == nil {
		config.Clock = time.Now
	}
	if config.Citations == nil {
		config.Citations = NewCitationLeaseRegistry()
	}
	if config.FinalizationTimeout <= 0 {
		config.FinalizationTimeout = DefaultFinalizationTimeout
	}
	return &Orchestrator{config: config}
}
