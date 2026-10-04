# Circuit geometry and attribution

The main circuit and pit road come from [OpenStreetMap circuit relation 6942508](https://www.openstreetmap.org/relation/6942508), retrieved on 4 October 2026 through the official OSM API. The complete local source is `src/assets/mount-panorama-osm-source.osm`.

**© OpenStreetMap contributors.** Data is available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); see [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright). The source data and derived coordinate data retain that licence. The application code is separate from the geographic data. No contributor endorsement is implied.

`python3 scripts/generate-track.py` joins the circuit member ways in racing order, projects longitude/latitude with latitude correction, rotates/scales uniformly, and inserts the mapped Finish Line node as progress 0. The Pit Straight aligns vertically on the right, Mountain Straight extends across the upper right, and Conrod returns along the lower side, matching the orientation of the [Supercars circuit-map reference](https://www.supercars.com/circuit/mount-panorama-motor-racing-circuit). Racing is anti-clockwise. The visible north arrow makes the diagram's geographic rotation explicit; this is not a north-up display.

The generator preserves the geographical shape rather than mirroring or stretching it. It builds 364 closed-circuit points and 47 pit points. Arc-length lookup resolves SVG positions independently of classification. Corner names have hand-positioned text labels; service point and sector boundaries remain configurable synthetic demo anchors, not official timing loops or measured stalls.

No map requests, external tiles or paid map service run in the delivered app. The official image was inspected as an orientation reference; no official graphic is bundled or reproduced. OSM geometry is community centerline data, not surveyed GPS or a telemetry claim.
