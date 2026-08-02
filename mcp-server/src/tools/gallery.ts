import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "../config.js";
import { isSidecarPath, readSidecar } from "../sidecar/metadata.js";
import type {
  SidecarImageInput,
  SidecarMetadata,
  SidecarSpeechInput,
  SidecarVideoInput,
} from "../sidecar/types.js";
import type { Modality, ProviderId } from "../providers/types.js";
import { StructuredError } from "../util/errors.js";
import { imageThumbDataUri, videoPosterDataUri } from "../post/thumbnail.js";

type MediaKind = "image" | "video" | "audio";

const EXT_KIND: Record<string, MediaKind> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", avif: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", mkv: "video",
  mp3: "audio", wav: "audio", opus: "audio", ogg: "audio", flac: "audio", aac: "audio", m4a: "audio",
};

const KIND_MODALITY: Record<MediaKind, Modality> = {
  image: "image",
  video: "video",
  audio: "tts",
};

export interface GalleryArgs {
  /** Extra directories to scan. Defaults to the image/audio/video output dirs. */
  dirs?: string[];
  /** Restrict to one modality. Default: all. */
  modality?: Modality | "all";
  /** Restrict to a provider / model substring. */
  provider?: ProviderId;
  model?: string;
  /** Where to write the gallery HTML. Default ./gallery.html (cwd). */
  outputPath?: string;
  title?: string;
  /** Generate inline thumbnails (needs sharp; video posters need ffmpeg). Default true. */
  thumbnails?: boolean;
  /** Open the gallery in the default browser afterwards (macOS). Default false. */
  open?: boolean;
}

interface GalleryItem {
  fileUrl: string;
  name: string;
  kind: MediaKind;
  modality: Modality | "unknown";
  provider?: string;
  model?: string;
  tier?: string;
  createdAt: string;
  createdMs: number;
  cost?: number;
  currency?: string;
  cached?: boolean;
  prompt?: string;
  detail?: string;
  thumb?: string | null;
}

export interface GalleryOutput {
  success: true;
  file: string;
  count: number;
  counts: { image: number; video: number; audio: number };
  totalCost: number;
  currency: string;
  sharpMissing: boolean;
  text: string;
}

function extOf(p: string): string {
  return extname(p).slice(1).toLowerCase();
}

async function collectFiles(dirs: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue; // sidecars are dotfiles
      const kind = EXT_KIND[extOf(name)];
      if (!kind) continue;
      out.add(resolve(dir, name));
    }
  }
  return [...out];
}

function readInput(meta: SidecarMetadata): { prompt?: string; detail?: string } {
  if (meta.tool === "generate_image") {
    const i = meta.input as SidecarImageInput;
    const bits = [
      meta.params?.quality ? `quality ${meta.params.quality}` : null,
      i.resolution ? `${i.resolution}` : null,
      (i as { size?: string }).size ? `${(i as { size?: string }).size}` : null,
      i.aspectRatio ? `${i.aspectRatio}` : null,
      (i as { background?: string }).background ? `bg ${(i as { background?: string }).background}` : null,
    ].filter(Boolean);
    return { prompt: i.prompt, detail: bits.join(" · ") };
  }
  if (meta.tool === "generate_video") {
    const i = meta.input as SidecarVideoInput;
    const bits = [
      `${i.durationSeconds}s`,
      meta.params?.resolution ? `${meta.params.resolution}` : null,
      i.aspectRatio ?? null,
    ].filter(Boolean);
    return { prompt: i.prompt, detail: bits.join(" · ") };
  }
  if (meta.tool === "generate_speech") {
    const i = meta.input as SidecarSpeechInput;
    return { prompt: i.text, detail: i.voice ? `voice ${i.voice}` : undefined };
  }
  return {};
}

async function buildItem(file: string): Promise<GalleryItem> {
  const kind = EXT_KIND[extOf(file)];
  const name = basename(file);
  const fileUrl = pathToFileURL(file).href;
  let meta: SidecarMetadata | null = null;
  try {
    meta = await readSidecar(file);
  } catch {
    meta = null;
  }

  if (meta) {
    const { prompt, detail } = readInput(meta);
    return {
      fileUrl,
      name,
      kind,
      modality: meta.modality,
      provider: meta.provider,
      model: meta.model,
      tier: meta.tier,
      createdAt: meta.createdAt,
      createdMs: Date.parse(meta.createdAt) || 0,
      cost: meta.cost?.total,
      currency: meta.cost?.currency,
      cached: meta.cached,
      prompt,
      detail,
    };
  }

  // No sidecar — infer what we can from the file itself.
  let mtimeMs = 0;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    /* ignore */
  }
  return {
    fileUrl,
    name,
    kind,
    modality: KIND_MODALITY[kind],
    createdAt: new Date(mtimeMs).toISOString(),
    createdMs: mtimeMs,
  };
}

