// What a pool media is actually used for, in words. Before phase 17 the pool
// counted only top positions, so a poster standing as a card in thirty picker
// rounds reported "0 uses" — and deleting it silently took the cards with it
// (PickerTile.artId cascades). These are the phrasings the UI shows before the
// user confirms a deletion.

export interface ArtRelationCounts {
  studioReferences?: number;
  /**
   * Top positions that show this media as their picture. The caller leaves out
   * positions that also sound with it: those are counted in `audioRenderItems`.
   */
  renderItems: number;
  /** Manual-top positions whose sound is this media (`RenderItem.audioArtId`). */
  audioRenderItems: number;
  pickerTiles: number;
  playlistItems: number;
  projectBgs: number;
  projectMusics: number;
  roundBgs: number;
  roundMusics: number;
}

export interface UsageBreakdown {
  studio?: number;
  /** Top positions that show the media as their picture — deletion frees them. */
  positions: number;
  /**
   * Manual-top positions that sound with the media. RenderItem.audioArtId
   * cascades, so deletion removes these positions entirely.
   */
  audioPositions: number;
  /** Cards inside picker rounds. */
  cards: number;
  /** Entries of a background-music playlist. */
  playlist: number;
  /** Backgrounds and background music of projects and rounds. */
  backgrounds: number;
  total: number;
}

export function usageBreakdown(counts: ArtRelationCounts): UsageBreakdown {
  const positions = counts.renderItems;
  const audioPositions = counts.audioRenderItems;
  const cards = counts.pickerTiles;
  const playlist = counts.playlistItems;
  const backgrounds =
    counts.projectBgs + counts.projectMusics + counts.roundBgs + counts.roundMusics;
  const studio = counts.studioReferences ?? 0;
  return {
    positions,
    audioPositions,
    cards,
    playlist,
    backgrounds,
    ...(studio ? { studio } : {}),
    total: positions + audioPositions + cards + playlist + backgrounds + studio,
  };
}

/** Sum the breakdowns of a selection (bulk delete warns about the whole batch). */
export function sumUsage(list: UsageBreakdown[]): UsageBreakdown {
  return list.reduce<UsageBreakdown>(
    (acc, u) => ({
      positions: acc.positions + u.positions,
      audioPositions: acc.audioPositions + u.audioPositions,
      cards: acc.cards + u.cards,
      playlist: acc.playlist + u.playlist,
      backgrounds: acc.backgrounds + u.backgrounds,
      ...((acc.studio || u.studio) ? {studio:(acc.studio??0)+(u.studio??0)} : {}),
      total: acc.total + u.total,
    }),
    { positions: 0, audioPositions: 0, cards: 0, playlist: 0, backgrounds: 0, total: 0 },
  );
}

/** Russian plural: [one, few, many] — "1 карточка", "3 карточки", "5 карточек". */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

const isOne = (n: number) => n % 10 === 1 && n % 100 !== 11;

/** Short "what uses it" line for a pool card. */
export function describeUsage(u: UsageBreakdown): string {
  if (!u.total) return "не используется";
  const parts: string[] = [];
  if(u.studio) parts.push(`${u.studio} ссылок в проектах Studio`);
  if (u.cards)
    parts.push(
      `${u.cards} ${pluralRu(u.cards, ["карточка", "карточки", "карточек"])} ${
        isOne(u.cards) ? "в раунде" : "в раундах"
      }`,
    );
  // Picture and sound uses are distinct positions (see ArtRelationCounts).
  const positions = u.positions + u.audioPositions;
  if (positions)
    parts.push(`${positions} ${pluralRu(positions, ["позиция", "позиции", "позиций"])} топа`);
  if (u.playlist)
    parts.push(
      `${u.playlist} ${pluralRu(u.playlist, ["трек", "трека", "треков"])} ${
        isOne(u.playlist) ? "в плейлисте" : "в плейлистах"
      }`,
    );
  if (u.backgrounds)
    parts.push(`${u.backgrounds} ${pluralRu(u.backgrounds, ["фон", "фона", "фонов"])}`);
  return parts.join(", ");
}

/**
 * What deletion will actually do: cards and manual-top positions that sound
 * with the media go away, other positions only lose their picture.
 */
export function describeDeletion(u: UsageBreakdown): string {
  if(u.studio) return "Удаление недоступно: медиа используется в черновиках или версиях Studio";
  if (!u.total) return "";
  const parts: string[] = [];
  if (u.cards)
    parts.push(
      `${u.cards} ${pluralRu(u.cards, ["карточка", "карточки", "карточек"])} ${
        isOne(u.cards) ? "в раунде будет удалена" : "в раундах будут удалены"
      }`,
    );
  if (u.audioPositions)
    parts.push(
      `${u.audioPositions} ${pluralRu(u.audioPositions, ["позиция", "позиции", "позиций"])} ` +
        `ручного топа ${isOne(u.audioPositions) ? "будет удалена" : "будут удалены"}`,
    );
  if (u.playlist)
    parts.push(
      `${u.playlist} ${pluralRu(u.playlist, ["трек", "трека", "треков"])} ${
        isOne(u.playlist) ? "выпадет из плейлиста" : "выпадут из плейлистов"
      }`,
    );
  if (u.positions)
    parts.push(
      `${u.positions} ${pluralRu(u.positions, ["позиция", "позиции", "позиций"])} топа ${
        isOne(u.positions) ? "освободится" : "освободятся"
      }`,
    );
  if (u.backgrounds)
    parts.push(
      `${u.backgrounds} ${pluralRu(u.backgrounds, ["фон", "фона", "фонов"])} ${
        isOne(u.backgrounds) ? "сбросится" : "сбросятся"
      }`,
    );
  return parts.join(", ");
}
