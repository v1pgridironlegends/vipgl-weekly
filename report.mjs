// Tells the hub how the render went: node report.mjs done <url>  |  node report.mjs error "<message>"
const [kind, value] = process.argv.slice(2), env = process.env;
const body = { action: "video.done", secret: env.VIDEO_SECRET, week: env.WEEK };   // the video then waits for review in the Stat Desk
if(kind === "done") body.url = value; else body.error = value || "Render failed";
const r = await fetch(env.HUB_API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" });
console.log("hub:", r.status, (await r.text()).slice(0, 200));