async function attachThumb(item: GalleryItem, file: string): Promise<void> {
  if (item.kind === "image") item.thumb = await imageThumbDataUri(file);
  else if (item.kind === "video") item.thumb = await videoPosterDataUri(file);
  else item.thumb = null;
}

export async function gallery(args: GalleryArgs, config: Config): Promise<GalleryOutput> {
  const dirs = (
    args.dirs && args.dirs.length > 0
      ? args.dirs
      : [config.imageOutputDir, config.audioOutputDir, config.videoOutputDir]
  ).map((d) => (isAbsolute(d) ? d : resolve(process.cwd(), d)));

  const files = (await collectFiles(dirs)).filter((f) => !isSidecarPath(f));
  const wantThumbs = args.thumbnails !== false;

  let items: GalleryItem[] = [];
  for (const f of files) {
    const item = await buildItem(f);
    items.push(item);
  }

  // Filters.
  const modFilter = args.modality && args.modality !== "all" ? args.modality : null;
  if (modFilter) items = items.filter((i) => i.modality === modFilter);
  if (args.provider) items = items.filter((i) => i.provider === args.provider);
  if (args.model) items = items.filter((i) => (i.model ?? "").includes(args.model!));

  items.sort((a, b) => b.createdMs - a.createdMs);

  // Thumbnails (after filtering, so we don't decode images we won't show).
  let sharpMissing = false;
  if (wantThumbs) {
    for (const item of items) {
      const file = decodeURIComponent(new URL(item.fileUrl).pathname);
      await attachThumb(item, file);
      if (item.kind === "image" && item.thumb === null) sharpMissing = true;
    }
  }

  const counts = {
    image: items.filter((i) => i.kind === "image").length,
    video: items.filter((i) => i.kind === "video").length,
    audio: items.filter((i) => i.kind === "audio").length,
  };
  const totalCost = items.reduce((s, i) => s + (i.cost ?? 0), 0);
  const currency = items.find((i) => i.currency)?.currency ?? "USD";

  const outputPath = args.outputPath
    ? isAbsolute(args.outputPath)
      ? args.outputPath
      : resolve(process.cwd(), args.outputPath)
    : resolve(process.cwd(), "gallery.html");

  const html = renderGalleryHtml(items, {
    title: args.title ?? "Generated media gallery",
    counts,
    totalCost,
    currency,
    dirs,
  });
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  if (args.open && process.platform === "darwin") {
    try {
      spawn("open", [outputPath], { stdio: "ignore", detached: true }).unref();
    } catch {
      /* best-effort */
    }
  }

  const lines = [
    `Gallery written: ${outputPath}`,
    `Items: ${items.length}  (image ${counts.image} · video ${counts.video} · audio ${counts.audio})`,
    `Total cost across shown items: ${currency} ${totalCost.toFixed(4)}`,
    `Open: ${pathToFileURL(outputPath).href}`,
  ];
  if (sharpMissing) {
    lines.push(
      `Note: sharp not installed — images fall back to full-res <img> (heavier). ` +
        `Run \`npm install sharp\` in mcp-server/ for lightweight thumbnails.`,
    );
  }

  return {
    success: true,
    file: outputPath,
    count: items.length,
    counts,
    totalCost,
    currency,
    sharpMissing,
    text: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// HTML rendering — self-contained, theme-aware, client-side filter/sort/search.
// ---------------------------------------------------------------------------

function renderGalleryHtml(
  items: GalleryItem[],
  meta: { title: string; counts: { image: number; video: number; audio: number }; totalCost: number; currency: string; dirs: string[] },
): string {
  // Embed items as JSON; escape "<" so a prompt containing "</script>" can't break out.
  const dataJson = JSON.stringify(items).replace(/</g, "\\u003c");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dirsList = meta.dirs.map((d) => esc(d)).join(" · ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<style>
  :root {
    --bg:#0e0e10; --panel:#161618; --border:#26262a; --fg:#ececef; --muted:#9a9aa2;
    --accent:#d97757; --chip:#1f1f22; --chip-on:#d97757; --shadow:0 1px 3px rgba(0,0,0,.4);
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f6f4; --panel:#fff; --border:#e4e4e1; --fg:#1a1a18; --muted:#6b6b66;
            --accent:#c15f3c; --chip:#eeeeeb; --chip-on:#c15f3c; --shadow:0 1px 3px rgba(0,0,0,.08); }
  }
  :root[data-theme="dark"] { --bg:#0e0e10; --panel:#161618; --border:#26262a; --fg:#ececef; --muted:#9a9aa2; --accent:#d97757; --chip:#1f1f22; --chip-on:#d97757; --shadow:0 1px 3px rgba(0,0,0,.4); }
  :root[data-theme="light"] { --bg:#f6f6f4; --panel:#fff; --border:#e4e4e1; --fg:#1a1a18; --muted:#6b6b66; --accent:#c15f3c; --chip:#eeeeeb; --chip-on:#c15f3c; --shadow:0 1px 3px rgba(0,0,0,.08); }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { position:sticky; top:0; z-index:10; background:var(--bg); border-bottom:1px solid var(--border); padding:16px 20px; }
  .titlerow { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
  h1 { font-size:18px; font-weight:650; }
  .stats { color:var(--muted); font-size:13px; }
  .stats b { color:var(--fg); }
  .controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { padding:5px 11px; border-radius:999px; background:var(--chip); color:var(--fg); border:1px solid var(--border); cursor:pointer; font-size:13px; user-select:none; }
  .chip.on { background:var(--chip-on); color:#fff; border-color:transparent; }
  input, select { background:var(--panel); color:var(--fg); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font:inherit; }
  input.search { min-width:180px; flex:1; }
  .spacer { flex:1; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:16px; padding:20px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; overflow:hidden; box-shadow:var(--shadow); display:flex; flex-direction:column; }
  .media { position:relative; aspect-ratio:1/1; background:#000; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .media img { width:100%; height:100%; object-fit:cover; display:block; cursor:zoom-in; }
  .media.audio { aspect-ratio:16/9; background:linear-gradient(135deg,#2a2a2e,#1a1a1d); }
  .bars { display:flex; align-items:center; gap:3px; height:40%; }
  .bars i { width:4px; background:var(--accent); border-radius:2px; opacity:.85; animation:none; }
  .play { position:absolute; width:46px; height:46px; border-radius:50%; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; pointer-events:none; }
  .play::after { content:""; border-left:15px solid #fff; border-top:9px solid transparent; border-bottom:9px solid transparent; margin-left:4px; }
  .kindbadge { position:absolute; top:8px; left:8px; font-size:10px; text-transform:uppercase; letter-spacing:.05em; background:rgba(0,0,0,.6); color:#fff; padding:3px 7px; border-radius:6px; }
  .costbadge { position:absolute; top:8px; right:8px; font-size:11px; background:var(--accent); color:#fff; padding:3px 8px; border-radius:6px; font-weight:600; }
  .cached { position:absolute; bottom:8px; right:8px; font-size:10px; background:rgba(0,0,0,.6); color:#8fdc9f; padding:2px 6px; border-radius:5px; }
  .body { padding:10px 12px; display:flex; flex-direction:column; gap:6px; flex:1; }
  .prompt { font-size:13px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .metaline { font-size:11px; color:var(--muted); display:flex; flex-wrap:wrap; gap:4px 8px; }
  .metaline .m { white-space:nowrap; }
  audio { width:100%; height:34px; }
  .actions { display:flex; gap:10px; align-items:center; margin-top:auto; padding-top:4px; }
  .actions a, .actions button { color:var(--accent); background:none; border:none; cursor:pointer; font:inherit; font-size:12px; padding:0; text-decoration:none; }
  .empty { padding:60px 20px; text-align:center; color:var(--muted); }
  /* lightbox */
  #lb { position:fixed; inset:0; background:rgba(0,0,0,.92); display:none; z-index:100; }
  #lb.on { display:flex; }
  #lbmedia { flex:1; display:flex; align-items:center; justify-content:center; padding:24px; min-width:0; cursor:zoom-out; }
  #lbmedia img, #lbmedia video { max-width:100%; max-height:92vh; object-fit:contain; border-radius:8px; }
  #lbmeta { width:340px; flex-shrink:0; background:var(--panel); border-left:1px solid var(--border); padding:18px 20px; overflow-y:auto; display:flex; flex-direction:column; gap:14px; }
  #lbmeta .lbclose { align-self:flex-end; background:none; border:none; color:var(--muted); font-size:24px; line-height:1; cursor:pointer; margin:-4px -4px 0 0; }
  #lbmeta .lbprompt { font-size:14px; line-height:1.5; white-space:pre-wrap; word-break:break-word; padding-top:14px; border-top:1px solid var(--border); }
  #lbmeta dl { display:grid; grid-template-columns:auto 1fr; gap:7px 14px; font-size:13px; margin:0; }
  #lbmeta dt { color:var(--muted); }
  #lbmeta dd { margin:0; word-break:break-word; }
  #lbmeta .lbactions { display:flex; gap:16px; margin-top:auto; padding-top:10px; border-top:1px solid var(--border); }
  #lbmeta .lbactions a, #lbmeta .lbactions button { color:var(--accent); background:none; border:none; cursor:pointer; font:inherit; font-size:13px; padding:0; text-decoration:none; }
  @media (max-width:720px){ #lb.on { flex-direction:column; } #lbmeta { width:auto; border-left:none; border-top:1px solid var(--border); max-height:42vh; } }
</style>
</head>
<body>
<header>
  <div class="titlerow">
    <h1>${esc(meta.title)}</h1>
    <span class="stats" id="stats"></span>
    <span class="spacer"></span>
    <span class="chip" id="themebtn" title="Toggle theme">◑ theme</span>
  </div>
  <div class="controls">
    <div class="chips" id="modchips">
      <span class="chip on" data-mod="all">All</span>
      <span class="chip" data-mod="image">🖼 Image ${meta.counts.image}</span>
      <span class="chip" data-mod="video">🎬 Video ${meta.counts.video}</span>
      <span class="chip" data-mod="tts">🔊 Audio ${meta.counts.audio}</span>
    </div>
    <input class="search" id="search" placeholder="Search prompt / model / provider…">
    <select id="sort">
      <option value="new">Newest</option>
      <option value="old">Oldest</option>
      <option value="cost-hi">Cost: high → low</option>
      <option value="cost-lo">Cost: low → high</option>
    </select>
  </div>
</header>
<div class="grid" id="grid"></div>
<div class="empty" id="empty" style="display:none">No matching items.</div>
<div id="lb"><div id="lbmedia"></div><aside id="lbmeta"></aside></div>
<script id="data" type="application/json">${dataJson}</script>
<script>
  const ITEMS = JSON.parse(document.getElementById("data").textContent);
  const grid = document.getElementById("grid"), empty = document.getElementById("empty");
  const state = { mod:"all", q:"", sort:"new" };
  const fmtCost = c => (c==null? "" : "$"+Number(c).toFixed(c<0.01?4:c<1?3:2));
  const fmtDate = ms => { try { return new Date(ms).toLocaleString(); } catch(e){ return ""; } };
  const escd = s => (s==null?"":String(s)).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  function playerFor(it){
    if(it.kind==="audio"){
      return '<div class="media audio"><span class="kindbadge">audio</span>'+
        (it.cost!=null?'<span class="costbadge">'+fmtCost(it.cost)+'</span>':'')+
        '<div class="bars">'+Array.from({length:13},(_,i)=>'<i style="height:'+(20+((i*37)%80))+'%"></i>').join('')+'</div></div>';
    }
    const badge='<span class="kindbadge">'+it.kind+'</span>'+(it.cost!=null?'<span class="costbadge">'+fmtCost(it.cost)+'</span>':'')+(it.cached?'<span class="cached">cached</span>':'');
    const thumb = it.thumb ? '<img loading="lazy" src="'+it.thumb+'" data-full="'+escd(it.fileUrl)+'" data-kind="'+it.kind+'">'
                           : '<img loading="lazy" src="'+escd(it.fileUrl)+'" data-full="'+escd(it.fileUrl)+'" data-kind="'+it.kind+'">';
    const play = it.kind==="video" ? '<span class="play"></span>' : '';
    return '<div class="media">'+thumb+play+badge+'</div>';
  }

  function card(it){
    const el = document.createElement("div"); el.className="card";
    const meta=[it.model||it.provider||"", it.tier||"", it.detail||""].filter(Boolean).map(m=>'<span class="m">'+escd(m)+'</span>').join("");
    const audioPlayer = it.kind==="audio" ? '<audio controls preload="none" src="'+escd(it.fileUrl)+'"></audio>' : "";
    el.innerHTML = playerFor(it) +
      '<div class="body">'+
        (it.prompt?'<div class="prompt" title="'+escd(it.prompt)+'">'+escd(it.prompt)+'</div>':'')+
        audioPlayer+
        '<div class="metaline">'+meta+'<span class="m">'+fmtDate(it.createdMs)+'</span></div>'+
        '<div class="actions">'+
          '<a href="'+escd(it.fileUrl)+'" target="_blank" rel="noopener">Open ↗</a>'+
          (it.prompt?'<button data-copy="'+escd(it.prompt)+'">Copy prompt</button>':'')+
        '</div>'+
      '</div>';
    return el;
  }

  function apply(){
    let list = ITEMS.slice();
    if(state.mod!=="all") list=list.filter(i=>i.modality===state.mod);
    if(state.q){ const q=state.q.toLowerCase(); list=list.filter(i=>((i.prompt||"")+" "+(i.model||"")+" "+(i.provider||"")+" "+(i.detail||"")).toLowerCase().includes(q)); }
    list.sort((a,b)=> state.sort==="old"? a.createdMs-b.createdMs
      : state.sort==="cost-hi"? (b.cost||0)-(a.cost||0)
      : state.sort==="cost-lo"? (a.cost||0)-(b.cost||0)
      : b.createdMs-a.createdMs);
    grid.innerHTML=""; list.forEach(it=>grid.appendChild(card(it)));
    empty.style.display = list.length? "none":"block";
    const cost=list.reduce((s,i)=>s+(i.cost||0),0);
    document.getElementById("stats").innerHTML = "<b>"+list.length+"</b> items · <b>$"+cost.toFixed(4)+"</b> total";
  }

  document.getElementById("modchips").addEventListener("click", e=>{
    const c=e.target.closest(".chip"); if(!c)return;
    document.querySelectorAll("#modchips .chip").forEach(x=>x.classList.remove("on"));
    c.classList.add("on"); state.mod=c.dataset.mod; apply();
  });
  document.getElementById("search").addEventListener("input", e=>{ state.q=e.target.value; apply(); });
  document.getElementById("sort").addEventListener("change", e=>{ state.sort=e.target.value; apply(); });
  grid.addEventListener("click", e=>{
    const btn=e.target.closest("button[data-copy]");
    if(btn){ navigator.clipboard && navigator.clipboard.writeText(btn.dataset.copy); btn.textContent="Copied ✓"; setTimeout(()=>btn.textContent="Copy prompt",1200); return; }
    const img=e.target.closest(".media img"); if(img){ const it=ITEMS.find(x=>x.fileUrl===img.dataset.full); if(it) openLightbox(it); }
  });
  const lb=document.getElementById("lb"), lbmedia=document.getElementById("lbmedia"), lbmeta=document.getElementById("lbmeta");
  const mrow=(label,val)=> val!=null && val!=="" ? '<dt>'+label+'</dt><dd>'+escd(val)+'</dd>' : '';
  function openLightbox(it){
    lbmedia.innerHTML = it.kind==="video" ? '<video src="'+escd(it.fileUrl)+'" controls autoplay></video>' : '<img src="'+escd(it.fileUrl)+'">';
    lbmeta.innerHTML =
      '<button class="lbclose" title="Close (Esc)">×</button>'+
      '<dl>'+
        mrow("Kind", it.kind)+ mrow("Provider", it.provider)+ mrow("Model", it.model)+
        mrow("Tier", it.tier)+ mrow("Params", it.detail)+
        mrow("Cost", it.cost!=null? fmtCost(it.cost): "")+
        mrow("Cached", it.cached? "yes": "")+ mrow("Date", fmtDate(it.createdMs))+
        mrow("File", it.name)+
      '</dl>'+
      (it.prompt? '<div class="lbprompt">'+escd(it.prompt)+'</div>':'')+
      '<div class="lbactions">'+
        '<a href="'+escd(it.fileUrl)+'" target="_blank" rel="noopener">Open file ↗</a>'+
        (it.prompt? '<button data-copy="'+escd(it.prompt)+'">Copy prompt</button>':'')+
      '</div>';
    lb.classList.add("on");
  }
  function closeLb(){ lb.classList.remove("on"); lbmedia.innerHTML=""; lbmeta.innerHTML=""; }
  lb.addEventListener("click", e=>{
    if(e.target.closest(".lbclose")){ closeLb(); return; }
    const cp=e.target.closest("#lbmeta button[data-copy]");
    if(cp){ navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy); cp.textContent="Copied ✓"; setTimeout(()=>cp.textContent="Copy prompt",1200); return; }
    if(e.target===lbmedia) closeLb(); // click the backdrop (not the media or meta panel) to close
  });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeLb(); });
  const tb=document.getElementById("themebtn");
  tb.addEventListener("click", ()=>{
    const cur=document.documentElement.getAttribute("data-theme")|| (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
    document.documentElement.setAttribute("data-theme", cur==="dark"?"light":"dark");
  });
  apply();
</script>
</body>
</html>
`;
}
