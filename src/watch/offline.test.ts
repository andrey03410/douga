import { describe, expect, it } from "vitest";
import type { CompiledScene } from "@/video";
import { cue, hash, hashB, imageNode, plan, videoNode } from "./fixtures";
import {
  HTML_MAX_ASSET_BASE64,
  HTML_MAX_BYTES,
  HTML_WARN_BYTES,
  applySlices,
  base64Length,
  htmlContentDisposition,
  htmlExportLimit,
  mediaSlices,
  offlineMediaUnresolved,
  posterHashes,
  posterSliceId,
} from "./offline";

function scene(nodes: CompiledScene["nodes"]): CompiledScene {
  return {
    id: "s",
    kind: "custom",
    from: 0,
    durationInFrames: 30,
    background: "#000",
    nodes,
    phases: {},
    transition: { type: "none", durationInFrames: 0 },
  };
}

describe("slice windows", () => {
  it("pads a partial window by half a second and shifts the offset", () => {
    const video = plan({
      audio: [cue({ id: "part", offsetFrames: 100, durationInFrames: 30 })],
    });
    const slices = mediaSlices(video);
    expect(slices).toEqual([
      expect.objectContaining({
        hash,
        role: "audio",
        startFrame: 85,
        endFrame: 145,
        whole: false,
      }),
    ]);
    const sliced = applySlices(video);
    expect(sliced.audio[0].offsetFrames).toBe(15);
    expect(sliced.audio[0].asset.src).toBe(`slice:${slices[0].id}`);
    expect(sliced.audio[0].asset.durationSec).toBeCloseTo(60 / 30, 5);
  });

  it("copies a file that is already used edge to edge", () => {
    const video = plan({
      audio: [cue({ id: "all", offsetFrames: 0, durationInFrames: 290 })],
    });
    expect(mediaSlices(video)[0]).toMatchObject({ id: `whole:${hash}`, whole: true });
    expect(applySlices(video).audio[0].offsetFrames).toBe(0);
    expect(applySlices(video).audio[0].asset.src).toBe(`slice:whole:${hash}`);
  });

  it("keeps distant windows apart and extends a video slice to the freeze frame", () => {
    const node = videoNode();
    node.media!.freezeAtFrame = 200;
    node.media!.offsetFrames = 90;
    node.durationInFrames = 30;
    const video = plan({
      fps: 30,
      audio: [
        cue({ id: "early", hash, offsetFrames: 0, durationInFrames: 20 }),
        cue({ id: "late", hash, offsetFrames: 240, durationInFrames: 20 }),
      ],
      scenes: [scene([node])],
    });
    const slices = mediaSlices(video);
    const audioSlices = slices.filter((s) => s.hash === hash);
    expect(audioSlices).toHaveLength(2);
    const picture = slices.find((s) => s.hash === hashB);
    expect(picture?.role).toBe("visual");
    expect(picture?.endFrame).toBe(200 + 1 + 15);
    const sliced = applySlices(video);
    expect(sliced.scenes[0].nodes[0].media?.offsetFrames).toBe(15);
    expect(sliced.scenes[0].nodes[0].media?.freezeAtFrame).toBe(
      200 - (picture!.startFrame),
    );
  });

  it("stops a window at the end of a source shorter than its node", () => {
    // 6 s clip from 2 s on a 5 s node without a loop: the last second runs past the file.
    const node = videoNode();
    node.media!.asset.durationSec = 6;
    node.media!.offsetFrames = 60;
    node.durationInFrames = 150;
    const video = plan({ fps: 30, scenes: [scene([node])] });
    expect(mediaSlices(video)).toEqual([
      expect.objectContaining({ role: "visual", startFrame: 45, endFrame: 180, whole: false }),
    ]);
    const sliced = applySlices(video);
    expect(sliced.scenes[0].nodes[0].media?.offsetFrames).toBe(15);
  });

  it("merges windows that sit less than a second apart", () => {
    const video = plan({
      audio: [
        cue({ id: "a", offsetFrames: 0, durationInFrames: 30 }),
        cue({ id: "b", offsetFrames: 40, durationInFrames: 30 }),
      ],
    });
    expect(mediaSlices(video)).toHaveLength(1);
    expect(mediaSlices(video)[0].endFrame).toBe(70 + 15);
  });
});

