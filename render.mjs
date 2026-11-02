// The Final Whistle (V1PGL's weekly recap show) renderer: hub script → voice (Azure or ElevenLabs) → broadcast graphics → MP4.
// Env: HUB_API, VIDEO_SECRET, WEEK (required for a real run)
//      Voice, Azure (default when its key is set): AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (eastus), AZURE_VOICE (en-US-Andrew:DragonHDLatestNeural)
//      Voice, ElevenLabs: ELEVENLABS_API_KEY, ELEVEN_VOICE_ID · force one with VOICE_PROVIDER=azure|elevenlabs
//      FPS (24), JOB_FILE (local test: read the job from a file), DRY_RUN=1 (no voice: timed silence)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out");
const env = process.env;
const FPS = Number(env.FPS || 24);
const VOICE = env.ELEVEN_VOICE_ID || "nPczCjzI2devNBz1zQrb";   // "Brian": deep, smooth, warm narrator (change in repo Variables)
const MODEL = env.ELEVEN_MODEL || "eleven_multilingual_v2";
const PROVIDER = env.VOICE_PROVIDER || (env.AZURE_SPEECH_KEY ? "azure" : "elevenlabs");
const AZ_VOICE = env.AZURE_VOICE || "en-US-Davis:DragonHDLatestNeural";     // Trey Holloway, the lead anchor (TREY: lines)
const AZ_VOICE_2 = env.AZURE_VOICE_2 || "en-US-Ava:DragonHDLatestNeural";    // Nia Monroe, the analyst (NIA: lines)
const HOSTS = (env.HOST_NAMES || "Trey,Nia").split(",").map(x => x.trim().toUpperCase());
const HOST_ALIAS = { DAVIS: HOSTS[0], AVA: HOSTS[1] };   // scripts written before the rename still work
/* A segment is one turn per line: "TREY: ..." / "NIA: ...". Lines without a name go to the lead. */
const turns = text => String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
  const m = l.match(/^([A-Za-z]+)\s*:\s*(.+)$/); let who = m ? m[1].toUpperCase() : ""; who = HOST_ALIAS[who] || who;
  return HOSTS.includes(who) ? { host: who, text: m[2] } : { host: HOSTS[0], text: l }; });
const spoken = text => turns(text).map(t => t.text).join(" ");
const AZ_REGION = env.AZURE_SPEECH_REGION || "eastus";
const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
let azLast = 0;
/* Say the brand the way the league does: "V1PGL" is "V-I-P-G-L", "V1P" is "V-I-P", but the website is "V, one, P hub" (captions and graphics keep the 1). */
const BRAND = [[/v1phub/gi, "V, one, P hub"], [/V1PGL/gi, "VIPGL|"], [/V1P/gi, "VIP|"]];   // the website is spelled out with the number one so people type it right
/* Team records the way broadcasters say them: "3-0" is "3 and oh", "2-1-1" is "2, 1 and 1" (scores are written "24 to 17", so they don't match) */
const records = text => String(text).replace(/\b(\d{1,2})-(\d{1,2})(?:-(\d{1,2}))?\b(?![-\d])/g, (m, w, l, tie) => {
  if(+w > 20 || +l > 20 || (tie && +tie > 5)) return m; const say = n => n === "0" ? "oh" : n;
  return tie ? `${say(w)}, ${say(l)} and ${say(tie)}` : `${say(w)} and ${say(l)}`; });
/* pronounce.json: names said a certain way (e.g. Jefe = "HEH-feh", the Spanish word for chief) */
let SAY = [];
try{ const pj = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "pronounce.json"), "utf8"));
  SAY = Object.keys(pj).filter(k => !k.startsWith("_") && pj[k]).map(k => ({ re: new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), ipa: pj[k].ipa || "", say: pj[k].say || k })); }
