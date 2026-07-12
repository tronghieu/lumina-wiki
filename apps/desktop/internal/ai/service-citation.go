package ai

import (
	"context"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func (service *Service) ReadCitationNote(ctx context.Context, request CitationReadRequestDTO) (CitationNoteDTO, error) {
	if service == nil || service.sessions == nil || !validCitationReadRequest(ctx, request) {
		return CitationNoteDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return CitationNoteDTO{}, err
	}
	lease, err := service.sessions.Resolve(window, request.Session.sessionReference())
	if err != nil {
		return CitationNoteDTO{}, ErrSessionRejected
	}
	defer lease.Finish()
	runtime, ok := lease.Runtime().(chatCapableRuntime)
	if !ok || !validRuntime(runtime) {
		return CitationNoteDTO{}, ErrCitationUnavailable
	}
	if wrapped, ok := runtime.(*onceRuntime); ok {
		if _, available := chatRuntimeCapability(wrapped); !available {
			return CitationNoteDTO{}, ErrCitationUnavailable
		}
	}
	note, err := runtime.ReadCitationNote(ctx, request.RequestID, request.CitationID)
	if err != nil || !validCitationNote(note) {
		return CitationNoteDTO{}, ErrCitationUnavailable
	}
	return CitationNoteDTO{Path: note.Path, Heading: note.Heading, Content: note.Content}, nil
}

func validCitationReadRequest(ctx context.Context, request CitationReadRequestDTO) bool {
	return ctx != nil && validSessionReferenceSyntax(request.Session) && validFacadeID(request.RequestID) && citationIDPattern.MatchString(request.CitationID)
}

func validCitationNote(note retrieval.CitationNote) bool {
	if !validRelativeWikiPath(note.Path, false) || len(note.Heading) > maxCitationHeadingBytes ||
		len(note.Content) > retrieval.MaxCitationNoteBytes || !utf8.ValidString(note.Heading) || !utf8.ValidString(note.Content) {
		return false
	}
	for _, character := range note.Heading {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}
