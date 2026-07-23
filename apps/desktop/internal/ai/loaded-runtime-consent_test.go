package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestLoadedRuntimeEmbeddingConsentSubjectUsesExactNormalizedProfile(t *testing.T) {
	now := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)
	runtime := semanticRuntime(t, runtimeWorkspace(t), &runtimeSemanticStore{}, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		t.Fatal("consent status must not create embedding provider")
		return nil, nil
	})
	runtime.deps.Now = func() time.Time { return now }
	subject, err := runtime.EmbeddingConsentSubject(context.Background(), "embed-main")
	if err != nil || subject.WorkspaceID != runtime.id || subject.Profile.ID != "embed-main" || subject.Disclosure.Kind != index.DisclosureRemote || subject.Granted {
		t.Fatalf("subject=%#v err=%v", subject, err)
	}
	if _, err := runtime.EmbeddingConsentSubject(context.Background(), "forged"); err == nil {
		t.Fatal("mismatched profile accepted")
	}
	if runtime.deps.Credentials.(*runtimeCredentialSpy).calls != 0 {
		t.Fatal("consent status resolved credentials")
	}
}

type consentCheckingEmbedder struct {
	config    settings.Config
	workspace workspaceid.WorkspaceID
	profile   settings.Profile
	now       time.Time
}

func (embedder *consentCheckingEmbedder) Embed(_ context.Context, request index.EmbeddingRequest) (index.EmbeddingBatch, error) {
	if request.Purpose != index.PurposeDocument {
		return index.EmbeddingBatch{}, errors.New("wrong purpose")
	}
	if err := index.RequireConsent(embedder.config, embedder.workspace, embedder.profile, embedder.now); err != nil {
		return index.EmbeddingBatch{}, err
	}
	return index.EmbeddingBatch{Model: embedder.profile.Model, Dimensions: 8, Vectors: [][]float32{make([]float32, 8)}}, nil
}

type consentBuildStore struct{ runtimeSemanticStore }

func (*consentBuildStore) Build(ctx context.Context, request index.BuildRequest, _ index.ProgressSink) (index.IndexStatus, error) {
	if _, err := request.Provider.Embed(ctx, index.EmbeddingRequest{Purpose: index.PurposeDocument, Inputs: []string{request.Chunks[0].Text}}); err != nil {
		return index.IndexStatus{State: index.StateFailed}, err
	}
	return index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8}, nil
}

func TestLoadedRuntimeBuildRequiresGrantedAndUnrevokedConsent(t *testing.T) {
	now := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)
	store := &consentBuildStore{}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(profile settings.Profile, options index.FactoryOptions) (index.EmbeddingProvider, error) {
		if options.Now == nil || !options.Now().Equal(now) {
			t.Fatalf("provider clock missing=%v", options.Now == nil)
		}
		return &consentCheckingEmbedder{config: options.Config, workspace: options.WorkspaceID, profile: profile, now: now}, nil
	})
	runtime.deps.Now = func() time.Time { return now }
	config := runtime.deps.Config.(*runtimeConfigSpy)
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexUnavailable) {
		t.Fatalf("missing consent err=%v", err)
	}
	granted, err := index.GrantConsent(config.config, runtime.id, *config.config.Embedding, now, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	config.config = granted
	if status, err := runtime.BuildIndex(context.Background(), "embed-main"); err != nil || status.State != index.StateReady {
		t.Fatalf("granted status=%#v err=%v", status, err)
	}
	revoked, err := index.RevokeConsent(granted, runtime.id, *granted.Embedding, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	config.config = revoked
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexUnavailable) {
		t.Fatalf("revoked consent err=%v", err)
	}
}
