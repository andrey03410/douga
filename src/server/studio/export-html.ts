import "server-only";
import path from "node:path";
import { open, readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { absPath } from "@/lib/storage";
import type { CompiledVideo } from "@/video";
import {
  base64Length,
  htmlContentDisposition,
  htmlExportLimit,
} from "@/watch/model";
import { StudioError } from "./errors";
import { materializeSlices, type ExportAsset } from "./export-slice";
import { getStudioProject } from "./projects";
import type { StudioFile, StudioValidation } from "./types";

const BOOT = `(function(){
var plan=JSON.parse(document.getElementById("douga-plan").textContent);
var nodes=document.querySelectorAll("script[type='text/plain']");
var urls={};
for(var i=0;i<nodes.length;i++){
  var node=nodes[i];
  var binary=atob(node.textContent.replace(/\\s+/g,""));
  var bytes=new Uint8Array(binary.length);
  for(var j=0;j<binary.length;j++) bytes[j]=binary.charCodeAt(j);
  urls[node.id]=URL.createObjectURL(new Blob([bytes],{type:node.getAttribute("data-mime")||"application/octet-stream"}));
}
var walk=function(value){
  if(!value||typeof value!=="object") return;
  if(typeof value.src==="string"&&value.src.indexOf("slice:")===0&&urls[value.src.slice(6)]) value.src=urls[value.src.slice(6)];
  if(typeof value.posterSrc==="string"&&value.posterSrc.indexOf("slice:")===0&&urls[value.posterSrc.slice(6)]) value.posterSrc=urls[value.posterSrc.slice(6)];
  var keys=Object.keys(value);
  for(var k=0;k<keys.length;k++) walk(value[keys[k]]);
};
walk(plan);
window.__DOUGA__={title:__TITLE__,plan:plan};
})();`;

let bundleCache: string | undefined;
let fontCssCache: string | undefined;

async function playerBundle() {
  if (bundleCache) return bundleCache;
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.resolve("src/watch/standalone.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    jsx: "automatic",
    minify: true,
    absWorkingDir: process.cwd(),
    alias: { "@": path.resolve("src") },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  bundleCache = result.outputFiles?.[0]?.text;
  if (!bundleCache) throw new StudioError("EXPORT_BUNDLE_FAILED");
  return bundleCache;
}

async function fontCss() {
  if (fontCssCache) return fontCssCache;
  const dir = path.resolve("src/watch/fonts");
  const regular = (await readFile(path.join(dir, "arimo-latin-400.woff2"))).toString(
    "base64",
  );
  const bold = (await readFile(path.join(dir, "arimo-latin-700.woff2"))).toString(
    "base64",
  );
  fontCssCache = `@font-face{font-family:"Douga Fallback";src:url(data:font/woff2;base64,${regular}) format("woff2");font-weight:400;font-style:normal;font-display:swap}@font-face{font-family:"Douga Fallback";src:url(data:font/woff2;base64,${bold}) format("woff2");font-weight:700;font-style:normal;font-display:swap}.watch-root,.watch-root *{font-family:Arial,"Douga Fallback","Helvetica Neue",sans-serif !important}body{margin:0;background:#05070c;color:#e7ebf5}`;
  return fontCssCache;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );
}

function jsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function* base64Chunks(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(3 * 8192);
    let pending = Buffer.alloc(0);
    while (true) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      const merged = pending.length
        ? Buffer.concat([pending, buf.subarray(0, bytesRead)])
        : buf.subarray(0, bytesRead);
      const usable = merged.length - (merged.length % 3);
      if (usable > 0) yield merged.subarray(0, usable).toString("base64");
      pending = Buffer.from(merged.subarray(usable));
    }
    if (pending.length) yield pending.toString("base64");
  } finally {
    await handle.close();
  }
}

async function prepare(userId: string, projectId: string) {
  const project = await getStudioProject(userId, projectId);
  const revision = await prisma.studioRevision.findUnique({
    where: { projectId_revision: { projectId, revision: project.revision } },
  });
  if (!revision?.planJson || !revision.assetsJson || !revision.validationJson)
    throw new StudioError("VALIDATION_FAILED");
  const validation = JSON.parse(revision.validationJson) as StudioValidation;
  if (!validation.ready)
    throw new StudioError("VALIDATION_FAILED", validation.diagnostics);
  const stored = JSON.parse(revision.assetsJson) as {
    files?: Record<string, StudioFile>;
  };
  const sliced = await materializeSlices({
    userId,
    projectId,
    revisionId: revision.id,
    plan: JSON.parse(revision.planJson) as CompiledVideo,
    files: stored.files ?? {},
  });
  const [bundle, css] = await Promise.all([playerBundle(), fontCss()]);
  const title = project.document.title;
  const prefix = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><div class="watch-root"><div id="root"></div></div><script type="application/json" id="douga-plan">${jsonForScript(sliced.plan)}</script>`;
  const suffix = `<script>${BOOT.replace("__TITLE__", jsonForScript(title))}</script><script>${bundle}</script></body></html>`;
  const assets = sliced.assets.map((asset: ExportAsset) => ({
    ...asset,
    open: `<script type="text/plain" id="${asset.id}" data-mime="${asset.mime}">`,
    close: "</script>",
  }));
  const bytes =
    Buffer.byteLength(prefix) +
    Buffer.byteLength(suffix) +
    assets.reduce(
      (sum, asset) =>
        sum +
        Buffer.byteLength(asset.open) +
        base64Length(asset.bytes) +
        Buffer.byteLength(asset.close),
      0,
    );
  const largest = assets.reduce(
    (max, asset) => Math.max(max, base64Length(asset.bytes)),
    0,
  );
  if (htmlExportLimit(bytes, largest) === "refuse")
    throw new StudioError("EXPORT_TOO_LARGE");
  return {
    bytes,
    warning: htmlExportLimit(bytes, largest) === "warn",
    prefix,
    suffix,
    assets,
    disposition: htmlContentDisposition(projectId, title),
  };
}

export async function estimateStudioExport(userId: string, projectId: string) {
  const prepared = await prepare(userId, projectId);
  return { bytes: prepared.bytes, warning: prepared.warning };
}

export async function streamStudioExport(userId: string, projectId: string) {
  const prepared = await prepare(userId, projectId);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(Buffer.from(text));
      try {
        send(prepared.prefix);
        for (const asset of prepared.assets) {
          send(asset.open);
          for await (const chunk of base64Chunks(absPath(asset.relativePath)))
            controller.enqueue(Buffer.from(chunk));
          send(asset.close);
        }
        send(prepared.suffix);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(prepared.bytes),
      "Content-Disposition": prepared.disposition,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
