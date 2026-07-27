package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func validProfileRequest(role string) SaveAIProfileRequestDTO {
	return SaveAIProfileRequestDTO{ID: role + "-main", Role: role, Kind: "openai", Label: " Main ", Model: " model ",
		BaseURL: "https://api.example.com/", CredentialRef: "shared:key", TimeoutMS: 1000,
		MaxInputChars: 1000, MaxHistoryChars: 500, MaxEvidenceChars: 500, MaxOutputTokens: 100, Dimensions: 0}
}

func TestSaveAIProfileNormalizesFixedSlotAndPreservesConfig(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	grant := settings.EmbeddingConsentGrant{WorkspaceID: "ws_0123456789abcdef0123456789abcdef", Fingerprint: strings.Repeat("a", 64), DisclosureVersion: 1, GrantedAt: time.Now().UTC()}
	service.settings.(*settingsRepositoryStub).config = settings.Config{SchemaVersion: settings.CurrentSchemaVersion,
		Embedding:         &settings.Profile{SchemaVersion: 1, ID: "embed-old", Role: settings.RoleEmbedding, Kind: settings.ProviderOpenAI, Label: "Embed", Model: "embed", BaseURL: "https://api.example.com", TimeoutMS: 1000, MaxInputChars: 10, MaxOutputTokens: 10},
		EmbeddingConsents: []settings.EmbeddingConsentGrant{grant}}
	got, err := service.SaveAIProfile(context.Background(), validProfileRequest("chat"))
	if err != nil {
		t.Fatal(err)
	}
	if got.SchemaVersion != settings.CurrentProfileSchemaVersion || got.Role != "chat" || got.Label != "Main" || got.Model != "model" || got.BaseURL != "https://api.example.com" {
		t.Fatalf("profile=%+v", got)
	}
	stored := service.settings.(*settingsRepositoryStub).config
	if stored.Chat == nil || stored.Embedding == nil || len(stored.EmbeddingConsents) != 1 {
		t.Fatalf("config=%+v", stored)
	}
}

func TestSaveAIProfileRejectsRoleProviderMismatch(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	request := validProfileRequest("embedding")
	request.Kind = "anthropic"
	if _, err := service.SaveAIProfile(context.Background(), request); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err=%v", err)
	}
}

func TestDeleteAIProfileRequiresCurrentSlotID(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	profile := validProfileRequest("chat")
	if _, err := service.SaveAIProfile(context.Background(), profile); err != nil {
		t.Fatal(err)
	}
	miss, err := service.DeleteAIProfile(context.Background(), DeleteAIProfileRequestDTO{Role: "chat", ID: "other"})
	if err != nil || miss.Removed {
		t.Fatalf("miss=%+v err=%v", miss, err)
	}
	removed, err := service.DeleteAIProfile(context.Background(), DeleteAIProfileRequestDTO{Role: "chat", ID: profile.ID})
	if err != nil || !removed.Removed || removed.Role != "chat" || removed.ID != profile.ID {
		t.Fatalf("removed=%+v err=%v", removed, err)
	}
}

func TestDeleteAIProfileRejectsInvalidProfileID(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	if _, err := service.DeleteAIProfile(context.Background(), DeleteAIProfileRequestDTO{Role: "chat", ID: "../unsafe"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err=%v", err)
	}
}

func TestAIProfilesJSONContainsOnlyFixedSafeSlots(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	if _, err := service.SaveAIProfile(context.Background(), validProfileRequest("chat")); err != nil {
		t.Fatal(err)
	}
	profiles, err := service.ListAIProfiles(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(profiles)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" || json.Valid(raw) == false {
		t.Fatalf("json=%q", raw)
	}
	want := `{"chat":{"schemaVersion":1,"id":"chat-main","role":"chat","kind":"openai","label":"Main","model":"model","baseUrl":"https://api.example.com","credentialRef":"shared:key","timeoutMs":1000,"maxInputChars":1000,"maxHistoryChars":500,"maxEvidenceChars":500,"maxOutputTokens":100}}`
	if string(raw) != want {
		t.Fatalf("json=%s", raw)
	}
	for _, forbidden := range []string{"embeddingConsents", "secret", "credentialBytes"} {
		if containsJSONField(raw, forbidden) {
			t.Fatalf("forbidden %q in %s", forbidden, raw)
		}
	}
}

func TestSettingsFacadeSanitizesStoreErrorsAndPreservesContext(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	store := service.settings.(*settingsRepositoryStub)
	store.loadErr = errors.New("private config path /Users/person")
	if _, err := service.ListAIProfiles(context.Background()); !errors.Is(err, ErrSettingsUnavailable) || strings.Contains(err.Error(), "Users") {
		t.Fatalf("load err=%v", err)
	}
	store.loadErr = nil
	store.saveErr = errors.New("private config write path")
	if _, err := service.SaveAIProfile(context.Background(), validProfileRequest("chat")); !errors.Is(err, ErrSettingsUnavailable) || strings.Contains(err.Error(), "path") {
		t.Fatalf("save err=%v", err)
	}
	store.saveErr = nil
	store.config.SchemaVersion = 99
	if _, err := service.SaveAIProfile(context.Background(), validProfileRequest("chat")); !errors.Is(err, ErrSettingsUnavailable) {
		t.Fatalf("corrupt config err=%v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.ListAIProfiles(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel err=%v", err)
	}
}

func containsJSONField(raw []byte, field string) bool {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return true
	}
	return recursiveJSONField(value, field)
}

func recursiveJSONField(value any, field string) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == field || recursiveJSONField(child, field) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if recursiveJSONField(child, field) {
				return true
			}
		}
	}
	return false
}
