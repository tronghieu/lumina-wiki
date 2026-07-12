package ai

import (
	"context"
	"errors"
	"os"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func (runtime *loadedRuntime) RunChat(parent context.Context, request runtimeChatRequest, sink chat.EventSink) error {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return runtime.failPreflight(parent, request, sink, "runtime_closed", err, nil, false)
	}
	defer finish()
	config, err := runtime.deps.Config.Load()
	if err != nil {
		return runtime.failPreflight(ctx, request, sink, "config_unavailable", err, nil, false)
	}
	config, err = config.Normalized()
	if err != nil || config.Chat == nil || config.Chat.ID != request.Profiles.ChatProfileID {
		return runtime.failPreflight(ctx, request, sink, "chat_profile_unavailable", err, nil, false)
	}
	semantic, err := selectedEmbedding(config, request.Profiles.EmbeddingProfileID)
	if err != nil {
		return runtime.failPreflight(ctx, request, sink, "embedding_profile_unavailable", err, nil, false)
	}
	store, enabled, err := runtime.openHistory(ctx)
	if err != nil {
		return runtime.failPreflight(ctx, request, sink, "history_unavailable", err, nil, false)
	}
	if request.History.Persist && !enabled {
		return runtime.failPreflight(ctx, request, sink, "history_disabled", errors.New("history disabled"), store, false)
	}
	turns := []chat.Turn{}
	if request.History.Include && enabled {
		records, loadErr := store.Load(ctx, request.ConversationID)
		if loadErr != nil {
			return runtime.failPreflight(ctx, request, sink, "history_unavailable", loadErr, store, request.History.Persist)
		}
		turns, err = completedHistoryTurns(records, request.ConversationID)
		if err != nil {
			return runtime.failPreflight(ctx, request, sink, "history_unavailable", err, store, request.History.Persist)
		}
	}
	lexical, err := runtime.deps.LexicalFactory(ctx, root, proof)
	if err != nil || lexical == nil {
		return runtime.failPreflight(ctx, request, sink, "retrieval_unavailable", err, store, request.History.Persist)
	}
	hybridConfig, semanticErr := runtime.semanticConfig(ctx, config, lexical, semantic)
	if semanticErr != nil {
		return runtime.failPreflight(ctx, request, sink, "retrieval_unavailable", semanticErr, store, request.History.Persist)
	}
	retriever := runtime.deps.RetrieverFactory(hybridConfig)
	if nilLike(retriever) || retriever.Lexical() != lexical {
		return runtime.failPreflight(ctx, request, sink, "retrieval_unavailable", errors.New("invalid retriever"), store, request.History.Persist)
	}
	provider, err := runtime.deps.ProviderFactory(*config.Chat, runtime.deps.Client, runtime.deps.Credentials)
	if err != nil || nilLike(provider) {
		return runtime.failPreflight(ctx, request, sink, "provider_unavailable", err, store, request.History.Persist)
	}
	var appender chat.HistoryAppender
	if request.History.Persist {
		appender = store
	}
	orchestrator := chat.NewOrchestrator(chat.OrchestratorConfig{Retriever: retriever, Provider: provider,
		History: appender, Citations: runtime.citations})
	return orchestrator.Run(ctx, chat.Request{RequestID: request.RequestID, ConversationID: request.ConversationID,
		AttemptID: request.RequestID, Question: request.Question, Profile: *config.Chat, History: turns,
		SelectedPath: request.SelectedPath, LinkedPaths: append([]string(nil), request.LinkedPaths...),
		HistoryEnabled: request.History.Persist}, sink)
}

func selectedEmbedding(config settings.Config, selected string) (bool, error) {
	if selected == "" {
		return false, nil
	}
	if config.Embedding == nil || config.Embedding.ID != selected {
		return false, errors.New("embedding profile unavailable")
	}
	return true, nil
}

func (runtime *loadedRuntime) begin(parent context.Context) (context.Context, string, os.FileInfo, func(), error) {
	if runtime == nil || parent == nil {
		return nil, "", nil, func() {}, context.Canceled
	}
	if err := parent.Err(); err != nil {
		return nil, "", nil, func() {}, err
	}
	runtime.mu.Lock()
	if runtime.closed || runtime.ctx.Err() != nil || runtime.root == "" || runtime.proof == nil {
		runtime.mu.Unlock()
		return nil, "", nil, func() {}, context.Canceled
	}
	runtime.wg.Add(1)
	root, proof, lifetime := runtime.root, runtime.proof, runtime.ctx
	runtime.mu.Unlock()
	ctx, cancel := context.WithCancel(parent)
	stop := context.AfterFunc(lifetime, cancel)
	return ctx, root, proof, func() { stop(); cancel(); runtime.wg.Done() }, nil
}

func (runtime *loadedRuntime) ReadCitationNote(parent context.Context, requestID, citationID string) (retrieval.CitationNote, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return retrieval.CitationNote{}, err
	}
	defer finish()
	return runtime.citations.ReadCitationNote(ctx, requestID, citationID)
}
