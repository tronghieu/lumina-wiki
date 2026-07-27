package chat

import (
	"fmt"
	"strings"
	"testing"
)

func TestCitationParserClassifiesWholeTokensNestedAndUnclosed(t *testing.T) {
	allowlist, _ := allowlistFor(t, "needle evidence", "needle")
	defer allowlist.Close()
	text := "valid [S1] duplicate [S1] zero [S0] high [S65] lower [s1] mixed [sA] nondigit [Sx] suffix [S1x] prefix [xS1] nested [[S2]] unclosed [S12"
	got, err := allowlist.Extract(text)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Citations) != 1 || got.ValidCount != 1 || got.UnknownCount != 0 || got.OutOfRangeCount != 2 || got.MalformedCount != 7 {
		t.Fatalf("diagnostics = %#v", got)
	}
}

func TestCitationParserDiagnosticSaturationNeverSuppressesCanonicalID(t *testing.T) {
	allowlist, _ := allowlistFor(t, "needle evidence", "needle")
	defer allowlist.Close()
	var text strings.Builder
	text.WriteString("noise-before ")
	for index := 0; index < MaxDiagnosticKeys; index++ {
		text.WriteString(fmt.Sprintf("[bad-%d] ", index))
	}
	text.WriteString("prefix-noise [S1] middle [S1] suffix-noise")
	got, err := allowlist.Extract(text.String())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Citations) != 1 || got.ValidCount != 1 || got.Citations[0].ModelID != "S1" || got.MalformedCount != MaxDiagnosticKeys {
		t.Fatalf("saturated diagnostics = %#v", got)
	}
}

func TestCitationParserHandlesHugeOverflowingNumericTokenAndDeduplicatesLongIDs(t *testing.T) {
	allowlist, _ := allowlistFor(t, "needle evidence", "needle")
	defer allowlist.Close()
	long := "[S1234567890123456789012345678901234567890]"
	huge := "[S" + strings.Repeat("9", 200_000) + "]"
	got, err := allowlist.Extract(long + " repeated " + long + " huge " + huge)
	if err != nil {
		t.Fatal(err)
	}
	if got.ValidCount != 0 || got.UnknownCount != 0 || got.MalformedCount != 0 || got.OutOfRangeCount != 2 {
		t.Fatalf("long diagnostics = %#v", got)
	}
}

func TestCitationParserNeverNavigatesUnknownCanonicalOrMalformedTokens(t *testing.T) {
	allowlist, _ := allowlistFor(t, "needle evidence", "needle")
	defer allowlist.Close()
	got, err := allowlist.Extract("unknown [S2] [S2] malformed [[S1]]")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Citations) != 0 || got.UnknownCount != 1 || got.MalformedCount != 1 {
		t.Fatalf("navigation leak = %#v", got)
	}
}