describe("slice roles", () => {
  it("cuts the sound of a video file as audio, separately from its muted picture", () => {
    const node = videoNode({ hash: hashB });
    node.media!.offsetFrames = 90;
    node.durationInFrames = 30;
    const sound = cue({ id: "card-sound", hash: hashB, offsetFrames: 90, durationInFrames: 30 });
    sound.asset = { ...sound.asset, kind: "video", hasAudio: true };
    const video = plan({ audio: [sound], scenes: [scene([node])] });
    const slices = mediaSlices(video);
    expect(slices.map((s) => [s.role, s.startFrame, s.endFrame]).sort()).toEqual([
      ["audio", 75, 135],
      ["visual", 75, 135],
    ]);
    const sliced = applySlices(video);
    const audio = slices.find((s) => s.role === "audio")!;
    const picture = slices.find((s) => s.role === "visual")!;
    expect(sliced.audio[0].asset.src).toBe(`slice:${audio.id}`);
    expect(sliced.scenes[0].nodes[0].media?.asset.src).toBe(`slice:${picture.id}`);
    expect(audio.id).not.toBe(picture.id);
  });

  it("embeds the poster of a video picture, not of a sound cut from the same kind of file", () => {
    const sound = cue({ id: "card-sound", hash: hashB, offsetFrames: 90, durationInFrames: 30 });
    sound.asset = { ...sound.asset, kind: "video", hasAudio: true, posterSrc: "/api/studio/media?path=p.jpg" };
    const onlySound = plan({ audio: [sound] });
    expect(posterHashes(onlySound)).toEqual([]);
    const sliced = applySlices(onlySound);
    expect(sliced.audio[0].asset.posterSrc).toBeUndefined();
    expect(offlineMediaUnresolved(sliced, new Set(mediaSlices(onlySound).map((s) => s.id)))).toBe(false);
    const withPicture = plan({ audio: [sound], scenes: [scene([videoNode({ hash: hashB })])] });
    expect(posterHashes(withPicture)).toEqual([hashB]);
  });

  it("keeps stills whole and shares one whole file between roles", () => {
    const still = imageNode("/api/studio/media?path=x.png");
    const node = videoNode({ hash: hashB });
    node.media!.offsetFrames = 0;
    node.durationInFrames = 290;
    const sound = cue({ id: "full", hash: hashB, offsetFrames: 0, durationInFrames: 290 });
    const video = plan({ audio: [sound], scenes: [scene([still, node])] });
    const slices = mediaSlices(video);
    expect(slices.map((s) => s.id).sort()).toEqual([
      `whole:${hashB}`,
      `whole:${"c".repeat(64)}`,
    ]);
    expect(slices.find((s) => s.hash === "c".repeat(64))?.role).toBe("still");
    // The picture keeps its poster even though the whole file also carries the sound.
    expect(applySlices(video).scenes[0].nodes[1].media?.asset.posterSrc).toBe(
      `slice:${posterSliceId(hashB)}`,
    );
  });
});

describe("offline media check", () => {
  it("flags only media sources, not text that mentions a link", () => {
    const text = { ...videoNode(), type: "text", text: "Подписка: https://t.me/douga", media: undefined };
    const source = plan({
      audio: [cue({ offsetFrames: 0, durationInFrames: 290 })],
      scenes: [scene([text as never])],
    });
    const embedded = new Set(mediaSlices(source).map((slice) => slice.id));
    const ok = applySlices(source);
    expect(offlineMediaUnresolved(ok, embedded)).toBe(false);
    const leaked = structuredClone(ok);
    leaked.audio[0].asset.src = "/api/watch/t/media/x.wav";
    expect(offlineMediaUnresolved(leaked, embedded)).toBe(true);
  });

  it("needs the poster of a video and every slice embedded", () => {
    const node = videoNode();
    const source = plan({ scenes: [scene([node])] });
    expect(posterHashes(source)).toEqual([hashB]);
    const sliced = applySlices(source);
    expect(sliced.scenes[0].nodes[0].media?.asset.posterSrc).toBe(
      `slice:${posterSliceId(hashB)}`,
    );
    const slices = new Set(mediaSlices(source).map((slice) => slice.id));
    expect(offlineMediaUnresolved(sliced, slices)).toBe(true);
    expect(
      offlineMediaUnresolved(sliced, new Set([...slices, posterSliceId(hashB)])),
    ).toBe(false);
    expect(offlineMediaUnresolved(sliced, new Set([posterSliceId(hashB)]))).toBe(true);
  });
});

describe("html size and disposition", () => {
  it("counts base64 length", () => {
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
  });

  it("warns at 80 MiB and refuses at 400 MiB or a huge asset string", () => {
    expect(htmlExportLimit(HTML_WARN_BYTES - 1, 10)).toBe("ok");
    expect(htmlExportLimit(HTML_WARN_BYTES, 10)).toBe("warn");
    expect(htmlExportLimit(HTML_MAX_BYTES - 1, 10)).toBe("warn");
    expect(htmlExportLimit(HTML_MAX_BYTES, 10)).toBe("refuse");
    expect(htmlExportLimit(100, HTML_MAX_ASSET_BASE64)).toBe("refuse");
  });

  it("names the download like a render, with an html extension", () => {
    expect(htmlContentDisposition("cm123", "Топ: аниме (2024)")).toBe(
      "attachment; filename=\"douga-cm123.html\"; " +
        "filename*=UTF-8''%D0%A2%D0%BE%D0%BF%20%D0%B0%D0%BD%D0%B8%D0%BC%D0%B5%20%282024%29.html",
    );
    expect(htmlContentDisposition("cm123", null)).toBe(
      'attachment; filename="douga-cm123.html"',
    );
    const header = htmlContentDisposition("cm123", "Выбери вайфу 💖");
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  });
});
