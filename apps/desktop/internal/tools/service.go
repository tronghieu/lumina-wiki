package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"time"

	desktopworkspace "github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type CheckSummary struct {
	Errors   int            `json:"errors"`
	Warnings int            `json:"warnings"`
	ByCheck  map[string]int `json:"by_check"`
	Fixable  int            `json:"fixable"`
}

type CheckResult struct {
	Status   string       `json:"status"`
	Summary  CheckSummary `json:"summary"`
	Stdout   string       `json:"stdout"`
	Stderr   string       `json:"stderr"`
	ExitCode int          `json:"exitCode"`
}

type Service struct {
	NodePath string
	Timeout  time.Duration
}

func NewService() *Service {
	return &Service{NodePath: "node", Timeout: 10 * time.Second}
}

func (s *Service) RunCheck(root string) (CheckResult, error) {
	workspaceService := desktopworkspace.NewService()
	validation, err := workspaceService.Validate(root)
	if err != nil {
		return CheckResult{}, err
	}

	script, err := desktopworkspace.ResolveExisting(validation.Root, "_lumina/scripts/lint.mjs")
	if err != nil {
		return CheckResult{}, errors.New("Lumina check script not found")
	}
	if info, err := os.Lstat(script); err != nil || !info.Mode().IsRegular() {
		return CheckResult{}, errors.New("Lumina check script not found")
	}

	timeout := s.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	nodePath := s.NodePath
	if nodePath == "" {
		nodePath = "node"
	}
	cmd := exec.CommandContext(ctx, nodePath, script, "--summary")
	cmd.Dir = validation.Root

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	result := CheckResult{Stdout: stdout.String(), Stderr: stderr.String()}
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return result, errors.New("Lumina check timed out")
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			result.ExitCode = exitErr.ExitCode()
		} else {
			return result, err
		}
	}

	if parseErr := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &result.Summary); parseErr != nil {
		return result, fmt.Errorf("parse Lumina check summary: %w", parseErr)
	}
	if result.ExitCode > 1 {
		return result, fmt.Errorf("Lumina check failed with exit code %d", result.ExitCode)
	}
	if result.Summary.Errors == 0 && result.Summary.Warnings == 0 {
		result.Status = "clean"
	} else {
		result.Status = "issues"
	}
	return result, nil
}
