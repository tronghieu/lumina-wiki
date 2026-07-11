package providers

import "encoding/json"

func jsonUnmarshal(data string, target any) error { return json.Unmarshal([]byte(data), target) }
