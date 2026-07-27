package ai

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

func (service *Service) BeginCreateLibrary(
	ctx context.Context,
	name string,
) (LocationCapabilityDTO, error) {
	if service == nil || service.libraries == nil || !validLibraryName(name) {
		return LocationCapabilityDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return LocationCapabilityDTO{}, err
	}
	generation, err := service.libraries.beginAttempt(window)
	if err != nil {
		return LocationCapabilityDTO{}, err
	}
	authority, ok := service.native.(LibraryNativeAuthority)
	if !ok {
		return LocationCapabilityDTO{}, ErrLibraryUnavailable
	}
	parent, err := service.libraries.defaultParent()
	if err != nil {
		return LocationCapabilityDTO{}, ErrLibraryUnavailable
	}
	parentProof, target, err := approvedLibraryTarget(parent, name)
	if err != nil {
		return LocationCapabilityDTO{}, ErrLibraryUnavailable
	}
	approved, err := authority.ConfirmCreateDestination(ctx, window, target)
	if err != nil || ctx.Err() != nil {
		_ = parentProof.Close()
		return LocationCapabilityDTO{}, ErrNativeAuthority
	}
	if !approved {
		_ = parentProof.Close()
		selection, chooseErr := authority.ChooseDirectory(ctx, window)
		if chooseErr != nil || ctx.Err() != nil {
			return LocationCapabilityDTO{}, ErrNativeAuthority
		}
		if !selection.Approved {
			return LocationCapabilityDTO{Status: LocationCancelled}, nil
		}
		parentProof, target, err = approvedLibraryTarget(selection.Path, name)
		if err != nil {
			return LocationCapabilityDTO{}, ErrLibraryUnavailable
		}
		approved, err = authority.ConfirmCreateDestination(ctx, window, target)
		if err != nil || ctx.Err() != nil {
			_ = parentProof.Close()
			return LocationCapabilityDTO{}, ErrNativeAuthority
		}
		if !approved {
			_ = parentProof.Close()
			return LocationCapabilityDTO{Status: LocationCancelled}, nil
		}
	}
	location := &libraryLocation{
		window: window, generation: generation, name: name, target: target, parent: parentProof,
	}
	if err := service.libraries.addLocation(location); err != nil {
		cleanupLocation(location)
		return LocationCapabilityDTO{}, err
	}
	return LocationCapabilityDTO{Status: LocationApproved, Token: location.token}, nil
}

func (service *Service) PrepareCreateLibrary(
	ctx context.Context,
	capability LocationCapabilityDTO,
) (PreparedLibraryDTO, error) {
	if service == nil || service.libraries == nil {
		return PreparedLibraryDTO{}, ErrLibraryUnavailable
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	location, err := service.libraries.takeLocation(window, capability)
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	keepLocation := false
	defer func() {
		if !keepLocation {
			cleanupLocation(location)
		}
	}()
	if err := location.parent.Validate(); err != nil {
		return PreparedLibraryDTO{}, ErrLibraryCapability
	}
	classification, err := service.libraries.provisioner.Classify(ctx, location.target)
	if err != nil {
		return PreparedLibraryDTO{}, safeLibraryProvisionError(err)
	}
	if classification.State != workspace.TargetAbsent && classification.State != workspace.TargetEmpty {
		return PreparedLibraryDTO{}, ErrLibraryCollision
	}
	snapshot := emptyWorkspaceSnapshot(location.name, session.AccessWritable)
	candidate := &preparedLibrary{
		window: location.window, generation: location.generation, kind: LibraryOperationCreate,
		name: location.name, target: location.target, snapshot: snapshot, parent: location.parent,
	}
	if err := service.libraries.addPrepared(candidate); err != nil {
		return PreparedLibraryDTO{}, err
	}
	location.parent = rootproof.RootProof{}
	keepLocation = true
	return preparedLibraryDTO(candidate), nil
}

func approvedLibraryTarget(parent, name string) (rootproof.RootProof, string, error) {
	if !validLibraryName(name) || parent == "" || !filepath.IsAbs(parent) || filepath.Clean(parent) != parent {
		return rootproof.RootProof{}, "", ErrInvalidInput
	}
	proof, err := rootproof.Open(parent)
	if err != nil {
		return rootproof.RootProof{}, "", ErrInvalidInput
	}
	info, err := os.Lstat(parent)
	if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		_ = proof.Close()
		return rootproof.RootProof{}, "", ErrInvalidInput
	}
	target := filepath.Join(parent, name)
	if filepath.Dir(target) != parent || filepath.Base(target) != name {
		_ = proof.Close()
		return rootproof.RootProof{}, "", ErrInvalidInput
	}
	return proof, target, nil
}

