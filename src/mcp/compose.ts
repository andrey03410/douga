import { importPoster } from "@/server/shikimori";
import { addTile, addTileToGroup, patchTile } from "@/server/projects";
import { deleteArt } from "@/server/arts";
import type { ShikimoriType } from "@/lib/domain/shikimori";

export interface AddTileFromShikimoriInput {
  /** Target: a plain round, or a block of a group round (exactly one). */
  roundId?: string;
  groupId?: string;
  type: ShikimoriType;
  id: number;
  posterPath: string;
  label?: string | null;
  isAnswer?: boolean;
  maxPoolBytes: number | null;
}

/**
 * Import a Shikimori poster into the pool and place it as a tile in one call.
 * All or nothing: when the tile cannot be placed (round full, wrong round or
 * block, ...), the poster imported by this call is deleted again and the
 * original error is re-thrown.
 */
export async function addTileFromShikimori(
  userId: string,
  input: AddTileFromShikimoriInput,
): Promise<{ tileId: string; artId: string }> {
  // importPoster always creates a new Art (there is no dedup against the pool),
  // so the art is ours to roll back. If a dedup ever lands there, only roll
  // back arts that this call created.
  const { artId } = await importPoster(userId, {
    type: input.type,
    id: input.id,
    posterPath: input.posterPath,
    label: input.label ?? null,
    maxPoolBytes: input.maxPoolBytes,
  });
  try {
    const tile = input.groupId
      ? await addTileToGroup(userId, input.groupId, artId)
      : await addTile(userId, input.roundId!, artId);
    if (input.label != null || input.isAnswer) {
      await patchTile(userId, tile.id, {
        ...(input.label != null ? { label: input.label } : {}),
        ...(input.isAnswer ? { isAnswer: true } : {}),
      });
    }
    return { tileId: tile.id, artId };
  } catch (e) {
    // Row and file go; a tile placed before a failed patch cascades with the
    // art. A failed cleanup must not mask the reason the tile was refused.
    await deleteArt(userId, artId).catch(() => {});
    throw e;
  }
}
