"use client";

import React, { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import type { ArtCrop } from "@/lib/domain/art-crop";
import { ImportSources } from "@/app/components/ImportSources";
import { MediaBrowser } from "@/app/components/MediaBrowser";
import { useMediaPool, type PoolArt, type PoolKind } from "@/app/components/useMediaPool";

/** The pool types under their historical names (imported by the constructors). */
export type GalleryKind = PoolKind;
export type GalleryArt = PoolArt;

export interface PickResult {
  artId: string;
  crop: ArtCrop | null;
}

/** 16:9 crop editor over one media (image or video). Reports a normalized rect (0..1). */
function CropStep({
  artUrl,
  mediaKind,
  initialCrop,
  onApply,
  onBack,
  aspect = 16 / 9,
}: {
  artUrl: string;
  mediaKind: GalleryKind;
  initialCrop: ArtCrop | null;
  onApply: (crop: ArtCrop | null) => void;
  onBack: (() => void) | null;
  aspect?: number;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const areaRef = useRef<Area | null>(null);

  return (
    <>
      <div className="cropper-box">
        <Cropper
          {...(mediaKind === "video" ? { video: artUrl } : { image: artUrl })}
          crop={crop}
          zoom={zoom}
          maxZoom={8}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(areaPercent) => {
            areaRef.current = areaPercent;
          }}
          initialCroppedAreaPercentages={
            initialCrop
              ? {
                  x: initialCrop.x * 100,
                  y: initialCrop.y * 100,
                  width: initialCrop.w * 100,
                  height: initialCrop.h * 100,
                }
              : undefined
          }
        />
      </div>
      <div className="row" style={{ marginTop: 12, gap: 10, alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 13 }}>Зум</span>
        <input
          type="range"
          min={1}
          max={8}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{ flex: 1, padding: 0 }}
        />
      </div>
      <div className="row" style={{ marginTop: 14, gap: 10 }}>
        <button
          className="btn"
          onClick={() => {
            const a = areaRef.current;
            if (!a) return onApply(null);
            const clamp = (v: number) => Math.min(1, Math.max(0, v / 100));
            onApply({ x: clamp(a.x), y: clamp(a.y), w: clamp(a.width), h: clamp(a.height) });
          }}
        >
          Применить
        </button>
        <button className="btn secondary" onClick={() => onApply(null)}>
          Без обрезки
        </button>
        {onBack ? (
          <button className="btn ghost" onClick={onBack}>
            ← Назад
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * Art gallery modal. mode="manage": import (see ImportSources) + the pool
 * browser with rename, selection and delete. mode="pick": search + recent +
 * infinite grid, click -> crop step -> onPick. mode="crop": crop step only.
 */
export function ArtGalleryModal({
  mode,
  cropTarget,
  onPick,
  onClose,
  onPoolChange,
  pickKinds = ["image", "video"],
  aspect = 16 / 9,
}: {
  mode: "manage" | "pick" | "crop";
  /** For mode="crop": the media being re-cropped and its current crop. */
  cropTarget?: { artUrl: string; kind: GalleryKind; crop: ArtCrop | null };
  onPick?: (res: PickResult) => void;
  onClose: () => void;
  /** Called after imports/deletes so the parent can refresh its own art usages. */
  onPoolChange?: () => void;
  /** Which pool kinds are selectable in mode="pick" (others are hidden). */
  pickKinds?: GalleryKind[];
  /** Crop aspect ratio (width / height) for the crop step. Defaults to 16:9. */
  aspect?: number;
}) {
  const pool = useMediaPool({
    enabled: mode !== "crop",
    onChange: onPoolChange,
  });
  const [cropArt, setCropArt] = useState<{
    artId: string | null;
    artUrl: string;
    kind: GalleryKind;
    crop: ArtCrop | null;
  } | null>(
    mode === "crop" && cropTarget
      ? { artId: null, artUrl: cropTarget.artUrl, kind: cropTarget.kind, crop: cropTarget.crop }
      : null,
  );

  /** Audio needs no crop step; visuals go through the cropper first. */
  function pickArt(art: PoolArt) {
    if (art.kind === "audio") onPick?.({ artId: art.id, crop: null });
    else setCropArt({ artId: art.id, artUrl: art.url, kind: art.kind, crop: null });
  }

  const title =
    cropArt != null
      ? `Обрезка (рамка ${aspect === 2 / 3 ? "2:3" : "16:9"})`
      : mode === "manage"
        ? "Менеджер медиа"
        : "Выбор медиа";

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} title="Закрыть">✕</button>
        </div>
        <div className="modal-body">
          {cropArt ? (
            <>
              <CropStep
                artUrl={cropArt.artUrl}
                mediaKind={cropArt.kind}
                initialCrop={cropArt.crop}
                onApply={(crop) => onPick?.({ artId: cropArt.artId ?? "", crop })}
                onBack={mode === "crop" ? null : () => setCropArt(null)}
                aspect={aspect}
              />
              {cropArt.kind === "video" ? (
                <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                  Рамка применяется ко всему видеоряду. Видео короче фрагмента
                  будет зациклено.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <ImportSources
                onImported={() => {
                  void pool.reload();
                  onPoolChange?.();
                }}
              />
              <MediaBrowser
                pool={pool}
                view="grid"
                manage={mode === "manage"}
                onPick={mode === "pick" ? pickArt : undefined}
                pickKinds={mode === "pick" ? pickKinds : undefined}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
