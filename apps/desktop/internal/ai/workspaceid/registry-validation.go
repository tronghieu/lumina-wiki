package workspaceid

import "errors"

func (registry Registry) validate() error {
	return registry.validateContent(true)
}

func (registry Registry) validateContent(enforceRecordLimit bool) error {
	if registry.SchemaVersion != CurrentSchemaVersion {
		return errors.New("workspace registry version is unsupported")
	}
	if enforceRecordLimit && len(registry.Records) > MaxRegistryRecords {
		return errors.New("workspace registry exceeds record limit")
	}
	activePaths := map[string]struct{}{}
	ids := map[WorkspaceID]struct{}{}
	for _, record := range registry.Records {
		if record.SchemaVersion != CurrentSchemaVersion || !record.WorkspaceID.Valid() {
			return errors.New("workspace registry contains an invalid record")
		}
		if !validCanonicalPath(record.CanonicalPath) {
			return errors.New("workspace registry contains an invalid path")
		}
		if record.FilesystemSignature != "" && !validSignature(record.FilesystemSignature) {
			return errors.New("workspace registry contains an invalid signature")
		}
		if record.FirstSeenAt.IsZero() || record.LastSeenAt.IsZero() || record.LastSeenAt.Before(record.FirstSeenAt) {
			return errors.New("workspace registry contains invalid timestamps")
		}
		if _, exists := ids[record.WorkspaceID]; exists {
			return errors.New("workspace registry contains duplicate identities")
		}
		ids[record.WorkspaceID] = struct{}{}
		if record.Active {
			key := pathKey(record.CanonicalPath)
			if _, exists := activePaths[key]; exists {
				return errors.New("workspace registry contains duplicate active paths")
			}
			activePaths[key] = struct{}{}
		}
	}
	return nil
}
