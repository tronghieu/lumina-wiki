//go:build !linux

package ai

import "github.com/wailsapp/wails/v3/pkg/application"

type attachedQuestionOwnership struct {
	windows questionWindowCollection
}

func newQuestionOwnershipPolicy(windows questionWindowCollection) questionOwnershipPolicy {
	return &attachedQuestionOwnership{windows: windows}
}

func (policy *attachedQuestionOwnership) AllowQuestion(requested application.Window) bool {
	return policy != nil && hasValue(policy.windows) && questionWindowPresent(policy.windows.Windows(), requested)
}
