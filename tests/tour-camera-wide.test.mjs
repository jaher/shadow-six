/** Mission start camera on M3 at 2560x1080 (21:9, HUD bar 94 px), yaw 15° (tests/tour-camera-lib.mjs). */
import { tourCameraRuns } from './tour-camera-lib.mjs';

export default (page, t) => tourCameraRuns(page, t, [{ id: 'm03', how: 'skip-part1', yaw: 15, vw: [2560, 1080] }]);
