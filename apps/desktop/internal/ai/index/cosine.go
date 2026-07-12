package index

import (
	"errors"
	"math"
)

var errInvalidVector = errors.New("semantic vector is invalid")

// CosineExact evaluates components in index order using float64 arithmetic.
func CosineExact(a, b []float32) (float64, error) {
	if len(a) == 0 || len(a) != len(b) || len(a) > MaxVectorDimensions {
		return 0, errInvalidVector
	}
	var dot, normA, normB float64
	for i := range a {
		x, y := float64(a[i]), float64(b[i])
		if !finite(x) || !finite(y) {
			return 0, errInvalidVector
		}
		dot += x * y
		normA += x * x
		normB += y * y
		if !finite(dot) || !finite(normA) || !finite(normB) {
			return 0, errInvalidVector
		}
	}
	if normA == 0 || normB == 0 {
		return 0, errInvalidVector
	}
	denominator := math.Sqrt(normA) * math.Sqrt(normB)
	if denominator == 0 || !finite(denominator) {
		return 0, errInvalidVector
	}
	score := dot / denominator
	if !finite(score) {
		return 0, errInvalidVector
	}
	if score > 1 {
		score = 1
	} else if score < -1 {
		score = -1
	}
	return score, nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func validVector(vector []float32) bool {
	if len(vector) == 0 || len(vector) > MaxVectorDimensions {
		return false
	}
	var norm float64
	for _, value := range vector {
		x := float64(value)
		if !finite(x) {
			return false
		}
		norm += x * x
		if !finite(norm) {
			return false
		}
	}
	return norm > 0
}
