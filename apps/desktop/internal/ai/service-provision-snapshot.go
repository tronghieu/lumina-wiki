package ai

import (
	"context"
	"errors"
	"os"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

func buildWorkspaceSnapshot(
	ctx context.Context,
	name string,
	access session.AccessMode,
	root string,
	proof rootproof.RootProof,
	identity os.FileInfo,
) (WorkspaceSnapshotDTO, error) {
	if ctx == nil || ctx.Err() != nil || !access.Valid() || !safeSnapshotText(name, MaxSnapshotDisplayBytes) ||
		proof.Path() != root || proof.Validate() != nil || identity == nil || !identity.IsDir() {
		return WorkspaceSnapshotDTO{}, ErrLibrarySnapshot
	}
	tree, err := workspace.NewTreeBuilder().BuildTrusted(ctx, root, identity)
	if err != nil {
		if ctx.Err() != nil {
			return WorkspaceSnapshotDTO{}, ctx.Err()
		}
		return WorkspaceSnapshotDTO{}, ErrLibrarySnapshot
	}
	treeDTO, err := workspaceTreeDTO(tree)
	if err != nil {
		return WorkspaceSnapshotDTO{}, ErrLibrarySnapshot
	}
	loadedGraph, err := graph.NewService().Load(root)
	if err != nil {
		return WorkspaceSnapshotDTO{}, ErrLibrarySnapshot
	}
	graphDTO, summary, err := workspaceGraphDTO(loadedGraph)
	if err != nil || proof.Validate() != nil {
		return WorkspaceSnapshotDTO{}, ErrLibrarySnapshot
	}
	warnings := make([]WorkspaceWarningDTO, len(treeDTO.Warnings))
	for index, warning := range treeDTO.Warnings {
		warnings[index] = WorkspaceWarningDTO{Code: warning.Code, Path: warning.Path}
	}
	return WorkspaceSnapshotDTO{
		Display: DisplayDTO{Label: name}, Summary: summary, Graph: graphDTO, Tree: treeDTO,
		AccessMode: access, NoteAvailable: len(graphDTO.Nodes) > 0, Warnings: warnings,
	}, nil
}

func workspaceGraphDTO(source graph.Graph) (WorkspaceGraphDTO, WorkspaceSummaryDTO, error) {
	if len(source.Nodes) > MaxSnapshotGraphNodes || len(source.Edges) > MaxSnapshotGraphEdges {
		return WorkspaceGraphDTO{}, WorkspaceSummaryDTO{}, errors.New("graph bounds")
	}
	result := WorkspaceGraphDTO{
		Nodes: make([]WorkspaceGraphNodeDTO, len(source.Nodes)),
		Edges: make([]WorkspaceGraphEdgeDTO, len(source.Edges)),
	}
	ids := make(map[string]struct{}, len(source.Nodes))
	summary := WorkspaceSummaryDTO{Notes: len(source.Nodes), Relationships: len(source.Edges)}
	for index, node := range source.Nodes {
		if !safeSnapshotText(node.ID, MaxSnapshotTitleBytes) ||
			!safeSnapshotText(node.Title, MaxSnapshotTitleBytes) ||
			!safeSnapshotText(node.Type, MaxSnapshotGraphTypeBytes) ||
			!safeSnapshotPath(node.Path) ||
			node.Preview != "" && !safeSnapshotText(node.Preview, MaxSnapshotPreviewBytes) {
			return WorkspaceGraphDTO{}, WorkspaceSummaryDTO{}, errors.New("graph node")
		}
		if _, duplicate := ids[node.ID]; duplicate {
			return WorkspaceGraphDTO{}, WorkspaceSummaryDTO{}, errors.New("graph duplicate")
		}
		ids[node.ID] = struct{}{}
		if strings.EqualFold(node.Type, "source") || strings.EqualFold(node.Type, "sources") {
			summary.Sources++
		}
		result.Nodes[index] = WorkspaceGraphNodeDTO{
			ID: node.ID, Title: node.Title, Type: node.Type, Path: node.Path, Preview: node.Preview,
		}
	}
	for index, edge := range source.Edges {
		if !safeSnapshotText(edge.From, MaxSnapshotTitleBytes) ||
			!safeSnapshotText(edge.To, MaxSnapshotTitleBytes) ||
			!safeSnapshotText(edge.Type, MaxSnapshotGraphTypeBytes) {
			return WorkspaceGraphDTO{}, WorkspaceSummaryDTO{}, errors.New("graph edge")
		}
		result.Edges[index] = WorkspaceGraphEdgeDTO{From: edge.From, Type: edge.Type, To: edge.To}
	}
	return result, summary, nil
}

func safeSnapshotText(value string, limit int) bool {
	return value != "" && len(value) <= limit && utf8.ValidString(value) &&
		strings.IndexFunc(value, func(char rune) bool {
			return unicode.IsControl(char) || !unicode.IsPrint(char) || unicode.Is(unicode.Cf, char)
		}) < 0
}

func safeSnapshotPath(value string) bool {
	if value == "" || len(value) > workspace.MaxTreePathBytes || !utf8.ValidString(value) ||
		strings.Contains(value, `\`) || strings.HasPrefix(value, "/") || path.Clean(value) != value {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}
