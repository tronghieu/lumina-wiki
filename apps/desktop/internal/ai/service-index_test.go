package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
)

func TestIndexFacadeMapsSafeDTO(t *testing.T) {
	runtime := &managementRuntimeStub{indexStatus: index.IndexStatus{State: index.StateReady, Chunks: 2, Vectors: 2, Dimensions: 8}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	result, err := service.IndexStatus(context.Background(), IndexRequestDTO{Session: bridgeReference(capability), EmbeddingProfileID: "embed-main"})
	if err != nil || result.State != "ready" || result.Chunks != 2 || result.Dimensions != 8 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "root") || strings.Contains(string(raw), "credential") || strings.Contains(string(raw), "profile") {
		t.Fatalf("unsafe DTO %s", raw)
	}
}

func TestIndexFacadeRejectsForgedCapabilityBeforeRuntimeAndCorruptOutput(t *testing.T) {
	runtime := &managementRuntimeStub{indexStatus: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	request := IndexRequestDTO{Session: bridgeReference(capability), EmbeddingProfileID: "embed.main"}
	request.Session.Generation++
	request.EmbeddingProfileID = "\x00"
	if _, err := service.IndexStatus(context.Background(), request); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("forged err=%v", err)
	}
	if calls, _ := runtime.counts(); calls != 0 {
		t.Fatalf("calls=%d", calls)
	}
	request.Session = bridgeReference(capability)
	request.EmbeddingProfileID = "embed.main"
	runtime.indexStatus = index.IndexStatus{State: "unknown", Chunks: 1, Vectors: 1, Dimensions: 8}
	if _, err := service.IndexStatus(context.Background(), request); !errors.Is(err, ErrIndexUnavailable) {
		t.Fatalf("corrupt err=%v", err)
	}
}
