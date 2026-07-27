package retrieval

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestLexicalMultiTermScoresAreBitwiseStableAcrossRunsAndPermutations(t *testing.T) {
	files := map[string]string{
		"wiki/a.md": "alpha beta gamma delta epsilon zeta eta",
		"wiki/b.md": "alpha beta gamma delta epsilon zeta eta",
	}
	terms := []string{"alpha", "beta", "gamma", "delta", "epsilon", "zeta"}
	thresholds := []int{100, 90, 70, 50, 30, 10}
	for i := 0; i < 100; i++ {
		var body []string
		for j, term := range terms {
			if i < thresholds[j] {
				body = append(body, term)
			}
		}
		files[fmt.Sprintf("wiki/filler-%03d.md", i)] = strings.Join(body, " ")
	}
	index, _ := buildSearch(t, files)
	queries := []string{
		"alpha beta gamma delta epsilon zeta eta",
		"eta zeta epsilon delta gamma beta alpha",
	}
	var wantPaths []string
	var wantBits []uint64
	for run := 0; run < 200; run++ {
		result, err := index.Search(context.Background(), queries[run%len(queries)], SearchOptions{Limit: 2})
		if err != nil {
			t.Fatal(err)
		}
		paths := hitPaths(result.Hits)
		bits := make([]uint64, len(result.Hits))
		for i, hit := range result.Hits {
			bits[i] = math.Float64bits(hit.Score)
		}
		if run == 0 {
			wantPaths, wantBits = paths, bits
			continue
		}
		if !reflect.DeepEqual(paths, wantPaths) || !reflect.DeepEqual(bits, wantBits) {
			t.Fatalf("run %d unstable: paths=%#v bits=%#v want=%#v %#v", run, paths, bits, wantPaths, wantBits)
		}
	}
}
