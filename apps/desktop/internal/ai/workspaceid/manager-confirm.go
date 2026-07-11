package workspaceid

import "errors"

func (m *Manager) ConfirmAttach(token string) (WorkspaceID, error) {
	if err := m.validate(); err != nil {
		return "", err
	}
	pending, err := m.takeDecision(token)
	if err != nil {
		return "", err
	}
	adopted := false
	defer func() {
		if !adopted {
			_ = pending.candidate.handle.Close()
		}
	}()
	if err := revalidateHandle(pending.candidate); err != nil {
		return "", ErrCandidateChanged
	}
	current := pending.candidate.Candidate
	m.commitMu.Lock()
	defer m.commitMu.Unlock()
	release, err := m.store.acquireLock()
	if err != nil {
		return "", err
	}
	defer release()
	registry, revision, err := m.store.LoadSnapshot()
	if err != nil {
		return "", err
	}
	if revision != pending.revision || !sameWorkspaceIDs(matchedWorkspaceIDs(registry, current), pending.targetIDs) {
		return "", ErrRegistryConflict
	}
	kind, index := classifyCandidate(registry, current)
	if kind != pending.kind && !(pending.kind == AttachKnown && kind == AttachIdentityConfirmationRequired) {
		return "", ErrRegistryConflict
	}
	now := m.clock().UTC()
	var id WorkspaceID
	switch pending.kind {
	case AttachKnown, AttachIdentityConfirmationRequired:
		if index < 0 {
			return "", ErrRegistryConflict
		}
		registry.Records[index].LastSeenAt = now
		id = registry.Records[index].WorkspaceID
	case AttachRenameConfirmationRequired:
		if index < 0 {
			return "", ErrRegistryConflict
		}
		registry.Records[index].CanonicalPath = current.CanonicalPath
		registry.Records[index].LastSeenAt = now
		id = registry.Records[index].WorkspaceID
	case AttachNew, AttachPathReuseConfirmationRequired, AttachAmbiguousConfirmationRequired:
		registry, err = makeRoomForRecord(registry)
		if err != nil {
			return "", err
		}
		id, err = m.newUniqueID(registry)
		if err != nil {
			return "", err
		}
		for recordIndex := range registry.Records {
			if registry.Records[recordIndex].Active && pathKey(registry.Records[recordIndex].CanonicalPath) == pathKey(current.CanonicalPath) {
				registry.Records[recordIndex].Active = false
				registry.Records[recordIndex].LastSeenAt = now
			}
		}
		signature := current.Signature
		if !current.HasSignature {
			signature = ""
		}
		registry.Records = append(registry.Records, Record{SchemaVersion: CurrentSchemaVersion,
			WorkspaceID: id, CanonicalPath: current.CanonicalPath, FilesystemSignature: signature,
			FirstSeenAt: now, LastSeenAt: now, Active: true})
	default:
		return "", ErrRegistryConflict
	}
	if err := m.store.Save(registry); err != nil {
		return "", err
	}
	m.adoptTrusted(id, pending.candidate)
	adopted = true
	return id, nil
}

func (m *Manager) newUniqueID(registry Registry) (WorkspaceID, error) {
	for range MaxRegistryRecords + 1 {
		id, err := m.idSource()
		if err != nil || !id.Valid() {
			return "", errors.New("create workspace identity failed")
		}
		unique := true
		for _, record := range registry.Records {
			if record.WorkspaceID == id {
				unique = false
				break
			}
		}
		if unique {
			return id, nil
		}
	}
	return "", errors.New("create workspace identity failed")
}
