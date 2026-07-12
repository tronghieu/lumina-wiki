package session

import (
	"encoding/base64"
	"errors"
	"reflect"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

const (
	sessionPrefix   = "sess_"
	sessionBytes    = 32
	maxIDAttempts   = 8
	maxDisplayLabel = 256
)

var (
	ErrInvalidInput   = errors.New("invalid session input")
	ErrInvalidSession = errors.New("invalid or expired session")
	ErrRequestActive  = errors.New("request already active")
	ErrRegistryClosed = errors.New("session registry closed")
	ErrSessionEntropy = errors.New("session ID generation failed")
	ErrRuntimeClose   = errors.New("session runtime close failed")

	requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
)

type WindowID uint64

type SessionID string

type Generation uint64

type Runtime interface {
	Close() error
}

type DisplayMetadata struct {
	Label string
}

type Reference struct {
	SessionID  SessionID
	Generation Generation
}

type Capability struct {
	SessionID   SessionID
	WorkspaceID workspaceid.WorkspaceID
	Generation  Generation
	Display     DisplayMetadata
}

func (capability Capability) Reference() Reference {
	return Reference{SessionID: capability.SessionID, Generation: capability.Generation}
}

func validSessionID(id SessionID) bool {
	value := string(id)
	if len(value) != len(sessionPrefix)+base64.RawURLEncoding.EncodedLen(sessionBytes) || value[:len(sessionPrefix)] != sessionPrefix {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(value[len(sessionPrefix):])
	return err == nil && len(raw) == sessionBytes
}

func validDisplay(display DisplayMetadata) bool {
	label := display.Label
	if label == "" || label == "." || label == ".." || len(label) > maxDisplayLabel || !utf8.ValidString(label) || strings.ContainsAny(label, `/\`) {
		return false
	}
	for _, character := range label {
		if !unicode.IsPrint(character) || unicode.Is(unicode.Cf, character) {
			return false
		}
	}
	return true
}

func validRuntime(runtime Runtime) bool {
	if runtime == nil {
		return false
	}
	value := reflect.ValueOf(runtime)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return !value.IsNil()
	default:
		return true
	}
}
