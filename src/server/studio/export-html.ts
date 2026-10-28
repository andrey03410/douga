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
} from "@/watch/offline";
import { StudioError } from "./errors";
import { materializeSlices, type ExportAsset } from "./export-slice";
import { getStudioProject } from "./projects";
import { hash } from "./shared";
import type { StudioFile, StudioValidation } from "./types";

/** Multiple of 4, so every chunk of the base64 text decodes on its own. */
const DECODE_CHUNK = 4 * 1024 * 1024;

const BOOT = `(function(){
var NativeURL=URL;
function SafeURL(url,base){
  try{
    if(base===undefined||base===null||base==="null") return new NativeURL(url);
    return new NativeURL(url,base);
  }catch(error){
    if(typeof url==="string"&&url.indexOf("blob:")===0) return new NativeURL(url);
    throw error;
  }
}
SafeURL.prototype=NativeURL.prototype;
SafeURL.createObjectURL=NativeURL.createObjectURL.bind(NativeURL);
SafeURL.revokeObjectURL=NativeURL.revokeObjectURL.bind(NativeURL);
window.URL=SafeURL;
})();
(function(){
var plan=JSON.parse(document.getElementById("douga-plan").textContent);
var nodes=document.querySelectorAll("script[type='text/plain'][data-mime]");
var urls={};
for(var i=0;i<nodes.length;i++){
  var node=nodes[i];
  var text=node.textContent;
  var parts=[];
  for(var at=0;at<text.length;at+=${DECODE_CHUNK}){
    var binary=atob(text.slice(at,at+${DECODE_CHUNK}));
    var bytes=new Uint8Array(binary.length);
    for(var j=0;j<binary.length;j++) bytes[j]=binary.charCodeAt(j);
    parts.push(bytes);
  }
  urls[node.id]=URL.createObjectURL(new Blob(parts,{type:node.getAttribute("data-mime")}));
  node.remove();
}
var resolve=function(src){
  return typeof src==="string"&&src.indexOf("slice:")===0&&urls[src.slice(6)]?urls[src.slice(6)]:src;
};
var walk=function(value){
  if(!value||typeof value!=="object") return;
  if("src" in value) value.src=resolve(value.src);
  if("posterSrc" in value) value.posterSrc=resolve(value.posterSrc);
  var keys=Object.keys(value);
  for(var k=0;k<keys.length;k++) walk(value[keys[k]]);
};
walk(plan);
window.__DOUGA__={title:__TITLE__,plan:plan};
})();`;

/** Arimo from @fontsource/arimo 5.3.0 (OFL 1.1, see fonts/LICENSE), metric-compatible with Arial. */
const FONT_SUBSETS = {
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  cyrillic: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116",
};

let bundleCache: { key: string; inputs: string[]; js: string } | undefined;
let bundling: Promise<string> | undefined;
let fontCssCache: string | undefined;

/** Content hash of the lockfile and every local file the bundle was built from. */
async function inputsKey(inputs: readonly string[]) {
  const digests = await Promise.all(
    ["package-lock.json", ...inputs].map(async (file) =>
      hash(await readFile(path.resolve(file))),
    ),
  );
  return hash(digests.join(":"));
}

