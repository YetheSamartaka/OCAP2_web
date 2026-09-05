package storage

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParsePlayerSnapshotEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(42),
		"inventorySnapshot",
		map[string]interface{}{"unitId": float64(7), "massUnits": 695.0},
	})

	require.NotNil(t, event)
	require.Equal(t, "inventorySnapshot", event.Type)
	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, float64(7), payload["unitId"])
	require.Equal(t, 695.0, payload["massUnits"])
}

// Follow-up snapshots are recorded as diffs against an earlier frame. The server
// only carries them, so the nested "set" object and the "unset" paths must survive
// the round trip through the generic message field untouched.
func TestParsePlayerSnapshotEventPreservesDiff(t *testing.T) {
	for _, eventType := range []string{
		"inventorySnapshot", "medicalSnapshot", "staminaSnapshot", "radioSnapshot",
	} {
		event := parseEventArray([]interface{}{
			float64(120),
			eventType,
			map[string]interface{}{
				"unitId": float64(7),
				"diffOf": float64(60),
				"set": map[string]interface{}{
					"ace": map[string]interface{}{"heartRate": float64(133)},
				},
				"unset": []interface{}{"kat.spo2"},
			},
		})

		require.NotNil(t, event, eventType)
		require.Equal(t, eventType, event.Type)
		require.Equal(t, uint32(120), event.FrameNum)

		var payload map[string]interface{}
		require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
		require.Equal(t, float64(60), payload["diffOf"])
		require.Equal(t, []interface{}{"kat.spo2"}, payload["unset"])

		set := payload["set"].(map[string]interface{})
		ace := set["ace"].(map[string]interface{})
		require.Equal(t, float64(133), ace["heartRate"])
	}
}

func TestParsePlayerSnapshotEventPreservesMedicalLogs(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(80),
		"medicalSnapshot",
		map[string]interface{}{
			"unitId": float64(7),
			"activity": []interface{}{
				map[string]interface{}{"time": "10:02", "text": "Matthew Allen has bandaged patient"},
			},
			"quickView": []interface{}{
				map[string]interface{}{"time": "10:02", "text": "Matthew Allen checked Heart Rate: None"},
			},
		},
	})

	require.NotNil(t, event)
	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	activity := payload["activity"].([]interface{})
	entry := activity[0].(map[string]interface{})
	require.Equal(t, "10:02", entry["time"])
	require.Equal(t, "Matthew Allen has bandaged patient", entry["text"])
}

func TestParseTfarSettingsEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(1),
		"tfarSettings",
		map[string]interface{}{
			"terrainInterceptionCoefficient": 12.0,
			"globalRadioRangeCoef":           0.5,
			"tfarLoaded":                     true,
			"source":                         "cba",
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "tfarSettings", event.Type)
	require.Equal(t, uint32(1), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, 12.0, payload["terrainInterceptionCoefficient"])
	require.Equal(t, 0.5, payload["globalRadioRangeCoef"])
	require.Equal(t, true, payload["tfarLoaded"])
	require.Equal(t, "cba", payload["source"])
}

func TestParseAcreSettingsEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(1),
		"acreSettings",
		map[string]interface{}{
			"terrainLoss":            0.4,
			"signalModel":            1.0,
			"ignoreAntennaDirection": true,
			"acreLoaded":             true,
			"source":                 "cba",
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "acreSettings", event.Type)
	require.Equal(t, uint32(1), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, 0.4, payload["terrainLoss"])
	require.Equal(t, 1.0, payload["signalModel"])
	require.Equal(t, true, payload["ignoreAntennaDirection"])
	require.Equal(t, true, payload["acreLoaded"])
	require.Equal(t, "cba", payload["source"])
}

func TestParseServerFpsEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(60),
		"serverFps",
		map[string]interface{}{"fps": 47.25},
	})

	require.NotNil(t, event)
	require.Equal(t, "serverFps", event.Type)
	require.Equal(t, uint32(60), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, 47.25, payload["fps"])
}

func TestParseZeusPingEventPreservesPayload(t *testing.T) {
	event := parseEventArray([]interface{}{
		float64(120),
		"zeusPing",
		map[string]interface{}{
			"curatorId": float64(42),
			"unitId":    float64(17),
			"name":      "Danny",
			"side":      "WEST",
			"x":         float64(3411),
			"y":         float64(9002),
		},
	})

	require.NotNil(t, event)
	require.Equal(t, "zeusPing", event.Type)
	require.Equal(t, uint32(120), event.FrameNum)

	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(event.Message), &payload))
	require.Equal(t, float64(42), payload["curatorId"])
	require.Equal(t, float64(17), payload["unitId"])
	require.Equal(t, "Danny", payload["name"])
	require.Equal(t, "WEST", payload["side"])
	require.Equal(t, float64(3411), payload["x"])
	require.Equal(t, float64(9002), payload["y"])
}

// A ping is low-volume and must be readable without selecting a unit, so unlike
// the four per-player snapshot types it stays in the manifest.
func TestZeusPingIsNotAPlayerSnapshotEvent(t *testing.T) {
	require.False(t, IsPlayerSnapshotEvent("zeusPing"))
}
