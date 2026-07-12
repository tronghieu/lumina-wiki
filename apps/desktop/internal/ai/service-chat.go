package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

const maxCitationHeadingBytes = 4096

var (
	facadeIDPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	profileIDPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	citationIDPattern = regexp.MustCompile(`^cit_[0-9a-f]{32}$`)
)

func (service *Service) Chat(ctx context.Context, request ChatRequestDTO) (ChatCompletionDTO, error) {
	if service == nil || service.sessions == nil || service.streams == nil || !validChatRequestDTO(ctx, request) {
		return ChatCompletionDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ChatCompletionDTO{}, err
	}
	requestCtx, lease, err := service.sessions.BeginRequest(ctx, window, request.Session.sessionReference(), request.RequestID)
	if err != nil {
		return ChatCompletionDTO{}, mapBeginRequestError(err)
	}
	defer lease.Finish()
	runtime, ok := lease.Runtime().(chatCapableRuntime)
	if !ok || !validRuntime(runtime) {
		return ChatCompletionDTO{}, ErrChatUnavailable
	}
	if wrapped, ok := runtime.(*onceRuntime); ok {
		if _, available := chatRuntimeCapability(wrapped); !available {
			return ChatCompletionDTO{}, ErrChatUnavailable
		}
	}
	sink, err := service.streams.NewChatSink(requestCtx, window, request.Session)
	if err != nil || sink == nil {
		return ChatCompletionDTO{}, ErrChatUnavailable
	}
	domain := runtimeChatRequest{
		RequestID: request.RequestID, ConversationID: request.ConversationID, Question: request.Question,
		Profiles: request.Profiles, History: request.History, SelectedPath: request.SelectedPath,
		LinkedPaths: append([]string(nil), request.LinkedPaths...),
	}
	if err := runtime.RunChat(requestCtx, domain, sink); err != nil {
		return ChatCompletionDTO{}, ErrChatUnavailable
	}
	return ChatCompletionDTO{RequestID: request.RequestID, ConversationID: request.ConversationID}, nil
}

func mapBeginRequestError(err error) error {
	if errors.Is(err, session.ErrInvalidInput) {
		return ErrInvalidInput
	}
	if errors.Is(err, session.ErrRequestActive) {
		return ErrChatRequestActive
	}
	return ErrSessionRejected
}

func validChatRequestDTO(ctx context.Context, request ChatRequestDTO) bool {
	if ctx == nil || !validSessionReferenceSyntax(request.Session) || !validFacadeID(request.RequestID) || !validFacadeID(request.ConversationID) ||
		!validQuestion(request.Question) || !validProfileSelection(request.Profiles) ||
		!validRelativeWikiPath(request.SelectedPath, true) || len(request.LinkedPaths) > retrieval.MaxLinkedPathInputs {
		return false
	}
	unique := make(map[string]struct{}, len(request.LinkedPaths))
	for _, path := range request.LinkedPaths {
		if !validRelativeWikiPath(path, false) {
			return false
		}
		unique[path] = struct{}{}
	}
	return len(unique) <= retrieval.MaxLinkedPaths
}

func validSessionReferenceSyntax(reference SessionReferenceDTO) bool {
	value := string(reference.SessionID)
	if reference.Generation == 0 || len(value) != len("sess_")+base64.RawURLEncoding.EncodedLen(32) || !strings.HasPrefix(value, "sess_") {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "sess_"))
	return err == nil && len(raw) == 32
}

func validFacadeID(value string) bool {
	return len(value) <= 64 && utf8.ValidString(value) && facadeIDPattern.MatchString(value)
}

func validProfileSelection(value ProfileSelectionDTO) bool {
	if len(value.ChatProfileID) > settings.MaxProfileIDBytes || !profileIDPattern.MatchString(value.ChatProfileID) {
		return false
	}
	return value.EmbeddingProfileID == "" || len(value.EmbeddingProfileID) <= settings.MaxProfileIDBytes && profileIDPattern.MatchString(value.EmbeddingProfileID)
}

func validQuestion(value string) bool {
	if value == "" || len(value) > retrieval.MaxQueryBytes || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) && character != '\n' && character != '\r' && character != '\t' {
			return false
		}
	}
	return true
}

func validRelativeWikiPath(value string, allowEmpty bool) bool {
	if value == "" {
		return allowEmpty
	}
	if len(value) > retrieval.MaxRelativePathBytes || !utf8.ValidString(value) || strings.Contains(value, `\`) {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(value)))
	return clean == value && strings.HasPrefix(value, "wiki/") && strings.HasSuffix(value, ".md") && !strings.Contains(value, "/../")
}
