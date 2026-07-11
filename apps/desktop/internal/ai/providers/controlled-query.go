package providers

import "net/http"

func (c SafeClient) Do(original *http.Request) (*http.Response, error) { return c.do(original, false) }
func (c SafeClient) doGeminiSSE(original *http.Request) (*http.Response, error) {
	return c.do(original, true)
}
