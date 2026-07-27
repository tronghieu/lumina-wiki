package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

func (service *Service) ListRecentLibraries(ctx context.Context) (RecentLibrariesDTO, error) {
	if service == nil || service.libraryState == nil || ctx == nil {
		return RecentLibrariesDTO{}, ErrLibraryUnavailable
	}
	if _, err := service.resolveWindow(ctx); err != nil {
		return RecentLibrariesDTO{}, err
	}
	snapshot, err := service.libraryState.Snapshot(ctx)
	if err != nil {
		return RecentLibrariesDTO{}, ErrLibraryUnavailable
	}
	resolver, ok := service.attacher.(WorkspaceRecentResolver)
	if !ok {
		return RecentLibrariesDTO{}, ErrLibraryUnavailable
	}
	ids := make([]workspaceid.WorkspaceID, len(snapshot.Recent))
	for index, recent := range snapshot.Recent {
		ids[index] = recent.WorkspaceID
	}
	resolved, err := resolver.ResolveRecent(ids)
	if err != nil {
		return RecentLibrariesDTO{}, ErrLibraryUnavailable
	}
	known := make(map[workspaceid.WorkspaceID]workspaceid.RecentWorkspace, len(resolved))
	for _, recent := range resolved {
		known[recent.WorkspaceID] = recent
	}
	result := RecentLibrariesDTO{Libraries: make([]RecentLibraryDTO, len(snapshot.Recent))}
	for index, recent := range snapshot.Recent {
		item := RecentLibraryDTO{
			WorkspaceID: recent.WorkspaceID, Label: "Library",
			ActivatedAt: recent.ActivatedAt, Status: RecentLibraryUnavailable,
		}
		if identity, exists := known[recent.WorkspaceID]; exists {
			item.Label, item.Status = identity.Label, RecentLibraryAvailable
		}
		if view, exists := snapshot.Views[recent.WorkspaceID]; exists {
			item.Focus = workspaceFocus(view.Focus)
		}
		result.Libraries[index] = item
	}
	return result, nil
}

func (service *Service) SaveWorkspaceView(
	ctx context.Context,
	request SaveWorkspaceViewRequestDTO,
) (WorkspaceViewDTO, error) {
	view, ok := appStateView(request.Focus, request.Artifact)
	if !ok || service == nil || service.libraryState == nil || !validSessionReferenceSyntax(request.Session) {
		return WorkspaceViewDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return WorkspaceViewDTO{}, err
	}
	lease, err := service.sessions.Resolve(window, request.Session.sessionReference())
	if err != nil {
		return WorkspaceViewDTO{}, ErrSessionRejected
	}
	workspaceID := lease.WorkspaceID()
	lease.Finish()
	if !workspaceID.Valid() {
		return WorkspaceViewDTO{}, ErrSessionRejected
	}
	if err := service.libraryState.SaveView(ctx, workspaceID, view); err != nil {
		return WorkspaceViewDTO{}, ErrLibraryUnavailable
	}
	return WorkspaceViewDTO{Focus: request.Focus, Artifact: cloneArtifactDTO(request.Artifact)}, nil
}

func (service *Service) RemoveRecentLibrary(
	ctx context.Context,
	request RecentLibraryRequestDTO,
) (RemoveRecentLibraryResultDTO, error) {
	if service == nil || service.libraryState == nil || !request.WorkspaceID.Valid() {
		return RemoveRecentLibraryResultDTO{}, ErrInvalidInput
	}
	if _, err := service.resolveWindow(ctx); err != nil {
		return RemoveRecentLibraryResultDTO{}, err
	}
	if err := service.libraryState.RemoveRecent(ctx, request.WorkspaceID); err != nil {
		return RemoveRecentLibraryResultDTO{}, ErrLibraryUnavailable
	}
	return RemoveRecentLibraryResultDTO{Removed: true}, nil
}

