package history

import "errors"

func validateRetryGraph(records []ConversationRecord) error {
	byID := map[string]ConversationRecord{}
	for _, record := range records {
		byID[record.AttemptID] = record
	}
	for _, record := range records {
		seen := map[string]struct{}{record.AttemptID: {}}
		cursor := record
		for cursor.RetryOfAttemptID != "" {
			parent, exists := byID[cursor.RetryOfAttemptID]
			if !exists {
				return errors.New("history retry target is missing")
			}
			if _, cycle := seen[parent.AttemptID]; cycle {
				return errors.New("history retry cycle detected")
			}
			seen[parent.AttemptID] = struct{}{}
			cursor = parent
		}
	}
	return nil
}

func rootAttemptID(records []ConversationRecord, attemptID string) string {
	byID := map[string]ConversationRecord{}
	for _, record := range records {
		byID[record.AttemptID] = record
	}
	cursor, exists := byID[attemptID]
	if !exists {
		return ""
	}
	seen := map[string]struct{}{}
	for cursor.RetryOfAttemptID != "" {
		if _, cycle := seen[cursor.AttemptID]; cycle {
			return ""
		}
		seen[cursor.AttemptID] = struct{}{}
		parent, exists := byID[cursor.RetryOfAttemptID]
		if !exists {
			return ""
		}
		cursor = parent
	}
	return cursor.AttemptID
}
