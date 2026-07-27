package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestChatAndCitationDTOsExposeNoAuthorityOrCredentialFields(t *testing.T) {
	types := []reflect.Type{
		reflect.TypeOf(ChatRequestDTO{}), reflect.TypeOf(ChatCompletionDTO{}),
		reflect.TypeOf(CitationReadRequestDTO{}), reflect.TypeOf(CitationNoteDTO{}), reflect.TypeOf(ChatEventDTO{}),
	}
	for _, typ := range types {
		assertSafeDTOFields(t, typ, map[reflect.Type]bool{})
	}
	raw, err := json.Marshal(ChatRequestDTO{
		Session:   SessionReferenceDTO{SessionID: "sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", Generation: 1},
		RequestID: "request", ConversationID: "conversation", Question: "safe",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main", EmbeddingProfileID: "embedding-main"},
		History:  ChatHistoryOptionsDTO{Include: true, Persist: true}, SelectedPath: "wiki/a.md",
	})
	if err != nil {
		t.Fatal(err)
	}
	serialized := strings.ToLower(string(raw))
	for _, forbidden := range []string{"credential", "baseurl", "root", "window", "/private/", `\\`} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("serialized DTO contains %q: %s", forbidden, raw)
		}
	}
}

func assertSafeDTOFields(t *testing.T, typ reflect.Type, seen map[reflect.Type]bool) {
	t.Helper()
	for typ.Kind() == reflect.Pointer || typ.Kind() == reflect.Slice || typ.Kind() == reflect.Array {
		typ = typ.Elem()
	}
	if typ.Kind() != reflect.Struct || seen[typ] {
		return
	}
	seen[typ] = true
	for index := 0; index < typ.NumField(); index++ {
		field := typ.Field(index)
		name := strings.ToLower(field.Name + " " + field.Tag.Get("json"))
		for _, forbidden := range []string{"secret", "credential", "baseurl", "root", "window"} {
			if strings.Contains(name, forbidden) {
				t.Fatalf("%s exposes forbidden field %s", typ, field.Name)
			}
		}
		assertSafeDTOFields(t, field.Type, seen)
	}
}
