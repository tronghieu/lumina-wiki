package index

import (
	"strconv"
	"strings"
	"testing"
)

func TestManifestStrictRoundTripAndUnknownDuplicateRejection(t *testing.T) {
	m := Manifest{Version: CurrentManifestVersion, Generation: "0123456789abcdef0123456789abcdef",
		ChunkerVersion: "chunk-v1", ProfileFingerprint: strings.Repeat("a", 64), Dimensions: 2,
		SnapshotHash: strings.Repeat("b", 64), DocumentHashes: []string{strings.Repeat("c", 64)}, ChunkCount: 1, VectorCount: 1}
	raw, err := EncodeManifest(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeManifest(raw); err != nil {
		t.Fatal(err)
	}
	for _, raw := range [][]byte{
		append(append([]byte{}, raw[:len(raw)-2]...), []byte(`,"extra":1}`+"\n")...),
		[]byte(`{"version":1,"Version":1}`),
		append([]byte{}, raw[:len(raw)-1]...),
	} {
		if _, err := DecodeManifest(raw); err == nil {
			t.Fatalf("accepted malformed %s", raw)
		}
	}
}

func TestChunkMetadataRejectsOffsetsDuplicatesAndUnknownKeys(t *testing.T) {
	h := strings.Repeat("a", 64)
	valid := []byte(`{"chunkId":"` + h + `","contentHash":"` + h + `","offset":0,"count":2}` + "\n")
	if got, err := DecodeVectorRefs(valid, 1, 1, 2, 8); err != nil || len(got) != 1 {
		t.Fatalf("valid: %#v %v", got, err)
	}
	for _, raw := range [][]byte{
		[]byte(`{"chunkId":"` + h + `","contentHash":"` + h + `","offset":1,"count":2}` + "\n"),
		[]byte(`{"chunkId":"` + h + `","contentHash":"` + h + `","offset":0,"count":2,"x":1}` + "\n"),
		[]byte(`{"chunkId":"` + h + `","chunkId":"` + h + `","contentHash":"` + h + `","offset":0,"count":2}` + "\n"),
	} {
		if _, err := DecodeVectorRefs(raw, 1, 1, 2, 8); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestVectorRefsValidateUniqueBlocksIndependentOfLineOrder(t *testing.T) {
	a, b, c, d := strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64), strings.Repeat("d", 64)
	line := func(id, hash string, offset int) string {
		return `{"chunkId":"` + id + `","contentHash":"` + hash + `","offset":` + strconv.Itoa(offset) + `,"count":2}` + "\n"
	}
	outOfOrder := []byte(line(a, c, 8) + line(b, d, 0))
	if _, err := DecodeVectorRefs(outOfOrder, 2, 2, 2, 16); err != nil {
		t.Fatalf("line order mattered: %v", err)
	}
	for name, fixture := range map[string]struct {
		raw             []byte
		chunks, vectors int
		size            int64
	}{
		"leading gap":                {[]byte(line(a, c, 8)), 1, 1, 16},
		"interior gap":               {[]byte(line(a, c, 0) + line(b, d, 12)), 2, 2, 20},
		"same hash different block":  {[]byte(line(a, c, 0) + line(b, c, 8)), 2, 1, 16},
		"distinct hash shared block": {[]byte(line(a, c, 0) + line(b, d, 0)), 2, 2, 8},
		"forged vector count":        {[]byte(line(a, c, 0)), 1, 2, 8},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeVectorRefs(fixture.raw, fixture.chunks, fixture.vectors, 2, fixture.size); err == nil {
				t.Fatal("invalid coverage accepted")
			}
		})
	}
	duplicateReuse := []byte(line(a, c, 0) + line(b, c, 0))
	if _, err := DecodeVectorRefs(duplicateReuse, 2, 1, 2, 8); err != nil {
		t.Fatalf("duplicate reuse rejected: %v", err)
	}
}
