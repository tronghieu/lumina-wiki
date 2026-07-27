package ai

import "time"

type CredentialReferenceDTO struct {
	CredentialRef string `json:"credentialRef"`
}

type CredentialStatusDTO struct {
	Status string `json:"status"`
}

type SaveCredentialRequestDTO struct {
	CredentialRef string `json:"credentialRef"`
	Secret        []byte `json:"secret"`
}

type ConfirmSessionCredentialRequestDTO struct {
	Nonce  string `json:"nonce"`
	Secret []byte `json:"secret"`
}

type CredentialChallengeDTO struct {
	Nonce     string    `json:"nonce"`
	Reason    string    `json:"reason"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type CredentialSaveResultDTO struct {
	Disposition string                  `json:"disposition"`
	Challenge   *CredentialChallengeDTO `json:"challenge,omitempty"`
}

type CredentialDeleteResultDTO struct {
	Deleted bool   `json:"deleted"`
	Status  string `json:"status"`
}
