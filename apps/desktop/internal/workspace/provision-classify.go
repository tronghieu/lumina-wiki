package workspace

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type TargetState string

const (
	TargetInvalid          TargetState = "invalid"
	TargetUnsafe           TargetState = "unsafe"
	TargetAbsent           TargetState = "absent"
	TargetEmpty            TargetState = "empty"
	TargetLegacy           TargetState = "legacy"
	TargetCompatible       TargetState = "compatible"
	TargetNewer            TargetState = "newer"
	TargetMalformed        TargetState = "malformed"
	TargetInterrupted      TargetState = "interrupted"
	TargetCommittedResidue TargetState = "committed-residue"
	TargetOccupied         TargetState = "occupied"
	TargetDirty            TargetState = "dirty"
)

type TargetClassification struct {
	State            TargetState
	RequiresApproval bool
	Recoverable      bool
}

func classifyExistingRoot(ctx context.Context, rootPath string) (TargetClassification, error) {
	if err := ctx.Err(); err != nil {
		return TargetClassification{}, err
	}
	root, err := openTreeRoot(rootPath)
	if err != nil {
		return TargetClassification{State: TargetUnsafe}, nil
	}
	defer root.Close()
	return classifyHeldRoot(ctx, root)
}

func classifyHeldRoot(ctx context.Context, root *os.Root) (TargetClassification, error) {
	directory, err := root.Open(".")
	if err != nil {
		return TargetClassification{State: TargetUnsafe}, nil
	}
	entries, readErr := directory.ReadDir(8193)
	_ = directory.Close()
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return TargetClassification{State: TargetUnsafe}, nil
	}
	if len(entries) == 0 {
		return TargetClassification{State: TargetEmpty, RequiresApproval: true}, nil
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), provisionJournalPrefix) {
			return TargetClassification{State: TargetInterrupted, Recoverable: true}, nil
		}
	}
	if len(entries) > 8192 {
		return TargetClassification{State: TargetUnsafe}, nil
	}
	if err := validateTreeWorkspace(root); err != nil {
		return TargetClassification{State: TargetDirty}, nil
	}
	status, err := inspectManifest(ctx, root)
	if err != nil {
		return TargetClassification{}, err
	}
	switch status {
	case manifestMissing:
		for _, name := range []string{
			"_lumina/_state/skills-manifest.csv",
			"_lumina/_state/files-manifest.csv",
		} {
			if _, residueErr := root.Lstat(name); residueErr == nil {
				return TargetClassification{State: TargetMalformed}, nil
			} else if !errors.Is(residueErr, fs.ErrNotExist) {
				return TargetClassification{State: TargetMalformed}, nil
			}
		}
		return TargetClassification{State: TargetLegacy}, nil
	case manifestSupported:
		return TargetClassification{State: TargetCompatible}, nil
	case manifestNewer:
		return TargetClassification{State: TargetNewer}, nil
	default:
		return TargetClassification{State: TargetMalformed}, nil
	}
}

func validateTargetPath(target string) (parent, child string, err error) {
	if target == "" || !utf8.ValidString(target) || len(target) > MaxTreePathBytes ||
		!filepath.IsAbs(target) || filepath.Clean(target) != target {
		return "", "", errors.New("library target is invalid")
	}
	parent, child = filepath.Dir(target), filepath.Base(target)
	if child == "." || child == string(filepath.Separator) || child == "" ||
		strings.ContainsAny(child, `/\`) {
		return "", "", errors.New("library target is invalid")
	}
	info, err := os.Lstat(parent)
	if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return "", "", errors.New("library parent is unsafe")
	}
	return parent, child, nil
}
