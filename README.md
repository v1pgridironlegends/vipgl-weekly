# V1PGL Weekly

The weekly recap show for V1PGL. Two studio hosts, Davis and Ava, walk through every final (150–250 words a segment, with muted Twitch clips), the star performances, Players of the Week, milestones and records, the power rankings and next week's slate, over V1P broadcast graphics.

**How it works:** Stat Desk → **Weekly video** → *Write script* → edit anything → *Make video*.
GitHub then voices the script (Azure Speech, free tier), renders the graphics frame by frame, publishes the MP4 as a Release on this repo, and sends it back to the Stat Desk for you to watch. It only goes to Discord News when you click **Post to Discord**.

## One-time setup

### 1. This repo
- Create a **public** repo (e.g. `v1pgl-weekly`) and upload everything in this folder, including the `.github` folder.
- It has to be public so the video link works for everyone. No keys are stored in the code.

### 2. The voice: Azure Speech (free tier)
- In the Azure portal, open your **Speech** resource and go to **Keys and Endpoint**.
- Copy **KEY 1** and the **Region** (`eastus`).
- The free tier (F0) covers 500,000 characters a month. A weekly show uses about 25,000–30,000.
- It's a two-host desk: **Davis** (`en-US-Davis:DragonHDLatestNeural`) anchors and **Ava** (`en-US-Ava:DragonHDLatestNeural`) is the analyst. In the script, each line starts with `DAVIS:` or `AVA:`.
  - To hear the options, go to the Actions tab → **Voice samples** → *Run workflow*. Download the **voice-samples** zip at the bottom of the run, which has Andrew, Andrew2, Davis, Brian and Steffan reading the same lines.
  - To switch voices, set the `AZURE_VOICE` (lead) or `AZURE_VOICE_2` (analyst) variable (step 3).
- ElevenLabs still works: leave `AZURE_SPEECH_KEY` out and add `ELEVENLABS_API_KEY` instead.

### 3. Repo settings → Secrets and variables → Actions
**Secrets** tab, add:
| Name | Value |
|---|---|
| `HUB_API` | your Apps Script `/exec` URL (the same one the Stat Desk uses) |
| `VIDEO_SECRET` | the shared secret (also goes in Apps Script, step 5) |
| `AZURE_SPEECH_KEY` | KEY 1 from your Azure Speech resource |

**Variables** tab (optional):
| Name | Value |
|---|---|
| `AZURE_SPEECH_REGION` | only if it isn't `eastus` |
| `AZURE_VOICE` | a different lead voice, e.g. `en-US-Andrew:DragonHDLatestNeural` |
| `AZURE_VOICE_2` | a different analyst voice, e.g. `en-US-Emma:DragonHDLatestNeural` |

### 4. A GitHub token for the Stat Desk button
- GitHub → Settings → Developer settings → **Personal access tokens → Tokens (classic)** → Generate new token (classic).
- Tick the **public_repo** scope, set the expiration, then copy the token.

### 5. Apps Script → Project Settings → Script Properties
| Property | Value |
|---|---|
| `GH_TOKEN` | the token from step 4 |
| `GH_REPO` | `your-github-name/v1pgl-weekly` |
| `VIDEO_SECRET` | the same secret as in step 3 |

## Clips
Each game segment can show up to 3 Twitch clips from the v1psports channel, played **muted** in a framed highlight window, with team stats and game leaders in between.
- When the script is written, clips from the last 10 days are matched to each game by team name in the clip title.
- On the Stat Desk, under each game, remove a clip with ✕ or add one from the dropdown (last 21 days), then **Save edits**.
- GitHub downloads the clips with yt-dlp while it renders. A clip that won't download is skipped, and that game uses graphics only.
- Tip: put the team name in the clip title when you clip it on stream, so it lands on the right game.

## Running it by hand
Actions tab → **V1PGL Weekly** → *Run workflow* → enter the week (e.g. `2`). You can also enter a voice for that run only.

## Testing locally
`DRY_RUN=1 JOB_FILE=job.json node render.mjs` renders with timed silence instead of the voice.
