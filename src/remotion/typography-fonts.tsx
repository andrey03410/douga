import React, { createContext, useContext, useEffect, useState } from "react";
import {
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useBufferState,
  useRemotionEnvironment,
} from "remotion";
import type { TypographyFontAsset } from "../video/font-manifest";

type AssetMode = "url" | "static";
type FontLoad = { ready: boolean; promise: Promise<void> };
const fontLoads = new WeakMap<FontFaceSet, Map<string, FontLoad>>();
const FontsContext = createContext<readonly TypographyFontAsset[]>([]);
export const useTypographyFonts = () => useContext(FontsContext);
const fontKey = (font: TypographyFontAsset) =>
  `${font.family}:${font.hash}:${font.weight}:${font.style}`;

export function typographyFontSource(src: string, mode: AssetMode): string {
  return mode === "static" &&
    !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/api\/)/iu.test(src)
    ? staticFile(src.replace(/^\/+/, ""))
    : src;
}

/** Shared by Studio, watch, offline HTML and the renderer. No system-font fallback. */
export async function loadTypographyFonts(
  fonts: readonly TypographyFontAsset[],
  mode: AssetMode = "url",
  timeoutMs = 15_000,
): Promise<void> {
  if (!fonts.length) return;
  if (
    typeof document === "undefined" ||
    !document.fonts ||
    typeof FontFace === "undefined"
  )
    throw new Error("Typography requires the browser FontFace API");
  const set = document.fonts;
  let loads = fontLoads.get(set);
  if (!loads) {
    loads = new Map();
    fontLoads.set(set, loads);
  }
  await Promise.all(
    fonts.map((font) => {
      const key = fontKey(font);
      const cached = loads!.get(key);
      if (cached) return cached.promise;
      const source = typographyFontSource(font.src, mode);
      const face = new FontFace(font.family, `url(${JSON.stringify(source)})`, {
        weight: String(font.weight),
        style: font.style,
        display: "block",
      });
      let timeout: ReturnType<typeof setTimeout>;
      const entry: FontLoad = { ready: false, promise: Promise.resolve() };
      entry.promise = Promise.race([
        face.load(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("font request timed out")),
            timeoutMs,
          );
        }),
      ])
        .then((loaded) => {
          set.add(loaded);
          entry.ready = true;
        })
        .catch((error: unknown) => {
          loads!.delete(key);
          throw new Error(
            `Typography font ${font.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => clearTimeout(timeout));
      loads!.set(key, entry);
      return entry.promise;
    }),
  );
}

function fontsReady(fonts: readonly TypographyFontAsset[]) {
  if (!fonts.length) return true;
  if (typeof document === "undefined" || !document.fonts) return false;
  const cache = fontLoads.get(document.fonts);
  return fonts.every((font) => cache?.get(fontKey(font))?.ready);
}

/** A separate keyed component cleans up old render/playback handles on plan changes. */
const FontResources: React.FC<{
  fonts: readonly TypographyFontAsset[];
  mode: AssetMode;
  children: React.ReactNode;
}> = ({ fonts, mode, children }) => {
  const environment = useRemotionEnvironment();
  const buffer = useBufferState();
  const [ready, setReady] = useState(() => fontsReady(fonts));
  const [error, setError] = useState<Error>();
  const [handle] = useState(() =>
    ready
      ? null
      : delayRender("Loading pinned typography fonts", {
          timeoutInMilliseconds: 20_000,
          retries: 0,
        }),
  );
  useEffect(() => {
    if (ready) return;
    let active = true;
    const unblock = environment.isPlayer
      ? buffer.delayPlayback().unblock
      : () => {};
    loadTypographyFonts(fonts, mode)
      .then(() => {
        if (active) setReady(true);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      active = false;
      unblock();
      if (handle !== null) continueRender(handle);
    };
  }, [fonts, mode, buffer, environment.isPlayer, handle, ready]);
  // Release after the ready DOM has committed, never while a fallback frame is painted.
  useEffect(() => {
    if ((ready || error) && handle !== null) continueRender(handle);
  }, [ready, error, handle]);
  if (error) {
    if (environment.isRendering) cancelRender(error);
    throw error;
  }
  return ready ? (
    <>{children}</>
  ) : (
    <div
      data-typography-font-loading="true"
      role="status"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        background: "#080c14",
      }}
    >
      Загрузка шрифтов…
    </div>
  );
};

export const TypographyFontGate: React.FC<{
  fonts?: readonly TypographyFontAsset[];
  assetMode?: AssetMode;
  children: React.ReactNode;
}> = ({ fonts = [], assetMode = "url", children }) => (
  <FontsContext.Provider value={fonts}>
    {fonts.length ? (
      <FontResources
        key={fonts.map(fontKey).sort().join("|")}
        fonts={fonts}
        mode={assetMode}
      >
        {children}
      </FontResources>
    ) : (
      children
    )}
  </FontsContext.Provider>
);
