package index

import (
	"encoding/hex"
	"math"
	"testing"
)

func TestFloat32LittleEndianRoundTrip(t *testing.T) {
	want := []float32{1, -2.5, 0.25}
	raw, err := EncodeFloat32LE(want)
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(raw); got != "0000803f000020c00000803e" {
		t.Fatalf("endian fixture: %s", got)
	}
	got, err := DecodeFloat32LE(raw, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("[%d]=%v", i, got[i])
		}
	}
}

func TestFloat32CodecRejectsUnsafeValuesAndSizes(t *testing.T) {
	for _, vector := range [][]float32{{float32(math.NaN())}, {float32(math.Inf(1))}, {}} {
		if _, err := EncodeFloat32LE(vector); err == nil {
			t.Fatalf("accepted %#v", vector)
		}
	}
	if _, err := DecodeFloat32LE([]byte{0, 0, 0}, 1); err == nil {
		t.Fatal("accepted truncated vector")
	}
	if _, err := DecodeFloat32LE(make([]byte, 4), MaxVectorDimensions+1); err == nil {
		t.Fatal("accepted dimension overflow")
	}
}
