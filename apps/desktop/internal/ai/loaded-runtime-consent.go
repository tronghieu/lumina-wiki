package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type embeddingConsentSubject struct {
	WorkspaceID workspaceid.WorkspaceID
	Profile     settings.Profile
	Disclosure  index.ConsentDisclosure
	Granted     bool
}

func (runtime *loadedRuntime) EmbeddingConsentSubject(parent context.Context, profileID string) (embeddingConsentSubject, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return embeddingConsentSubject{}, err
	}
	defer finish()
	finishConsentUse, err := runtime.deps.ConsentAccess.BeginUse(ctx)
	if err != nil {
		return embeddingConsentSubject{}, err
	}
	defer finishConsentUse()
	config, err := runtime.normalizedConfig()
	if err != nil || config.Embedding == nil || config.Embedding.ID != profileID {
		return embeddingConsentSubject{}, ErrIndexUnavailable
	}
	disclosure, err := index.ConsentFingerprint(runtime.id, *config.Embedding)
	if err != nil {
		return embeddingConsentSubject{}, ErrIndexUnavailable
	}
	granted := index.RequireConsent(config, runtime.id, *config.Embedding, runtime.deps.Now().UTC()) == nil
	if err := ctx.Err(); err != nil {
		return embeddingConsentSubject{}, err
	}
	return embeddingConsentSubject{WorkspaceID: runtime.id, Profile: *config.Embedding, Disclosure: disclosure, Granted: granted}, nil
}

func (runtime *loadedRuntime) BeginConsentMutation(parent context.Context, profileID string) (func(), error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return nil, err
	}
	for {
		runtime.indexMu.Lock()
		active := runtime.indexMutation
		if active == nil {
			runtime.indexMu.Unlock()
			_, done, reserveErr := runtime.startIndexMutation(ctx, runtimeIndexMutationConsent, profileID)
			if reserveErr == nil {
				return func() { done(); finish() }, nil
			}
			if reserveErr != ErrIndexBuildActive {
				finish()
				return nil, reserveErr
			}
			continue
		}
		if active.kind != runtimeIndexMutationBuild {
			runtime.indexMu.Unlock()
			finish()
			return nil, ErrIndexBuildActive
		}
		cancel, waited := active.cancel, active.done
		runtime.indexMu.Unlock()
		cancel()
		select {
		case <-waited:
		case <-ctx.Done():
			finish()
			return nil, ctx.Err()
		}
	}
}
