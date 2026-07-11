package providers

import (
	"net/http"
	"net/url"
)

func cloneRedirect(previous *http.Request, next *url.URL) *http.Request {
	request := previous.Clone(previous.Context())
	request.URL = next
	request.Host = ""
	request.Header = previous.Header.Clone()
	return request
}

func redirectRequest(previous *http.Request, next *url.URL, status int) (*http.Request, bool, error) {
	request := cloneRedirect(previous, next)
	dropBody := status == 301 || status == 302 || status == 303
	if dropBody {
		if previous.Method != "HEAD" {
			if previous.Method != "GET" {
				request.Method = "GET"
			}
		}
		request.Body = nil
		request.GetBody = nil
		request.ContentLength = 0
		for _, key := range []string{"Content-Length", "Content-Type", "Transfer-Encoding"} {
			request.Header.Del(key)
		}
		return request, false, nil
	}
	if previous.Body != nil {
		if previous.GetBody == nil {
			return nil, false, NewSafeError("redirect_body_not_replayable", "The provider redirect requires a replayable request body.", nil)
		}
		request.Body = nil
		return request, true, nil
	}
	return request, false, nil
}
