package workspaceid

import (
	"errors"
	"sort"
)

const registrySafetyBudget = MaxRegistryBytes * 9 / 10

func fitRegistryToBudget(registry Registry) (Registry, []byte, error) {
	active := make([]Record, 0, len(registry.Records))
	inactive := make([]Record, 0, len(registry.Records))
	for _, record := range registry.Records {
		if record.Active {
			active = append(active, record)
		} else {
			inactive = append(inactive, record)
		}
	}
	if len(active) > MaxRegistryRecords {
		return Registry{}, nil, errors.New("active workspace registry exceeds record limit")
	}
	result := Registry{SchemaVersion: registry.SchemaVersion, Records: active}
	raw, err := encodeRegistry(result)
	if err != nil {
		return Registry{}, nil, err
	}
	if len(raw) > MaxRegistryBytes {
		return Registry{}, nil, errors.New("active workspace registry exceeds durable size limit")
	}
	fullRaw, err := encodeRegistry(registry)
	if err != nil {
		return Registry{}, nil, err
	}
	if len(registry.Records) <= MaxRegistryRecords && len(fullRaw) <= registrySafetyBudget {
		return registry, fullRaw, nil
	}
	if len(raw) > registrySafetyBudget {
		return result, raw, nil
	}
	sort.SliceStable(inactive, func(left, right int) bool {
		if inactive[left].LastSeenAt.Equal(inactive[right].LastSeenAt) {
			return inactive[left].WorkspaceID < inactive[right].WorkspaceID
		}
		return inactive[left].LastSeenAt.After(inactive[right].LastSeenAt)
	})
	for _, tombstone := range inactive {
		if len(result.Records) >= MaxRegistryRecords {
			break
		}
		trial := Registry{SchemaVersion: result.SchemaVersion, Records: appendCopy(result.Records, tombstone)}
		trialRaw, encodeErr := encodeRegistry(trial)
		if encodeErr != nil {
			return Registry{}, nil, encodeErr
		}
		if len(trialRaw) <= registrySafetyBudget {
			result, raw = trial, trialRaw
		}
	}
	return result, raw, nil
}

func appendCopy(records []Record, record Record) []Record {
	result := make([]Record, len(records), len(records)+1)
	copy(result, records)
	return append(result, record)
}

func makeRoomForRecord(registry Registry) (Registry, error) {
	if len(registry.Records) < MaxRegistryRecords {
		return registry, nil
	}
	fitted, _, err := fitRegistryToBudget(registry)
	if err != nil {
		return Registry{}, err
	}
	if len(fitted.Records) < MaxRegistryRecords {
		return fitted, nil
	}
	for index := len(fitted.Records) - 1; index >= 0; index-- {
		if !fitted.Records[index].Active {
			fitted.Records = append(fitted.Records[:index], fitted.Records[index+1:]...)
			return fitted, nil
		}
	}
	return Registry{}, errors.New("active workspace registry exceeds record limit")
}
