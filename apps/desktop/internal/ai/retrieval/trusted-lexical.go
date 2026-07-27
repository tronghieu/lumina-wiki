package retrieval

import (
	"context"
	"errors"
	"os"
)

var ErrWorkspaceIdentityChanged = errors.New("workspace_identity_changed")

// BuildLexicalTrusted binds index construction to backend-only identity proof
// obtained from the confirmed workspace directory handle.
func BuildLexicalTrusted(ctx context.Context, corpus *Corpus, root string, expected os.FileInfo) (*Lexical, error) {
	return buildLexical(ctx, corpus, root, expected, true)
}
