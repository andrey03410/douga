/**
 * Stills the page has already decoded. Mounting <Img pauseWhenLoading> puts the whole
 * Player into buffering for a moment even when the picture is cached, and that pause
 * also stops the music: a scene that reveals cards one by one would make the sound
 * stutter. A still that is known to be decoded mounts without the pause.
 *
 * Only the Player's page fills this. Renders never do, and they wait for every frame
 * through delayRender anyway.
 */
const decoded = new Set<string>();

export function markImageDecoded(src: string) {
  decoded.add(src);
}

export function imageDecoded(src: string) {
  return decoded.has(src);
}
