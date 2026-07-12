package ai

import "time"

type WorkspaceTreeDTO struct {
	Nodes     []WorkspaceTreeNodeDTO    `json:"nodes"`
	Warnings  []WorkspaceTreeWarningDTO `json:"warnings"`
	Truncated bool                      `json:"truncated"`
}
type WorkspaceTreeNodeDTO struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Path      string                 `json:"path"`
	Kind      string                 `json:"kind"`
	Size      int64                  `json:"size,omitempty"`
	Children  []WorkspaceTreeNodeDTO `json:"children,omitempty"`
	Truncated bool                   `json:"truncated,omitempty"`
}
type WorkspaceTreeWarningDTO struct {
	Path string `json:"path"`
	Code string `json:"code"`
}
type HistoryStatusDTO struct {
	Enabled bool `json:"enabled"`
}
type SetHistoryEnabledRequestDTO struct {
	Session SessionReferenceDTO `json:"session"`
	Enabled bool                `json:"enabled"`
}
type HistoryConversationRequestDTO struct {
	Session        SessionReferenceDTO `json:"session"`
	ConversationID string              `json:"conversationId"`
}
type HistoryListDTO struct {
	Conversations []HistoryMetadataDTO `json:"conversations"`
}
type HistoryMetadataDTO struct {
	ConversationID string    `json:"conversationId"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	Attempts       int       `json:"attempts"`
	LatestStatus   string    `json:"latestStatus"`
}
type HistoryRecordsDTO struct {
	Records []HistoryRecordDTO `json:"records"`
}
type HistoryRecordDTO struct {
	ConversationID   string               `json:"conversationId"`
	AttemptID        string               `json:"attemptId"`
	RetryOfAttemptID string               `json:"retryOfAttemptId,omitempty"`
	CreatedAt        time.Time            `json:"createdAt"`
	FinishedAt       time.Time            `json:"finishedAt"`
	Status           string               `json:"status"`
	UserMessage      string               `json:"userMessage,omitempty"`
	AssistantOutput  string               `json:"assistantOutput,omitempty"`
	Citations        []HistoryCitationDTO `json:"citations,omitempty"`
	ErrorCode        string               `json:"errorCode,omitempty"`
	Usage            HistoryUsageDTO      `json:"usage"`
}
type HistoryCitationDTO struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}
type HistoryUsageDTO struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}
type HistoryDeleteResultDTO struct {
	Removed bool `json:"removed"`
	Durable bool `json:"durable"`
}
type HistoryDeleteAllResultDTO struct {
	DeletedIDs          []string `json:"deletedIds"`
	DurableDeletedIDs   []string `json:"durableDeletedIds"`
	UncertainDeletedIDs []string `json:"uncertainDeletedIds"`
	RemainingIDs        []string `json:"remainingIds"`
	Durable             bool     `json:"durable"`
}

type IndexRequestDTO struct {
	Session            SessionReferenceDTO `json:"session"`
	EmbeddingProfileID string              `json:"embeddingProfileId"`
}
type IndexStatusDTO struct {
	State      string `json:"state"`
	Chunks     int    `json:"chunks"`
	Vectors    int    `json:"vectors"`
	Dimensions int    `json:"dimensions"`
}
type IndexCancelResultDTO struct {
	Cancelled bool `json:"cancelled"`
}
