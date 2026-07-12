package index

import (
	"encoding/binary"
	"errors"
	"math"
)

const (
	MaxVectorDimensions = 4096
	MaxVectorBytes      = 512 * 1024 * 1024
)

func EncodeFloat32LE(vector []float32) ([]byte, error) {
	if len(vector) == 0 || len(vector) > MaxVectorDimensions {
		return nil, errors.New("vector dimensions are invalid")
	}
	raw := make([]byte, len(vector)*4)
	for i, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return nil, errors.New("vector contains an invalid value")
		}
		binary.LittleEndian.PutUint32(raw[i*4:], math.Float32bits(value))
	}
	return raw, nil
}

func DecodeFloat32LE(raw []byte, dimensions int) ([]float32, error) {
	if dimensions < 1 || dimensions > MaxVectorDimensions || dimensions > MaxVectorBytes/4 || len(raw) != dimensions*4 {
		return nil, errors.New("vector size is invalid")
	}
	vector := make([]float32, dimensions)
	for i := range vector {
		value := math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return nil, errors.New("vector contains an invalid value")
		}
		vector[i] = value
	}
	return vector, nil
}
