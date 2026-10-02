/** Mission start camera on M3 at 1280x720 with the Options camera angle at 45° and 0° (tests/tour-camera-lib.mjs). */
import { tourCameraRuns } from './tour-camera-lib.mjs';

export default (page, t) => tourCameraRuns(page, t, [45, 0].map((yaw) => ({ id: 'm03', how: 'skip-part1', yaw, vw: [1280, 720] })));