catch(e){ console.log("pronounce.json not loaded: " + e.message); }
function brandSsml(text){   // escaped text with the brand spelled out as letters
  let t = xml(records(text));
  SAY.forEach(w => { t = t.replace(w.re, m => w.ipa ? `<phoneme alphabet="ipa" ph="${xml(w.ipa)}">${m}</phoneme>` : xml(w.say)); }); BRAND.forEach(([re, sub]) => { t = t.replace(re, sub); });
  return t.replace(/(VIPGL|VIP)\|/g, '<say-as interpret-as="characters">$1</say-as>');
}
function brandPlain(text){   // for voices without SSML: dotted letters
  let t = records(text);
  SAY.forEach(w => { t = t.replace(w.re, w.say); }); BRAND.forEach(([re, sub]) => { t = t.replace(re, sub); });
  return t.replace(/VIPGL\|/g, "V.I.P.G.L.").replace(/VIP\|/g, "V.I.P.").replace(/\.\.(?!\.)/g, ".");
}
const LEAD = 3.0, GAP = 0.9, TAIL = 4.5;   // the intro sting plays before the first line; the close music rides out the tail
/* Twitch clips play inside this box on game segments (the graphics draw the frame around it). They are always muted. */
const CLIP_BOX = { x: 96, y: 168, w: 1152, h: 648 }, CLIP_MAX = 14, CLIP_MIN = 4;
async function getClip(c, i){
  if(c.file) return fs.existsSync(c.file) ? c.file : null;   // local test
  const f = path.join(OUT, "clips", `clip${String(i).padStart(2, "0")}.mp4`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for(let attempt = 1; attempt <= 2; attempt++){
    try{ execFileSync("yt-dlp", ["-q", "--no-warnings", "--no-playlist", "-f", "best[ext=mp4][height<=1080]/best[ext=mp4]/best", "--remux-video", "mp4", "-o", f, c.url], { timeout: 180000, stdio: ["ignore", "ignore", "pipe"] });
      if(fs.existsSync(f) && fs.statSync(f).size > 10000) return f; }
    catch(e){ log(`  clip ${c.url} failed (try ${attempt}): ${String(e.stderr || e.message).slice(0, 160)}`); }
  }
  return null;
}   // seconds: intro sting before the first line, breath between segments, hold at the end

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function hub(body){
  const r = await fetch(env.HUB_API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
  const j = await r.json().catch(() => null);
  if(!j || !j.ok) throw new Error("Hub said: " + ((j && j.error) || r.status));
  return j;
}
const dur = f => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const ff = args => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);

async function tts(text, file, prev, next){
  if(env.DRY_RUN === "1"){   // no voice: silence as long as the line would take (~2.6 words a second)
    const secs = Math.max(2, spoken(text).split(/\s+/).length / 2.6);
    ff(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", secs.toFixed(2), "-q:a", "9", file]); return;
  }
  if(PROVIDER === "azure") return azureTts(text, file);
  for(let attempt = 1; attempt <= 3; attempt++){
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: brandPlain(spoken(text)), model_id: MODEL, previous_text: prev ? brandPlain(spoken(prev)) : undefined, next_text: next ? brandPlain(spoken(next)) : undefined,
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.18, use_speaker_boost: true } }) });
    if(r.ok){ fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return; }
    const msg = await r.text();
    if(attempt === 3 || r.status === 401) throw new Error(`ElevenLabs ${r.status}: ${msg.slice(0, 200)}`);
    await new Promise(res => setTimeout(res, 4000 * attempt));
  }
}
/* Azure Speech (free F0 tier allows 20 requests a minute, so requests are spaced 3.3 seconds apart) */
async function azureTts(text, file){
  let plain = false;
  // every turn in its host's voice, all in one request (with a beat between hosts)
  const ssmlFor = () => `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">${
    turns(text).map((t, i) => `<voice name="${xml(t.host === HOSTS[1] ? AZ_VOICE_2 : AZ_VOICE)}">${i ? '<break time="250ms"/>' : ""}${plain ? xml(brandPlain(t.text)) : brandSsml(t.text)}</voice>`).join("")}</speak>`;
  for(let attempt = 1; attempt <= 5; attempt++){
    const ssml = ssmlFor();
    const wait = azLast + 3300 - Date.now(); if(wait > 0) await new Promise(r => setTimeout(r, wait)); azLast = Date.now();
    const r = await fetch(`https://${AZ_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3", "User-Agent": "v1pgl-weekly" }, body: ssml });
    if(r.ok){ const buf = Buffer.from(await r.arrayBuffer()); if(buf.length > 1000){ fs.writeFileSync(file, buf); return; } }
    const msg = r.ok ? "empty audio" : await r.text();
    if(r.status === 400 && !plain){ plain = true; log("  voice didn't take the letters tag; using dotted letters"); continue; }
    if(attempt === 5 || r.status === 401 || r.status === 403 || r.status === 400) throw new Error(`Azure Speech ${r.status}: ${String(msg).slice(0, 200) || "check AZURE_SPEECH_KEY / AZURE_SPEECH_REGION / AZURE_VOICE"}`);
    await new Promise(res => setTimeout(res, (r.status === 429 ? 15000 : 4000) * attempt));
  }
}

async function main(){
  // 1. the job: digest + script
  const job = env.JOB_FILE ? JSON.parse(fs.readFileSync(env.JOB_FILE, "utf8"))
    : await hub({ action: "video.job", secret: env.VIDEO_SECRET, week: env.WEEK });
  const segs = (job.script || []).filter(s => (s.text || "").trim());
  if(!segs.length) throw new Error("The script is empty");
  log(`${job.digest.season} ${job.digest.label}: ${segs.length} segments · voice: ${env.DRY_RUN === "1" ? "none (dry run)" : PROVIDER === "azure" ? "Azure " + AZ_VOICE + " + " + AZ_VOICE_2 : "ElevenLabs " + VOICE}`);

  // 1b. game clips: download each one now so a missing clip just drops out
  let ci = 0;
  for(const s of segs){
    s.clipFiles = [];
    if(s.kind !== "game") continue;
    for(const c of (s.clips || []).slice(0, 3)){
      const f = await getClip(c, ci++); if(!f) continue;
      let d = 0; try{ d = dur(f); }catch(e){}
      if(d >= CLIP_MIN) s.clipFiles.push({ file: f, len: d, title: c.title || "" });
    }
    if(s.clipFiles.length) log(`  ${s.id}: ${s.clipFiles.length} clip(s)`);
  }

  // 2. voice, one file per segment (each segment knows its neighbours so the delivery flows)
  const timeline = []; let t = LEAD;
  for(let i = 0; i < segs.length; i++){
    const s = segs[i], file = path.join(OUT, `seg${String(i).padStart(2, "0")}.mp3`);
    await tts(s.text, file, segs[i - 1] && segs[i - 1].text, segs[i + 1] && segs[i + 1].text);
    const d = dur(file);
    const start = i === 0 ? 0 : t - GAP / 2, speechStart = t;
    t += d + GAP;
    timeline.push(Object.assign({}, s, { file, start, speechStart, speechDur: d, dur: 0, turns: turns(s.text) }));
    log(`  ${s.id}: ${d.toFixed(1)}s`);
  }
  const total = t - GAP + TAIL;
  timeline.forEach((s, i) => { const end = i < timeline.length - 1 ? timeline[i + 1].start : total; s.dur = end - s.start; });
  // place each game's clips across its segment: scoreboard first, clips spaced out with stats and leaders between, scoreboard at the end
  const clipJobs = [];
  timeline.forEach(s => {
    s.clipsT = [];
    const cf = s.clipFiles || [], first = 9, tail = 7, avail = s.dur - first - tail;
    if(!cf.length || avail < CLIP_MIN + 2) return;
    const slot = avail / cf.length;
    cf.forEach(c => {
      const L = Math.min(c.len, CLIP_MAX, slot - 2); if(L < CLIP_MIN) return;
      const k = s.clipsT.length, S = s.start + first + k * slot + (slot - L) / 2;
      const from = Math.max(0, Math.min(c.len - L, c.len * 0.55 - L / 2));   // the moment is usually just past the middle of a clip
      s.clipsT.push({ s: S, e: S + L, title: c.title }); clipJobs.push({ file: c.file, from, L, S });
    });
  });
  if(clipJobs.length) log(`clips placed: ${clipJobs.length}`);

  // 3. the soundtrack: the hosts, the intro sting, a whoosh on every transition, and music under the open and the close
  //    (assets/sting.mp3, whoosh.mp3 and bed.mp3; swap in your own files with the same names any time)
  const inputs = [], filters = [], mixIn = [], ms = x => Math.max(0, Math.round(x * 1000)), A = f => path.join(here, "assets", f);
  const add = (file, chain, loop) => { const k = inputs.filter(x => x === "-i").length; if(loop) inputs.push("-stream_loop", "-1"); inputs.push("-i", file);
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,${chain}[m${k}]`); mixIn.push(`[m${k}]`); };
  timeline.forEach(s => add(s.file, `adelay=${ms(s.speechStart)}:all=1`));
  if(fs.existsSync(A("sting.mp3"))) add(A("sting.mp3"), "volume=0.8");
  if(fs.existsSync(A("whoosh.mp3"))) timeline.slice(1).forEach(s => add(A("whoosh.mp3"), `volume=0.5,adelay=${ms(s.start - 0.45)}:all=1`));
  if(fs.existsSync(A("bed.mp3")) && timeline.length > 1){
    const open = timeline[0], openEnd = timeline[1].start + 0.6, close = timeline[timeline.length - 1];
    // open: up front with the sting, down under the hosts, out at the first transition
    add(A("bed.mp3"), `atrim=0:${(openEnd - 0.5).toFixed(2)},asetpts=PTS-STARTPTS,volume='if(lt(t,${(open.speechStart - 0.3).toFixed(2)}),0.32,0.11)':eval=frame,afade=t=in:d=0.6,afade=t=out:st=${(openEnd - 2).toFixed(2)}:d=1.5,adelay=500:all=1`, true);
    // close: in under the sign-off, back up once they finish, out at the very end
    const cs = close.start, cl = total - cs, talkEnd = close.speechStart + close.speechDur - cs;
    add(A("bed.mp3"), `atrim=0:${cl.toFixed(2)},asetpts=PTS-STARTPTS,volume='if(lt(t,${talkEnd.toFixed(2)}),0.11,0.32)':eval=frame,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, cl - 2.5).toFixed(2)}:d=2.5,adelay=${ms(cs)}:all=1`, true);
  }
  const audio = path.join(OUT, "voice.m4a");
  ff([...inputs, "-filter_complex", filters.join(";") + ";" + mixIn.join("") + `amix=inputs=${mixIn.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`,
    "-map", "[out]", "-t", total.toFixed(2), "-c:a", "aac", "-b:a", "192k", audio]);

  // 4. the picture: every frame rendered at an exact time, piped straight into the encoder
  const name = `The-Final-Whistle-${job.digest.season}-${job.digest.label.replace(/\s+/g, "-")}.mp4`;
  const mp4 = path.join(OUT, name);
  // clips go into the box drawn by the graphics, video only (no audio is ever taken from them), with a quick fade in and out
  const B = CLIP_BOX, clipIn = [], fc = [];
  clipJobs.forEach((c, k) => {
    clipIn.push("-i", c.file);
    const F = Math.min(.35, c.L / 4);
    fc.push(`[${k + 2}:v]trim=start=${c.from.toFixed(3)}:duration=${c.L.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},scale=${B.w}:${B.h}:force_original_aspect_ratio=decrease,pad=${B.w}:${B.h}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuva420p,` +
      `fade=t=in:st=0:d=${F}:alpha=1,fade=t=out:st=${(c.L - F).toFixed(3)}:d=${F}:alpha=1,setpts=PTS+${c.S.toFixed(3)}/TB[c${k}]`);
    fc.push(`[${k ? "v" + (k - 1) : "0:v"}][c${k}]overlay=${B.x}:${B.y}:eof_action=pass:enable='between(t,${c.S.toFixed(3)},${(c.S + c.L).toFixed(3)})'[v${k}]`);
  });
  const mapV = clipJobs.length ? ["-filter_complex", fc.join(";"), "-map", `[v${clipJobs.length - 1}]`, "-map", "1:a"] : [];
  const enc = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-i", audio, ...clipIn, ...mapV,
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", "-shortest", mp4], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => enc.on("close", c => c === 0 ? res() : rej(new Error("ffmpeg exited " + c))));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => log("page error:", e.message));
  await page.goto(pathToFileURL(path.join(here, "broadcast.html")).href, { waitUntil: "networkidle" });
  const info = await page.evaluate(show => window.init(show), { digest: job.digest, timeline: timeline.map(({ file, clipFiles, clips, ...s }) => s), total, clipBox: CLIP_BOX, hosts: HOSTS });
  log(`graphics ready: ${info.scenes} scenes, ${info.images} images`);
  const frames = Math.ceil(total * FPS);
  for(let f = 0; f < frames; f++){
    await page.evaluate(x => window.seek(x), f / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 90 });
    if(!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once("drain", r));
    if(f % (FPS * 30) === 0) log(`  frame ${f}/${frames}`);
  }
  enc.stdin.end(); await done; await browser.close();
  // a still for the release page / Discord embed
  ff(["-ss", Math.min(LEAD + 1.2, total / 2).toFixed(2), "-i", mp4, "-frames:v", "1", "-q:v", "3", path.join(OUT, "thumb.jpg")]);
  const size = (fs.statSync(mp4).size / 1048576).toFixed(1);
  log(`done: ${name} · ${total.toFixed(1)}s · ${size} MB`);
  // quoted, because the publish step loads this file into bash ("Week 1" has a space)
  const q = v => "'" + String(v).replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(path.join(OUT, "env"), `VIDEO_FILE=${q(mp4)}\nVIDEO_NAME=${q(name)}\nSEASON=${q(job.digest.season)}\nLABEL=${q(job.digest.label)}\nVIDEO_SECONDS=${Math.round(total)}\n`);
}
main().catch(e => { console.error(e); fs.writeFileSync(path.join(OUT, "error.txt"), String(e.message || e)); process.exit(1); });
