import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

export interface StoryboardSheetProps {
  width: number; height: number; columns: number; tileWidth: number; tileHeight: number;
  title: string; subtitle: string;
  tiles: { src?: string; label: string; metadata: string; state: string; missing?: boolean }[];
}
export const DEFAULT_STORYBOARD_SHEET: StoryboardSheetProps = {
  width: 1600, height: 400, columns: 3, tileWidth: 512, tileHeight: 288,
  title: "Раскадровка", subtitle: "", tiles: [],
};
export const StoryboardSheet: React.FC<StoryboardSheetProps> = props => (
  <AbsoluteFill style={{ background: "#0b1020", color: "#e8edf8", fontFamily: "Arial, sans-serif", padding: 20 }}>
    <div style={{ height: 78 }}>
      <div style={{ fontSize: 27, fontWeight: 700 }}>{props.title}</div>
      <div style={{ fontSize: 18, color: "#afbdd7", marginTop: 8 }}>{props.subtitle}</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${props.columns}, ${props.tileWidth}px)`, gap: 14 }}>
      {props.tiles.map((tile, index) => <div key={index} style={{ background: "#182139", border: "1px solid #34435f", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ height: props.tileHeight, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {tile.src && !tile.missing
            ? <Img src={staticFile(tile.src)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : <span style={{ fontSize: 23, color: "#b9c3d7" }}>Сцены нет в этой версии</span>}
        </div>
        <div style={{ height: 80, padding: "10px 12px", overflow: "hidden" }}>
          <div style={{ fontSize: 20, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tile.label}</div>
          <div style={{ fontSize: 16, color: "#bac8e2", marginTop: 6 }}>{tile.metadata} · {tile.state}</div>
        </div>
      </div>)}
    </div>
  </AbsoluteFill>
);
