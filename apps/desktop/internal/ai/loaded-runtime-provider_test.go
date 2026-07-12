package ai

import (
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestLoadedRuntimeDefaultProviderResolvesCredentialOnlyInsideStream(t *testing.T) {
	root := runtimeWorkspace(t)
	credentials := &runtimeCredentialSpy{}
	profile := runtimeProfile("chat-main", settings.RoleChat)
	profile.BaseURL = "http://127.0.0.1:11434/v1"
	profile.CredentialRef = "keyring:chat"
	configValue := settings.DefaultConfig()
	configValue.Chat = &profile
	stream := "data: {\"choices\":[{\"delta\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\n" +
		"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\n" + "data: [DONE]\n\n"
	client := providers.SafeClient{NewRoundTripper: func(providers.ApprovedEndpoint) http.RoundTripper {
		return runtimeRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.Header.Get("Authorization") != "Bearer secret" {
				t.Fatalf("credential header missing")
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(stream))}, nil
		})
	}}
	proof := &runtimeTrustSpy{}
	proof.proof, _ = os.Stat(root)
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{Trust: proof, Config: &runtimeConfigSpy{config: configValue},
		Credentials: credentials, Client: client, HistoryBase: t.TempDir(),
		HistoryFactory: func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error) { return &runtimeHistorySpy{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := factory.Load(context.Background(), "ws_11111111111111111111111111111111", root)
	if err != nil || credentials.calls != 0 {
		t.Fatalf("eager credential resolution = %d, %v", credentials.calls, err)
	}
	runtime := loaded.(*loadedRuntime)
	capture := &runtimeEventCapture{}
	if err := runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "question",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"}}, capture); err != nil {
		t.Fatal(err)
	}
	if credentials.calls != 1 || strings.Contains(eventText(capture.events), "secret") {
		t.Fatalf("credential calls=%d events=%s", credentials.calls, eventText(capture.events))
	}
}

type runtimeRoundTripFunc func(*http.Request) (*http.Response, error)

func (function runtimeRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func eventText(events []chat.Event) string {
	var builder strings.Builder
	for _, event := range events {
		builder.WriteString(event.Delta)
		builder.WriteString(event.ErrorCode)
	}
	return builder.String()
}
