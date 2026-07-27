package ai

import "github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"

type AIProfilesDTO struct {
	Chat      *AIProfileDTO `json:"chat,omitempty"`
	Embedding *AIProfileDTO `json:"embedding,omitempty"`
}

type AIProfileDTO struct {
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	Role             string `json:"role"`
	Kind             string `json:"kind"`
	Label            string `json:"label"`
	Model            string `json:"model"`
	BaseURL          string `json:"baseUrl"`
	CredentialRef    string `json:"credentialRef,omitempty"`
	TimeoutMS        int    `json:"timeoutMs"`
	MaxInputChars    int    `json:"maxInputChars"`
	MaxHistoryChars  int    `json:"maxHistoryChars"`
	MaxEvidenceChars int    `json:"maxEvidenceChars"`
	MaxOutputTokens  int    `json:"maxOutputTokens"`
	Dimensions       int    `json:"dimensions,omitempty"`
}

type SaveAIProfileRequestDTO struct {
	ID               string `json:"id"`
	Role             string `json:"role"`
	Kind             string `json:"kind"`
	Label            string `json:"label"`
	Model            string `json:"model"`
	BaseURL          string `json:"baseUrl"`
	CredentialRef    string `json:"credentialRef,omitempty"`
	TimeoutMS        int    `json:"timeoutMs"`
	MaxInputChars    int    `json:"maxInputChars"`
	MaxHistoryChars  int    `json:"maxHistoryChars"`
	MaxEvidenceChars int    `json:"maxEvidenceChars"`
	MaxOutputTokens  int    `json:"maxOutputTokens"`
	Dimensions       int    `json:"dimensions,omitempty"`
}

type DeleteAIProfileRequestDTO struct {
	Role string `json:"role"`
	ID   string `json:"id"`
}

type ProfileDeleteResultDTO struct {
	Removed bool   `json:"removed"`
	Role    string `json:"role"`
	ID      string `json:"id"`
}

func profileDTO(profile *settings.Profile) *AIProfileDTO {
	if profile == nil {
		return nil
	}
	return &AIProfileDTO{SchemaVersion: profile.SchemaVersion, ID: profile.ID, Role: string(profile.Role), Kind: string(profile.Kind),
		Label: profile.Label, Model: profile.Model, BaseURL: profile.BaseURL, CredentialRef: profile.CredentialRef,
		TimeoutMS: profile.TimeoutMS, MaxInputChars: profile.MaxInputChars, MaxHistoryChars: profile.MaxHistoryChars,
		MaxEvidenceChars: profile.MaxEvidenceChars, MaxOutputTokens: profile.MaxOutputTokens, Dimensions: profile.Dimensions}
}

func (request SaveAIProfileRequestDTO) profile() settings.Profile {
	return settings.Profile{SchemaVersion: settings.CurrentProfileSchemaVersion, ID: request.ID,
		Role: settings.ProfileRole(request.Role), Kind: settings.ProviderKind(request.Kind), Label: request.Label,
		Model: request.Model, BaseURL: request.BaseURL, CredentialRef: request.CredentialRef, TimeoutMS: request.TimeoutMS,
		MaxInputChars: request.MaxInputChars, MaxHistoryChars: request.MaxHistoryChars, MaxEvidenceChars: request.MaxEvidenceChars,
		MaxOutputTokens: request.MaxOutputTokens, Dimensions: request.Dimensions}
}
