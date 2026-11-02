// Voice sampler: the same studio-host lines read by several Azure HD voices → out/samples/*.mp3
// Env: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (eastus), VOICES (optional, comma-separated)
import fs from "node:fs";
const env = process.env, region = env.AZURE_SPEECH_REGION || "eastus";
const voices = (env.VOICES || "en-US-Andrew:DragonHDLatestNeural,en-US-Andrew2:DragonHDLatestNeural,en-US-Davis:DragonHDLatestNeural,en-US-Brian:DragonHDLatestNeural,en-US-Steffan:DragonHDLatestNeural")
  .split(",").map(v => v.trim()).filter(Boolean);
const line = "Good evening, and welcome to V1PGL Weekly. Week 2 did not disappoint. The Memphis Steamers held off Houston, 24 to 17, behind 286 yards and three touchdowns from Marcus Hale. In Nashville, the Black Knights went on the road and took over, 31 to 13. Let's get into it.";
const xml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
fs.mkdirSync("out/samples", { recursive: true });
for (const v of voices) {
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3", "User-Agent": "v1pgl-weekly" },
    body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${xml(v)}">${xml(line)}</voice></speak>` });
  const name = v.replace(/^en-US-/, "").replace(/:.*$/, "");
  if (r.ok) { fs.writeFileSync(`out/samples/${name}.mp3`, Buffer.from(await r.arrayBuffer())); console.log("✓", name); }
  else console.log("✗", name, r.status, (await r.text()).slice(0, 200));
  await new Promise(res => setTimeout(res, 3300));   // free tier: 20 requests a minute
}
