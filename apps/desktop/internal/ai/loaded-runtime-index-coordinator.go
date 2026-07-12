package ai

import "context"

type runtimeIndexMutationKind uint8

const (
	runtimeIndexMutationBuild runtimeIndexMutationKind = iota + 1
	runtimeIndexMutationClear
)

func (runtime *loadedRuntime) indexBuilding(profileID string) bool {
	runtime.indexMu.Lock()
	defer runtime.indexMu.Unlock()
	return runtime.indexMutation != nil && runtime.indexMutation.kind == runtimeIndexMutationBuild && runtime.indexMutation.profileID == profileID
}

func (runtime *loadedRuntime) startIndexBuild(parent context.Context, profileID string) (context.Context, func(), error) {
	return runtime.startIndexMutation(parent, runtimeIndexMutationBuild, profileID)
}

func (runtime *loadedRuntime) startIndexClear() (func(), error) {
	_, done, err := runtime.startIndexMutation(nil, runtimeIndexMutationClear, "")
	return done, err
}

func (runtime *loadedRuntime) startIndexMutation(parent context.Context, kind runtimeIndexMutationKind, profileID string) (context.Context, func(), error) {
	runtime.indexMu.Lock()
	defer runtime.indexMu.Unlock()
	if runtime.indexMutation != nil {
		return nil, func() {}, ErrIndexBuildActive
	}
	runtime.indexGeneration++
	ctx, cancel := parent, context.CancelFunc(nil)
	if kind == runtimeIndexMutationBuild {
		ctx, cancel = context.WithCancel(parent)
	}
	mutation := &runtimeIndexMutation{kind: kind, profileID: profileID, generation: runtime.indexGeneration, cancel: cancel}
	runtime.indexMutation = mutation
	return ctx, func() {
		if cancel != nil {
			cancel()
		}
		runtime.indexMu.Lock()
		if runtime.indexMutation == mutation && runtime.indexMutation.generation == mutation.generation {
			runtime.indexMutation = nil
		}
		runtime.indexMu.Unlock()
	}, nil
}
