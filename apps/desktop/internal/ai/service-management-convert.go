package ai

import (
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

var treeNodeIDPattern = regexp.MustCompile(`^node_[0-9a-f]{32}$`)

func workspaceTreeDTO(tree workspace.WorkspaceTree) (WorkspaceTreeDTO, error) {
	if len(tree.Nodes) > 3 || len(tree.Warnings) > workspace.MaxTreeWarnings {
		return WorkspaceTreeDTO{}, errors.New("tree bounds")
	}
	count := 0
	state := treeConversionState{count: &count, ids: make(map[string]struct{}), paths: make(map[string]struct{})}
	nodes := make([]WorkspaceTreeNodeDTO, len(tree.Nodes))
	for index := range tree.Nodes {
		if !validTreeRootPath(tree.Nodes[index].Path) || tree.Nodes[index].Kind != "directory" {
			return WorkspaceTreeDTO{}, errors.New("tree root")
		}
		converted, err := workspaceTreeNodeDTO(tree.Nodes[index], "", 0, &state)
		if err != nil {
			return WorkspaceTreeDTO{}, err
		}
		nodes[index] = converted
	}
	warnings := make([]WorkspaceTreeWarningDTO, len(tree.Warnings))
	for index, warning := range tree.Warnings {
		if !validTreePath(warning.Path) || !validTreeWarning(warning.Code) {
			return WorkspaceTreeDTO{}, errors.New("tree warning")
		}
		warnings[index] = WorkspaceTreeWarningDTO{Path: warning.Path, Code: warning.Code}
	}
	return WorkspaceTreeDTO{Nodes: nodes, Warnings: warnings, Truncated: tree.Truncated}, nil
}

type treeConversionState struct {
	count *int
	ids   map[string]struct{}
	paths map[string]struct{}
}

func workspaceTreeNodeDTO(node workspace.TreeNode, parent string, depth int, state *treeConversionState) (WorkspaceTreeNodeDTO, error) {
	*state.count = *state.count + 1
	_, duplicateID := state.ids[node.ID]
	_, duplicatePath := state.paths[node.Path]
	if *state.count > workspace.MaxTreeEntries || depth > workspace.MaxTreeDepth || duplicateID || duplicatePath || !treeNodeIDPattern.MatchString(node.ID) ||
		!validTreePath(node.Path) || node.Name != node.Path[strings.LastIndex(node.Path, "/")+1:] || len(node.Children) > workspace.MaxTreeDirEntries {
		return WorkspaceTreeNodeDTO{}, errors.New("tree node")
	}
	if parent != "" && node.Path != parent+"/"+node.Name {
		return WorkspaceTreeNodeDTO{}, errors.New("tree hierarchy")
	}
	if node.Kind != "file" && node.Kind != "directory" || node.Size < 0 || node.Kind == "directory" && node.Size != 0 ||
		node.Kind == "file" && (len(node.Children) != 0 || node.Truncated) {
		return WorkspaceTreeNodeDTO{}, errors.New("tree node kind")
	}
	state.ids[node.ID] = struct{}{}
	state.paths[node.Path] = struct{}{}
	children := make([]WorkspaceTreeNodeDTO, len(node.Children))
	for index := range node.Children {
		converted, err := workspaceTreeNodeDTO(node.Children[index], node.Path, depth+1, state)
		if err != nil {
			return WorkspaceTreeNodeDTO{}, err
		}
		children[index] = converted
	}
	return WorkspaceTreeNodeDTO{ID: node.ID, Name: node.Name, Path: node.Path, Kind: node.Kind, Size: node.Size,
		Children: children, Truncated: node.Truncated}, nil
}

func validTreeRootPath(path string) bool { return path == "_lumina" || path == "raw" || path == "wiki" }

func validTreePath(value string) bool {
	if value == "" || len(value) > workspace.MaxTreePathBytes || !utf8.ValidString(value) || strings.Contains(value, `\`) || strings.HasPrefix(value, "/") {
		return false
	}
	parts := strings.Split(value, "/")
	if len(parts) > workspace.MaxTreeDepth+1 || parts[0] != "_lumina" && parts[0] != "raw" && parts[0] != "wiki" {
		return false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func validTreeWarning(code string) bool {
	return code == "entry_changed" || code == "invalid_path_encoding" || code == "limit_reached"
}

func historyListDTO(source []history.ConversationMetadata) (HistoryListDTO, error) {
	if len(source) > history.MaxConversations {
		return HistoryListDTO{}, errors.New("history bounds")
	}
	result := make([]HistoryMetadataDTO, len(source))
	for index, value := range source {
		createdAt, createdOK := safeHistoryTime(value.CreatedAt)
		updatedAt, updatedOK := safeHistoryTime(value.UpdatedAt)
		if !validFacadeID(value.ConversationID) || !createdOK || !updatedOK || updatedAt.Before(createdAt) ||
			value.Attempts < 1 || value.Attempts > history.MaxAttemptsPerConversation || !validHistoryStatus(value.LatestStatus) {
			return HistoryListDTO{}, errors.New("history metadata")
		}
		result[index] = HistoryMetadataDTO{ConversationID: value.ConversationID, CreatedAt: createdAt,
			UpdatedAt: updatedAt, Attempts: value.Attempts, LatestStatus: string(value.LatestStatus)}
	}
	return HistoryListDTO{Conversations: result}, nil
}

func historyRecordsDTO(source []history.ConversationRecord, conversationID string) (HistoryRecordsDTO, error) {
	if len(source) > history.MaxAttemptsPerConversation {
		return HistoryRecordsDTO{}, errors.New("history bounds")
	}
	result := make([]HistoryRecordDTO, len(source))
	for index, value := range source {
		createdAt, createdOK := safeHistoryTime(value.CreatedAt)
		finishedAt, finishedOK := safeHistoryTime(value.FinishedAt)
		if value.Validate() != nil || value.ConversationID != conversationID || !createdOK || !finishedOK {
			return HistoryRecordsDTO{}, errors.New("history record")
		}
		citations := make([]HistoryCitationDTO, len(value.Citations))
		for citationIndex, citation := range value.Citations {
			citations[citationIndex] = HistoryCitationDTO{ID: citation.ID, Label: citation.Label}
		}
		result[index] = HistoryRecordDTO{ConversationID: value.ConversationID, AttemptID: value.AttemptID,
			RetryOfAttemptID: value.RetryOfAttemptID, CreatedAt: createdAt, FinishedAt: finishedAt,
			Status: string(value.Status), UserMessage: value.UserMessage, AssistantOutput: value.AssistantOutput,
			Citations: citations, ErrorCode: value.ErrorCode,
			Usage: HistoryUsageDTO{InputTokens: value.Usage.InputTokens, OutputTokens: value.Usage.OutputTokens}}
	}
	return HistoryRecordsDTO{Records: result}, nil
}

func historyDeleteAllDTO(source history.DeleteAllResult, operationFailed bool) (HistoryDeleteAllResultDTO, error) {
	if emptyFailedDeleteAll(source) {
		if !operationFailed {
			return HistoryDeleteAllResultDTO{}, errHistoryDeleteOutcomeMismatch
		}
		return HistoryDeleteAllResultDTO{DeletedIDs: []string{}, DurableDeletedIDs: []string{},
			UncertainDeletedIDs: []string{}, RemainingIDs: []string{}}, nil
	}
	if err := validateHistoryDeleteAll(source); err != nil {
		return HistoryDeleteAllResultDTO{}, err
	}
	if operationFailed != !source.Durable {
		return HistoryDeleteAllResultDTO{}, errHistoryDeleteOutcomeMismatch
	}
	return HistoryDeleteAllResultDTO{DeletedIDs: append([]string{}, source.DeletedIDs...), DurableDeletedIDs: append([]string{}, source.DurableDeletedIDs...),
		UncertainDeletedIDs: append([]string{}, source.UncertainDeletedIDs...), RemainingIDs: append([]string{}, source.RemainingIDs...), Durable: source.Durable}, nil
}

func validHistoryStatus(status history.TerminalStatus) bool {
	return status == history.StatusCompleted || status == history.StatusFailed || status == history.StatusCancelled
}