async function buildPlayer() {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.resolve("src/watch/standalone.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    metafile: true,
    jsx: "automatic",
    minify: true,
    absWorkingDir: process.cwd(),
    alias: { "@": path.resolve("src") },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const js = result.outputFiles?.[0]?.text;
  if (!js) throw new StudioError("EXPORT_BUNDLE_FAILED");
  const inputs = Object.keys(result.metafile.inputs).filter(
    (file) => !file.includes("node_modules/"),
  );
  bundleCache = { key: await inputsKey(inputs), inputs, js };
  return js;
}

async function playerBundle() {
  // A production server runs one build of the sources, so the bundle never goes stale.
  if (
    bundleCache &&
    (process.env.NODE_ENV === "production" ||
      (await inputsKey(bundleCache.inputs)) === bundleCache.key)
  )
    return bundleCache.js;
  bundling ??= buildPlayer().finally(() => {
    bundling = undefined;
  });
  return bundling;
}

async function fontCss() {
  if (fontCssCache) return fontCssCache;
  const dir = path.resolve("src/watch/fonts");
  const faces: string[] = [];
  for (const [subset, range] of Object.entries(FONT_SUBSETS))
    for (const weight of [400, 700]) {
      const data = await readFile(path.join(dir, `arimo-${subset}-${weight}.woff2`));
      faces.push(
        `@font-face{font-family:"Douga Fallback";src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");font-weight:${weight};font-style:normal;font-display:swap;unicode-range:${range}}`,
      );
    }
  fontCssCache = `${faces.join("")}.watch-root,.watch-root *{font-family:Arial,"Douga Fallback","Helvetica Neue",sans-serif !important}body{margin:0;background:#05070c;color:#e7ebf5}.watch-boot{margin:0;min-height:100vh;display:grid;place-items:center;opacity:.7}`;
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
    const buf = Buffer.alloc(3 * 65536);
    let pending = Buffer.alloc(0);
    while (true) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      const merged = pending.length
        ? Buffer.concat([pending, buf.subarray(0, bytesRead)])
        : buf.subarray(0, bytesRead);
      const usable = merged.length - (merged.length % 3);
      if (usable > 0) yield Buffer.from(merged.subarray(0, usable).toString("base64"));
      pending = Buffer.from(merged.subarray(usable));
    }
    if (pending.length) yield Buffer.from(pending.toString("base64"));
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
    plan: JSON.parse(revision.planJson) as CompiledVideo,
    files: stored.files ?? {},
  });
  try {
    return await assemble(projectId, project.document.title, sliced);
  } catch (error) {
    sliced.release();
    throw error;
  }
}

async function assemble(
  projectId: string,
  title: string,
  sliced: Awaited<ReturnType<typeof materializeSlices>>,
) {
  const [bundle, css] = await Promise.all([playerBundle(), fontCss()]);
  const prefix = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><div class="watch-root"><div id="root"><p class="watch-boot" role="status">Загрузка…</p></div></div><script type="application/json" id="douga-plan">${jsonForScript(sliced.plan)}</script>`;
  // A function replacer: a title with "$&" or "$1" must stay as typed.
  const boot = BOOT.replace("__TITLE__", () => jsonForScript(title));
  const suffix = `<script>${boot}</script><script>${bundle}</script></body></html>`;
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
  const limit = htmlExportLimit(bytes, largest);
  if (limit === "refuse") throw new StudioError("EXPORT_TOO_LARGE");
  return {
    bytes,
    warning: limit === "warn",
    prefix,
    suffix,
    assets,
    disposition: htmlContentDisposition(projectId, title),
    release: sliced.release,
  };
}

async function* htmlParts(prepared: Awaited<ReturnType<typeof prepare>>) {
  yield Buffer.from(prepared.prefix);
  for (const asset of prepared.assets) {
    yield Buffer.from(asset.open);
    yield* base64Chunks(absPath(asset.relativePath));
    yield Buffer.from(asset.close);
  }
  yield Buffer.from(prepared.suffix);
}

export async function estimateStudioExport(userId: string, projectId: string) {
  const prepared = await prepare(userId, projectId);
  prepared.release();
  return { bytes: prepared.bytes, warning: prepared.warning };
}

/** `head`: the headers of the download without its body. */
export async function streamStudioExport(
  userId: string,
  projectId: string,
  options: { head?: boolean } = {},
) {
  const prepared = await prepare(userId, projectId);
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(prepared.bytes),
    "Content-Disposition": prepared.disposition,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (options.head) {
    prepared.release();
    return new Response(null, { headers });
  }
  const parts = htmlParts(prepared);
  // pull: the next chunk is read from disk only when the client has taken the last one.
  // The cuts stay held until the last chunk, an error or a cancelled download.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await parts.next();
        if (next.done) {
          prepared.release();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        prepared.release();
        controller.error(error);
      }
    },
    async cancel() {
      prepared.release();
      await parts.return(undefined);
    },
  });
  return new Response(body, { headers });
}
