# Demo scenarios

Open Demo controls (Race lab in Hacker UI) at any time. Select a scenario and use 20× to reach simulation-time actions quickly. Changing scenario/seed/profile or Reset builds a fresh coherent checkpoint; favourites retain entry identity. Default seed is **10002026**. Scenarios, drivers, messages and timings are synthetic.

| Scenario                  | Reproduction and expected result                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Normal racing             | Default lap-42 checkpoint +12s. 24 entries circulate. The first pair alternates scripted 0.92/1.08 pace factors every 80 simulated seconds and trades classification places; changes are labelled derived.                                                                                                                                                                     |
| Pit cycle                 | Requests for entries 0, 2 and 6 arm after 3 simulated seconds; each waits until the next mapped pit-entry junction. Traverse to service for 12s, stop 25s, traverse out for 12s. Car 07 swaps to Blake Mercer at service, retaining ID and favourites. Car 12 receives a synthetic 5s penalty after 70s (displayed observation, not a full sporting-rules scoring adjustment). |
| Safety car and restart    | After 5s, leader slows and following cars close gradually under the simplified distance-based model until green at 65s. Timing-only maps withhold locations under caution rather than reveal the simulator queue.                                                                                                                                                              |
| Red flag                  | Red/suspended from 5s to 30s. All positions freeze and no new laps are added. Green resumes afterwards. Lap durations include source-clock suspension time; they are not official race timing.                                                                                                                                                                                 |
| Lap deficit               | Default warm-up has cars at least one whole scoring lap behind. Their physical place differs from classification, and full-lap gaps use LAP tags.                                                                                                                                                                                                                              |
| Retirement                | Car 32 retires at 12s and freezes at its supplied simulated location. Timing-only modes put it in the location-unavailable area.                                                                                                                                                                                                                                               |
| Missing capabilities      | Use profile selector to test position, sector, lap and classification. Timing projections remove simulator progress, including pit progress. Classification retains track without invented markers.                                                                                                                                                                            |
| One car goes silent       | Car 21 stops providing entry observations from 5s; other cars and classification heartbeats continue. Its sample ages/fades and becomes unavailable despite connected transport.                                                                                                                                                                                               |
| Feed outage               | Automatically starts 3 real seconds after connect and lasts 15 real seconds at any speed. Engine continues; accepted data stays unchanged, markers become stale/unavailable. Full snapshot recovery follows.                                                                                                                                                                   |
| Duplicate / out-of-order  | Automatic injection after 3 real seconds emits a valid update, older sequence and duplicate. Rejection counter increases; duplicate events/notices do not appear.                                                                                                                                                                                                              |
| New stream / session      | After3 real seconds starts a new stream with reset sequence. Controller accepts it and retires the previous epoch. Advanced demo options also offer New session; it rebuilds the checkpoint under a new session identity. Domain tests verify both identity resets.                                                                                                            |
| Schema errors             | After3 real seconds malformed schema is rejected; error status and last valid data remain for 3 real seconds, then valid updates recover.                                                                                                                                                                                                                                      |
| Race finish               | Warm-up through leader lap 160 plus 115s. At 20×, winner reaches 161 quickly and every active car finishes at its next timing line; all stop and phase becomes finished. Lapped finishers may have fewer than 161 laps.                                                                                                                                                        |
| Browser/offline lifecycle | On production preview, allow app to become offline-ready, disable browser network, reload, and open the locally cached demo/replay. Actual offline, pause and deliberate feed fault have distinct labels. Return from a hidden tab for connected-source resync.                                                                                                                |

Outage/schema durations and auto injection use wall/monotonic browser time. Pit/race-control/retirement schedules use simulation time. Intentional pause freezes the engine but is never labelled a transport failure. Browser suspension bounds catch-up to 2 wall seconds per pulse to prevent blocking the UI, rather than claiming the simulation ran continuously in the background.

## Synthetic tuning and timing rules

Bathurst event configuration is 6.213 km and 161 laps. The exact fixture uses 24 entries and 48 fictional drivers below. Adjacent entries share colour. Base green lap pace is 126000 + 180×index milliseconds, with deterministic ±600ms variation. Sector time proportions are 0.29/0.36/0.35; geometric lengths are independent and use locally stored demo anchors.

The simulator computes classification from its own coherent scoring distance. Seconds gaps are measured at the most recent common timing-point history, not calculated from map separation. If no compatible common observation supports a gap, it is unknown. Retired entries follow active entries. Final equal-lap finishers use their exact finish timestamps. These simplified demo rules do not implement every Supercars regulation.

## Fixture roster

| Car | Team                 | Driver 1      | Driver 2     | Colour  |
| --- | -------------------- | ------------- | ------------ | ------- |
| 07  | Summit Racing        | Alex Rowan    | Blake Mercer | #E85D75 |
| 08  | Summit Racing        | Casey Vale    | Drew Hart    | #E85D75 |
| 12  | Coastline Motorsport | Ellis Reed    | Finley Shaw  | #4EA5FF |
| 13  | Coastline Motorsport | Gray Nolan    | Harper Quinn | #4EA5FF |
| 21  | Ironbark Racing      | Jamie Wells   | Kai Lawson   | #F0B44D |
| 22  | Ironbark Racing      | Logan Hayes   | Morgan Pike  | #F0B44D |
| 31  | Apex Valley          | Nico West     | Oakley Frost | #A78BFA |
| 32  | Apex Valley          | Parker Lane   | Quinn Brooks | #A78BFA |
| 41  | Southern Cross Sport | Riley Stone   | Sam Archer   | #3ECFAD |
| 42  | Southern Cross Sport | Taylor Dean   | Avery Moss   | #3ECFAD |
| 51  | Redgum Performance   | Cameron Finch | Devon Marsh  | #FF8A65 |
| 52  | Redgum Performance   | Eden Cole     | Frankie Knox | #FF8A65 |
| 61  | Harbour Works        | Hayden Bell   | Indigo Fox   | #51C4DF |
| 62  | Harbour Works        | Jesse North   | Kendall Lake | #51C4DF |
| 71  | Mountain Line        | Lee Dawson    | Marley Kent  | #D784DD |
| 72  | Mountain Line        | Noel Rivers   | Peyton Miles | #D784DD |
| 81  | Outback Engineering  | Remy Grant    | Sydney Cross | #BDC96A |
| 82  | Outback Engineering  | Toby Blair    | Arden Chase  | #BDC96A |
| 91  | Westbound Racing     | Bailey Wren   | Darcy Flynn  | #F28AB2 |
| 92  | Westbound Racing     | Emery Tate    | Hollis Price | #F28AB2 |
| 101 | Silver Fern Speed    | Jordan Ash    | Kit Monroe   | #9DB2CE |
| 102 | Silver Fern Speed    | Luca Voss     | Micah Wynn   | #9DB2CE |
| 111 | Horizon Autosport    | Phoenix Hale  | Robin Shea   | #D9AD7C |
| 112 | Horizon Autosport    | Sasha York    | Terry Ames   | #D9AD7C |

The small versioned replay stores 7 full transport checkpoints over 60 simulated seconds in sector mode. Generate position, lap or classification fixtures with the README command. Backward seeking uses a preceding full checkpoint; future entries/events are discarded rather than merged into the past.
