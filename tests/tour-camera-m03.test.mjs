/** Mission start camera, M3 at 1280x720, yaw 15°, three ways into the mission (tests/tour-camera-lib.mjs). */
import { tourCameraRuns } from './tour-camera-lib.mjs';

export default (page, t) => tourCameraRuns(page, t, ['skip-part1', 'skip-mid-tour', 'tour-to-end']
  .map((how) => ({ id: 'm03', how, yaw: 15, vw: [1280, 720] })));
