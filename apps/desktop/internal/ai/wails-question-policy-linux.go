//go:build linux

package ai

import "github.com/wailsapp/wails/v3/pkg/application"

// Wails alpha.78 ignores MessageDialog.AttachToWindow on Linux. Fail closed
// unless the requested owner is the sole live window, which prevents a dialog
// from authorizing a different window in multi-window mode.
type linuxQuestionOwnership struct {
	windows questionWindowCollection
}

func newQuestionOwnershipPolicy(windows questionWindowCollection) questionOwnershipPolicy {
	return &linuxQuestionOwnership{windows: windows}
}

func (policy *linuxQuestionOwnership) AllowQuestion(requested application.Window) bool {
	return policy != nil && hasValue(policy.windows) && linuxQuestionOwnerAllowed(policy.windows.Windows(), requested)
}
