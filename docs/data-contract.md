# Normalised data contract v1

The executable contract is `src/domain/schema.ts`. All provider updates and every imported replay snapshot are validated. Stage 1 sends full authoritative replacements: null invalidates a field; it does not preserve the preceding value. Missing external fields must be normalised to an explicit null/unknown before reaching this boundary.

| Field                | Meaning                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| schemaVersion        | Literal 1; other versions rejected                                                      |
| sessionId / streamId | Stable race/session identity and current transport epoch                                |
| sequence             | Nonnegative integer increasing within a stream; resets allowed for a new stream/session |
| sourceTimestamp      | Epoch milliseconds at source; original timestamps survive replay                        |
| receiptTimestamp     | Local wall-clock milliseconds assigned at acceptance; null at provider boundary         |
| source               | demo / replay / live                                                                    |
| profile              | position / sector / lap / classification                                                |
| session.elapsed      | Elapsed race/simulation/replay clock in milliseconds; not local wall time               |
| entries[].observedAt | Source-clock time of last per-car observation                                           |
| events[].at          | Source-clock event time; stable ID and supplied/derived origin                          |

Session carries event/session IDs, name, optional meeting/series labels (live only), season, track/type, configured lap distance/km, an optional timed flag, phase, track status, leader laps, optional remaining time, IANA timezone and independent capability flags. Phase is pre-race/running/suspended/finished/unknown; track status is green/yellow/safety-car/red/chequered/unknown. `trackKm` is null when the feed's circuit length is unknown (Mount Panorama reports 6.213). Connection is separately connecting/connected/reconnecting/stopped/error, with playback pause/speed metadata.

Entry identity is independent of current driver/rank. Each entry includes string car number (including leading zero), team identity/name/hex colour, two stable driver identities, nullable current driver, classified/grid place, completed laps, entry status, timing gaps, laps/sectors/crossings, pit count/observations, histories and an optional timestamped penalty. Durations use milliseconds; progress is dimensionless in [0,1]. The main circuit and pit lane have distinct progress coordinates.

Gaps are a tagged union:

```json
{"kind":"leader"}
{"kind":"seconds","value":1234}
{"kind":"laps","value":1}
{"kind":"unknown"}
```

Only seconds gaps contain milliseconds. They display `+1.234`; laps display `+1 LAP`; unknown displays `—`. Lap values must be positive. Current sectors have null until completed; previous-lap sector durations are separate. Lap history is capped at 16, stints at 12, supplied events at 100. Stable event IDs are deduplicated by the controller.

## Position observations

- `position`: normalised main progress, nullable pitProgress, observation time, and simulated/reported provenance.
- `crossing`: confirmed anchor with kind lap/sector, sector index, lap identity, timestamp, progress boundary and nullable measured duration.
- `unavailable`: no usable position observation.

A crossing is not a duration; durations alone do not establish timestamped location. A crossing sector index names the sector entered (0 at start/finish, 1 after S1, 2 after S2). Lap timing/crossing capabilities are separate. Position samples without their capability and unsupported crossings are rejected. Map output adds provenance, source-clock age, high/low/stale/unavailable confidence and a reason.

| Profile        | Published observations                                                                            | Map treatment                                          |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| position       | Timestamped simulated/reported main and supported pit samples; valid timing fields                | Smooth samples; stale after 3s; hide after 15s         |
| sector         | Confirmed lap/sector anchors and previous measured durations; no continuous position/pit progress | Piecewise sector estimate; never synthesize a crossing |
| lap            | Start/finish anchors and lap durations; no current/previous sector fields                         | Piecewise lap estimate, lower confidence               |
| classification | Source classification/gaps, driver/pit status where available; no anchors/timing samples          | Visible circuit, no on-track car positions             |

Sparse estimates stop at the expected boundary. Grace is max(3000 ms, 15% expected duration). They become unavailable after expected duration + twice grace. Yellow/safety-car/red/unknown status, unknown pit or stopping location disable timing-only estimates conservatively. Per-entry age is independent of global connectivity.

## Live source (Natsoft)

The live provider publishes `source: 'live'`, `profile: 'position'` with `positionSamples: true` and both crossing capabilities false: position observations carry `reported` provenance at coarse segment midpoints (7 track segments or Main), and no crossing anchors, lap-crossing fields or estimates are ever published. Gaps, laps, sector durations, last/best laps and pit counts are measured feed values; session type, series and meeting are parsed labels; timed support races without a scheduled distance fall back to the leader's laps for `raceLaps`. Possible-incident alerts are derived `position` events; lead changes, pit stops, fastest laps, status changes and finish are supplied or derived as labelled.

## Valid example

`docs/example-snapshot.json` is an actual validated compact classification snapshot generated by the engine. `public/demo-replay.json` contains a complete versioned sector-crossing replay. These are fictional data, not official classifications.

## Replay envelope

```json
{
  "format": "panorama-replay",
  "version": 1,
  "name": "Example",
  "records": [{ "offset": 0, "snapshot": "A full v1 snapshot object goes here" }]
}
```

The displayed shape above is illustrative; use example-snapshot.json for the full object. Real records contain objects, never strings. Import limit is 8 MB and 180 records. The first offset must be zero; offsets strictly increase and match elapsed-source-clock differences. All records share session/profile, and race time cannot move backwards. Seeking replaces a full checkpoint and resets replay stream identity so future state cannot leak backwards. Output clock interpolates only cursor time; original measured entry fields remain unchanged until their next record.
