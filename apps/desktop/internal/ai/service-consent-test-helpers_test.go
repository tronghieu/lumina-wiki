package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

func (stub *nativeAuthorityStub) ConfirmEmbeddingDisclosure(_ context.Context, _ session.WindowID, disclosure EmbeddingDisclosure) (bool, error) {
	stub.log.add("confirm-embedding")
	stub.embeddingPrompt = disclosure
	return stub.embeddingOK, stub.embeddingErr
}