func validLibraryName(name string) bool {
	if name == "" || len(name) > MaxLibraryNameBytes || !utf8.ValidString(name) ||
		strings.TrimSpace(name) != name || name == "." || name == ".." ||
		strings.ContainsAny(name, `/\<>:"|?*`) || strings.HasSuffix(name, ".") {
		return false
	}
	if strings.IndexFunc(name, func(char rune) bool {
		return unicode.IsControl(char) || !unicode.IsPrint(char) || unicode.Is(unicode.Cf, char)
	}) >= 0 {
		return false
	}
	base := strings.ToUpper(strings.TrimSuffix(name, filepath.Ext(name)))
	switch base {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return false
	}
	return true
}

func safeLibraryProvisionError(err error) error {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	case errors.Is(err, workspace.ErrTargetNotCreatable),
		errors.Is(err, workspace.ErrRecoveryMismatch),
		errors.Is(err, workspace.ErrEmptyNeedsApproval):
		return ErrLibraryCollision
	default:
		return ErrLibraryUnavailable
	}
}

func emptyWorkspaceSnapshot(name string, access session.AccessMode) WorkspaceSnapshotDTO {
	return WorkspaceSnapshotDTO{
		Display:    DisplayDTO{Label: name},
		Summary:    WorkspaceSummaryDTO{},
		Graph:      WorkspaceGraphDTO{Nodes: []WorkspaceGraphNodeDTO{}, Edges: []WorkspaceGraphEdgeDTO{}},
		Tree:       WorkspaceTreeDTO{Nodes: []WorkspaceTreeNodeDTO{}, Warnings: []WorkspaceTreeWarningDTO{}},
		AccessMode: access,
		Warnings:   []WorkspaceWarningDTO{},
	}
}

func preparedLibraryDTO(candidate *preparedLibrary) PreparedLibraryDTO {
	return PreparedLibraryDTO{
		Status: PreparationReady, PreparationToken: candidate.token, Kind: candidate.kind,
		Snapshot: cloneWorkspaceSnapshot(candidate.snapshot),
	}
}

func cloneWorkspaceSnapshot(source WorkspaceSnapshotDTO) WorkspaceSnapshotDTO {
	cloned := source
	cloned.Graph.Nodes = append([]WorkspaceGraphNodeDTO{}, source.Graph.Nodes...)
	cloned.Graph.Edges = append([]WorkspaceGraphEdgeDTO{}, source.Graph.Edges...)
	cloned.Tree = cloneWorkspaceTree(source.Tree)
	cloned.Warnings = append([]WorkspaceWarningDTO{}, source.Warnings...)
	return cloned
}

func cloneWorkspaceTree(source WorkspaceTreeDTO) WorkspaceTreeDTO {
	cloned := source
	cloned.Nodes = make([]WorkspaceTreeNodeDTO, len(source.Nodes))
	for index := range source.Nodes {
		cloned.Nodes[index] = cloneWorkspaceTreeNode(source.Nodes[index])
	}
	cloned.Warnings = append([]WorkspaceTreeWarningDTO{}, source.Warnings...)
	return cloned
}

func cloneWorkspaceTreeNode(source WorkspaceTreeNodeDTO) WorkspaceTreeNodeDTO {
	cloned := source
	cloned.Children = make([]WorkspaceTreeNodeDTO, len(source.Children))
	for index := range source.Children {
		cloned.Children[index] = cloneWorkspaceTreeNode(source.Children[index])
	}
	return cloned
}