func (service *Service) PrepareRestoreRecentLibrary(
	ctx context.Context,
	request RestoreRecentLibraryRequestDTO,
) (PreparedContinuityDTO, error) {
	if service == nil || service.libraryState == nil || service.libraries == nil ||
		!request.WorkspaceID.Valid() {
		return PreparedContinuityDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return PreparedContinuityDTO{}, err
	}
	state, err := service.libraryState.Snapshot(ctx)
	if err != nil {
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	if !snapshotHasRecent(state, request.WorkspaceID) {
		return PreparedContinuityDTO{}, ErrLibraryCapability
	}
	resolver, ok := service.attacher.(WorkspaceRecentResolver)
	if !ok {
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	generation, err := service.libraries.beginAttempt(window)
	if err != nil {
		return PreparedContinuityDTO{}, err
	}
	decision, err := resolver.BeginRestore(request.WorkspaceID)
	if err != nil {
		return PreparedContinuityDTO{}, safeRestoreError(err)
	}
	if err := service.attacher.CancelAttach(decision.Token); err != nil {
		return PreparedContinuityDTO{}, ErrWorkspaceAttach
	}
	proof, err := rootproof.Open(decision.CanonicalPath)
	if err != nil {
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	name, err := displayBasename(decision.CanonicalPath)
	if err != nil {
		_ = proof.Close()
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	candidate, err := service.prepareTrustedLibrary(
		ctx, window, generation, LibraryOperationOpen, name, "", proof, session.AccessReadOnly,
		request.WorkspaceID,
	)
	if errors.Is(err, errLibraryPreparationCancelled) {
		return PreparedContinuityDTO{
			Prepared: PreparedLibraryDTO{Status: PreparationCancelled},
		}, nil
	}
	if err != nil {
		return PreparedContinuityDTO{}, err
	}
	if err := service.libraries.addPrepared(candidate); err != nil {
		cleanupPreparedLibrary(candidate)
		return PreparedContinuityDTO{}, err
	}
	return preparedContinuity(ctx, candidate, state, request.WorkspaceID), nil
}

func (service *Service) PrepareFindRecentLibrary(
	ctx context.Context,
	request FindRecentLibraryRequestDTO,
) (PreparedContinuityDTO, error) {
	if service == nil || service.libraryState == nil || service.libraries == nil ||
		!request.WorkspaceID.Valid() {
		return PreparedContinuityDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return PreparedContinuityDTO{}, err
	}
	state, err := service.libraryState.Snapshot(ctx)
	if err != nil {
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	if !snapshotHasRecent(state, request.WorkspaceID) {
		return PreparedContinuityDTO{}, ErrLibraryCapability
	}
	resolver, ok := service.attacher.(WorkspaceRecentResolver)
	if !ok {
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	generation, err := service.libraries.beginAttempt(window)
	if err != nil {
		return PreparedContinuityDTO{}, err
	}
	selection, err := service.native.ChooseDirectory(ctx, window)
	if err != nil || ctx.Err() != nil {
		return PreparedContinuityDTO{}, ErrNativeAuthority
	}
	if !selection.Approved {
		return PreparedContinuityDTO{
			Prepared: PreparedLibraryDTO{Status: PreparationCancelled},
		}, nil
	}
	if !validTypedRoot(selection.Path) {
		return PreparedContinuityDTO{}, ErrInvalidWorkspace
	}
	decision, err := resolver.BeginFind(request.WorkspaceID, selection.Path)
	if err != nil {
		return PreparedContinuityDTO{}, safeRestoreError(err)
	}
	if err := service.attacher.CancelAttach(decision.Token); err != nil {
		return PreparedContinuityDTO{}, ErrWorkspaceAttach
	}
	proof, err := rootproof.Open(decision.CanonicalPath)
	if err != nil {
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	name, err := displayBasename(decision.CanonicalPath)
	if err != nil {
		_ = proof.Close()
		return PreparedContinuityDTO{}, ErrLibraryUnavailable
	}
	candidate, err := service.prepareTrustedLibrary(
		ctx, window, generation, LibraryOperationOpen, name, "", proof, session.AccessReadOnly,
		request.WorkspaceID,
	)
	if errors.Is(err, errLibraryPreparationCancelled) {
		return PreparedContinuityDTO{
			Prepared: PreparedLibraryDTO{Status: PreparationCancelled},
		}, nil
	}
	if err != nil {
		return PreparedContinuityDTO{}, err
	}
	if err := service.libraries.addPrepared(candidate); err != nil {
		cleanupPreparedLibrary(candidate)
		return PreparedContinuityDTO{}, err
	}
	return preparedContinuity(ctx, candidate, state, request.WorkspaceID), nil
}

func preparedContinuity(
	ctx context.Context,
	candidate *preparedLibrary,
	state appstate.Snapshot,
	workspaceID workspaceid.WorkspaceID,
) PreparedContinuityDTO {
	result := PreparedContinuityDTO{
		Prepared: preparedLibraryDTO(candidate), Focus: WorkspaceFocusGraph,
		ArtifactStatus: ContinuityEmpty, HistoryStatus: history.LatestUnavailable,
	}
	view, hasView := state.Views[workspaceID]
	if hasView {
		result.Focus = workspaceFocus(view.Focus)
		if view.Artifact != nil {
			result.ArtifactStatus = ContinuityUnavailable
		}
	}
	runtime, runtimeOK := managementRuntimeCapability(candidate.runtime)
	if runtimeOK {
		latest, latestErr := runtime.LoadLatestHistory(ctx)
		if latestErr == nil {
			result.HistoryStatus, result.ConversationID = latest.Status, latest.ConversationID
		}
		if hasView && view.Artifact != nil {
			note, noteErr := runtime.ReadWorkspaceNote(ctx, view.Artifact.RelativePath)
			if noteErr == nil && note.Path == view.Artifact.RelativePath &&
				len(note.Content) <= MaxWorkspaceNoteBytes {
				artifact := ArtifactLocatorV1DTO{
					Version: view.Artifact.Version, Kind: string(view.Artifact.Kind),
					RelativePath: view.Artifact.RelativePath,
				}
				result.ArtifactStatus = ContinuityLoaded
				result.Artifact = &NoteContentDTO{Artifact: artifact, Content: note.Content}
			} else {
				result.ArtifactStatus = ContinuityUnavailable
			}
		}
	}
	return result
}

func snapshotHasRecent(snapshot appstate.Snapshot, id workspaceid.WorkspaceID) bool {
	for _, recent := range snapshot.Recent {
		if recent.WorkspaceID == id {
			return true
		}
	}
	return false
}

func safeRestoreError(err error) error {
	switch {
	case errors.Is(err, workspaceid.ErrInvalidRecentWorkspace):
		return ErrInvalidInput
	case errors.Is(err, workspaceid.ErrRecentWorkspaceUnknown),
		errors.Is(err, workspaceid.ErrRecentWorkspaceInactive):
		return ErrLibraryCapability
	default:
		return ErrLibraryUnavailable
	}
}

func appStateView(focus WorkspaceFocus, artifact *ArtifactLocatorV1DTO) (appstate.WorkspaceView, bool) {
	view := appstate.WorkspaceView{Focus: appstate.Focus(focus)}
	if focus != WorkspaceFocusChat && focus != WorkspaceFocusNote && focus != WorkspaceFocusGraph {
		return appstate.WorkspaceView{}, false
	}
	if artifact != nil {
		if !validArtifactLocator(*artifact) {
			return appstate.WorkspaceView{}, false
		}
		view.Artifact = &appstate.ArtifactLocatorV1{
			Version: artifact.Version, Kind: appstate.ArtifactKind(artifact.Kind),
			RelativePath: artifact.RelativePath,
		}
	}
	return view, view.Validate() == nil
}

func workspaceFocus(focus appstate.Focus) WorkspaceFocus {
	switch focus {
	case appstate.FocusChat:
		return WorkspaceFocusChat
	case appstate.FocusNote:
		return WorkspaceFocusNote
	case appstate.FocusGraph:
		return WorkspaceFocusGraph
	default:
		return ""
	}
}

func cloneArtifactDTO(artifact *ArtifactLocatorV1DTO) *ArtifactLocatorV1DTO {
	if artifact == nil {
		return nil
	}
	cloned := *artifact
	return &cloned
}
