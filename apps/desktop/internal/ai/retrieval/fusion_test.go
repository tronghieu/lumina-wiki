package retrieval

import (
	"errors"
	"reflect"
	"testing"
)

func rankedHit(id string, rank int) Hit { return Hit{Chunk: Chunk{ID: id}, Score: 1, Rank: rank} }

func TestFuseRanksDeterministicOverlapAndSemanticOnly(t *testing.T) {
	a, b, c := ContentHash("a"), ContentHash("b"), ContentHash("c")
	lexical := []Hit{rankedHit(a, 1), rankedHit(b, 2)}
	semantic := []SemanticHit{{ChunkID: b, Score: .8, Rank: 1}, {ChunkID: c, Score: .7, Rank: 2}}
	want := []string{b, a, c}
	for range 20 {
		fused := FuseRanks(lexical, semantic, RRFK, 10)
		got := []string{fused[0].ChunkID, fused[1].ChunkID, fused[2].ChunkID}
		if !reflect.DeepEqual(got, want) || fused[0].LexicalRank != 2 || fused[0].SemanticRank != 1 {
			t.Fatalf("fused=%#v", fused)
		}
	}
}

func TestFuseRanksLexicalOnlyPreservesOrderAndIgnoresInvalidDuplicates(t *testing.T) {
	a, b := ContentHash("a"), ContentHash("b")
	lexical := []Hit{rankedHit(a, 1), rankedHit(a, 3), rankedHit(b, 2), rankedHit("bad", 1)}
	fused := FuseRanks(lexical, []SemanticHit{{ChunkID: b, Score: 1, Rank: -1}}, RRFK, 10)
	if got := []string{fused[0].ChunkID, fused[1].ChunkID}; !reflect.DeepEqual(got, []string{a, b}) {
		t.Fatalf("order=%#v", got)
	}
}

func TestFuseOrFallbackMakesSemanticFailureVisibleAndKeepsLexicalOrder(t *testing.T) {
	a, b := ContentHash("a"), ContentHash("b")
	lexical := []Hit{rankedHit(a, 1), rankedHit(b, 2)}
	result := FuseOrFallback(lexical, nil, errors.New("private /tmp/cache detail"), RRFK, 10, false)
	if result.SemanticStatus != SemanticUnavailable || result.WarningCode != WarningSemanticUnavailable {
		t.Fatalf("status=%#v", result)
	}
	if got := []string{result.Hits[0].ChunkID, result.Hits[1].ChunkID}; !reflect.DeepEqual(got, []string{a, b}) {
		t.Fatalf("fallback=%#v", result.Hits)
	}
	disabled := FuseOrFallback(lexical, nil, nil, RRFK, 10, true)
	if disabled.SemanticStatus != SemanticDisabled || disabled.WarningCode != "" {
		t.Fatalf("disabled=%#v", disabled)
	}
}
