/**
 * The Player mounts a scene or a sound cue two seconds early, paused and hidden, so
 * its media has loaded when it starts. Otherwise a cue's <audio> starts loading on its
 * first frame and Remotion keeps seeking it to catch up. Renders skip premounting.
 *
 * No imports: the watch model reads this on the server, where Remotion cannot load.
 */
export const PLAYER_PREMOUNT_SEC = 2;

export function playerPremountFrames(fps: number) {
  return Math.round(PLAYER_PREMOUNT_SEC * fps);
}
