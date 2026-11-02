// Voice sampler → out/samples/*.mp3
//   SET=duos (default): the same two-host exchange in MultiTalker Ava+Andrew and in pairs of separate HD voices
//   SET=singles: one host, several voices · SET=all: both
// Env: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (eastus), VOICES (optional, singles only, comma-separated)
import fs from "node:fs";
const env = process.env, region = env.AZURE_SPEECH_REGION || "eastus", set = (env.SET || "duos").toLowerCase();
const xml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// the brand is said "V-I-P-G-L" / "V-I-P" (written with a 1 everywhere else)
const brand = t => xml(t).replace(/v1phub/gi, "V, one, P hub").replace(/V1PGL/gi, "VIPGL|").replace(/V1P/gi, "VIP|").replace(/(VIPGL|VIP)\|/g, '<say-as interpret-as="characters">$1</say-as>');
const brandPlain = t => xml(t.replace(/v1phub/gi, "V, one, P hub").replace(/V1PGL/gi, "V.I.P.G.L.").replace(/V1P/gi, "V.I.P.").replace(/\.\.(?!\.)/g, "."));
fs.mkdirSync("out/samples", { recursive: true });

async function say(name, ssml){
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3", "User-Agent": "v1pgl-weekly" }, body: ssml });
    await new Promise(res => setTimeout(res, 3300));   // free tier: 20 requests a minute
    if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 1000) { fs.writeFileSync(`out/samples/${name}.mp3`, b); console.log("✓", name); return true; } }
    const msg = r.ok ? "empty audio" : (await r.text()).slice(0, 200);
    if (r.status !== 429) { console.log("✗", name, r.status, msg); return false; }
    await new Promise(res => setTimeout(res, 15000));
  }
  return false;
}
const speak = body => `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">${body}</speak>`;

// ---- one host ----
if (set === "singles" || set === "all") {
  const voices = (env.VOICES || "en-US-Andrew:DragonHDLatestNeural,en-US-Andrew2:DragonHDLatestNeural,en-US-Davis:DragonHDLatestNeural,en-US-Brian:DragonHDLatestNeural,en-US-Steffan:DragonHDLatestNeural").split(",").map(v => v.trim()).filter(Boolean);
  const line = "Good evening, and welcome to V1PGL Weekly. Week 2 did not disappoint. The Memphis Steamers held off Houston, 24 to 17, behind 286 yards and three touchdowns from Marcus Hale. In Nashville, the Black Knights went on the road and took over, 31 to 13. Let's get into it.";
  for (const v of voices) { const n = "solo-" + v.replace(/^en-US-/, "").replace(/:.*$/, "");
    if (!(await say(n, speak(`<voice name="${xml(v)}">${brand(line)}</voice>`)))) await say(n, speak(`<voice name="${xml(v)}">${brandPlain(line)}</voice>`)); }
}

// ---- two hosts: lead (A) and color (B) ----
if (set === "duos" || set === "all") {
  const talk = [
    ["A", "Good evening, and welcome to V1PGL Weekly. Week 2 is in the books, and it did not disappoint."],
    ["B", "It sure didn't. We had a road statement in Nashville, a kick that came down to the wire in Boston, and the Steamers are still perfect."],
    ["A", "Let's start in Memphis. The Steamers held off the Houston Orbits, 24 to 17, and Marcus Hale was surgical. 286 yards and three touchdowns."],
    ["B", "And that 64-yard strike in the third quarter? That's the one that broke it open. Houston never really recovered."],
    ["A", "Meanwhile, Denver went on the road and took over. The Black Knights beat Nashville, 31 to 13."],
    ["B", "Jalen Brooks ran wild. 168 yards and two scores. That's a back who wants the ball every single down."],
    ["A", "We've got a lot more to get to, and every box score is up on v1phub dot com. Let's get into it. Be V1P."]
  ];
  // MultiTalker: one voice that performs both hosts, reacting to each other (preview)
  const turns = talk.map(([who, t]) => `<mstts:turn speaker="${who === "A" ? "andrew" : "ava"}">${brandPlain(t)}</mstts:turn>`).join("");
  const mt = `<voice name="en-US-MultiTalker-Ava-Andrew:DragonHDLatestNeural"><mstts:dialog>${turns}</mstts:dialog></voice>`;
  if (!(await say("duo-MultiTalker-Andrew+Ava", speak(mt))))   // some docs use the https namespace for dialog; try that too
    await say("duo-MultiTalker-Andrew+Ava", speak(mt).replace('xmlns:mstts="http://www.w3.org/2001/mstts"', 'xmlns:mstts="https://www.w3.org/2001/mstts"'));
  // Two separate HD voices trading lines
  const pairs = [["Andrew", "Ava"], ["Andrew", "Emma"], ["Davis", "Ava"], ["Andrew", "Andrew2"]];
  for (const [a, b] of pairs) {
    const body = f => talk.map(([who, t]) => `<voice name="en-US-${who === "A" ? a : b}:DragonHDLatestNeural">${f(t)}</voice>`).join("");
    if (!(await say(`duo-${a}+${b}`, speak(body(brand))))) await say(`duo-${a}+${b}`, speak(body(brandPlain)));
  }
}
