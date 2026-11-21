# Muse Gateway

Self-hosted Muse session pool + OpenAI-compatible gateway (`/v1/chat/completions`, `/v1/responses`, `/v1/tasks`, `/v1/models`) with a web dashboard and Windows system-tray integration. It runs on your own machine with your own Muse accounts, and any tool that speaks the OpenAI API can use it.

> **Free for everyone.** Every feature, including the `/v1/*` gateway API, works right
> after install, with no license key. A license key is optional: it gives your gateway its
> own **fixed tunnel URL**. Support and community: Telegram [@storetiki_bot](https://t.me/storetiki_bot).

## Install

```bash
npm install -g muse-gateway
```

## Run

```bash
muse-gateway
```

If `muse-gateway` is not recognized after installing, npm's global bin
directory is probably not on your PATH — `npx muse-gateway` works in that
case (npx resolves globally installed packages itself). To fix it
permanently, add npm's global bin dir (usually `%APPDATA%\npm`, check with
`npm prefix -g`) to your PATH.

Opens an interactive menu:

```
=======================================================
  Muse Gateway  v1.0.12
  Server:  http://127.0.0.1:1412   ● running — free
=======================================================
> Open Dashboard (Web UI)
  Hide to Tray (Background)
  Run in this terminal (foreground)
  Enter License Key… (fixed URL)
  Stop Server
  Exit
```

- **Open Dashboard** — starts the server if needed, opens http://127.0.0.1:1412
- **Hide to Tray** — runs in background with a system-tray icon (Open Dashboard / Auto-start / Quit) and a notification confirming you can close the terminal
- **Run in this terminal** — foreground server, Ctrl+C to stop
- **Enter License Key** — optional; paste a `MUSE1.…` key to get a fixed tunnel URL

## Fixed tunnel URL (optional license key)

Every feature works without a key. To expose the gateway on the internet you can
always start a Cloudflare quick tunnel (random `*.trycloudflare.com` URL that changes
on restart) or use your own Cloudflare tunnel token and domain.

A license key gives you a **fixed URL** instead: activate it (CLI menu, or Dashboard →
**Bản quyền**), then Dashboard → **Endpoint** → **Bật — URL riêng theo license**.
Get a key at https://www.storetiki.online or Telegram [@storetiki_bot](https://t.me/storetiki_bot).

## Connect your tool

After adding a Muse account in the dashboard, use these three values in any tool with a custom OpenAI endpoint:

| Setting | Value |
|---|---|
| Base URL | `http://127.0.0.1:1412/v1` |
| API key | Create one in the dashboard. Local calls need none until the first key exists. |
| Model | `muse-chat`, `muse-image`, `muse-video` or `muse-voice` |

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:1412/v1", api_key="YOUR_KEY")
reply = client.chat.completions.create(
    model="muse-chat",
    messages=[{"role": "user", "content": "Hello"}],
)
print(reply.choices[0].message.content)
```

### Models

The model decides what you get back. The gateway never guesses from the prompt.

| Model | Returns | Notes |
|---|---|---|
| `muse-chat` | Text | Returns when the reply settles. If Muse attaches a file anyway, its link is included. |
| `muse-image` | Images | Always asks Muse for an image and waits for it. No image is an error. |
| `muse-video` | A video | Like `muse-image`, and waits for the requested length (`duration`). |
| `muse-voice` | An mp3 | Reads the text aloud with Muse's voice tool. Also answers to `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts`. |
| a combo name | Its kind | Each combo is set to Chat, Image, Video or Voice in the dashboard and behaves like that model. |

`GET /v1/models` lists every model with a `kind` field (`chat`, `image`, `video` or `audio`). Names such as `gpt-4o` or `claude-3-5-sonnet` are aliases for clients that only offer those names; Muse answers them as `muse-chat`.

For a tool on another machine, turn on the tunnel in the dashboard and use the public address it gives you, such as `https://u-xxxx.storetiki.online/v1`. Through a tunnel an API key is always required, so treat that key like a password.

## Generate images, video and speech

### Images: `POST /v1/images/generations`

The standard OpenAI image endpoint, so tools with a built-in image feature work directly:

```bash
curl http://127.0.0.1:1412/v1/images/generations \
  -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"model": "muse-image", "prompt": "a cat on the grass", "size": "1024x1792"}'
```

`size` is mapped to the nearest ratio Muse understands (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3). `n` returns up to 4 of the images Muse made. `response_format` is `url` (default) or `b64_json`. The response is `{ "created": ..., "data": [{ "url": "...", "revised_prompt": "..." }] }`.

### Speech: `POST /v1/audio/speech`

The standard OpenAI text-to-speech endpoint. The response body is the mp3 itself:

```bash
curl http://127.0.0.1:1412/v1/audio/speech   -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json"   -d '{"model": "muse-voice", "input": "Xin chào các bạn", "voice": "Glad Kite"}'   --output speech.mp3
```

| Field | Required | Meaning |
|---|---|---|
| `input` | yes | Text to read, up to 4,096 characters |
| `model` | no | `muse-voice` (default) or a voice combo |
| `voice` | no | Any of Muse's 1,219 voice names, exactly as written (see the table below). Unset: `Glad Kite` for Vietnamese text, `Helio` otherwise |
| `language` | no | Locale such as `vi` or `en`. Unset: `vi` when the text is Vietnamese |
| `speed` | no | 0.25 to 4, 1 = normal |

Muse only makes mp3, so `response_format` is accepted but the answer is always `audio/mpeg`. A short text takes about 30 seconds.

**Longer text: use a task.** `POST /v1/tasks` with `"model": "muse-voice"` takes up to 6,000 characters (about 5 minutes of speech) with the same `voice`, `language` and `speed` fields. Muse returns one mp3 for the whole text; 6,000 characters take about 3 minutes to make. The finished task's `url` is the mp3 and `duration_sec` its length in seconds. Split anything longer into several tasks.

**Voices.** Muse has 1,219 voices. These are the Vietnamese-accented ones and a set of common English ones:

| Voice | | Accent | Character |
|---|---|---|---|
| `Glad Kite` | F | Vietnamese | Mid-range, measured (default for Vietnamese text) |
| `Breathless Rosette` | F | Vietnamese | Very high, light |
| `Sparkling Whistle` | F | Vietnamese | High, delighted |
| `Kindhearted Jetty` | M | Vietnamese | High, confident |
| `Questioning Satchel` | M | Vietnamese | Mid-range, curious |
| `Tenacious Mooring` | M | Vietnamese | High, resolute |
| `Zealous Harbor` | M | Vietnamese | High, booming |
| `Aria` | F | American | Friendly, warm |
| `Dynamic Sparkler` | F | American | Confident, dynamic |
| `Mellow Saxophone` | F | American | Smooth, friendly |
| `Soothing Ribbon` | F | British | Soothing, polished |
| `Helio` | M | American | Gentle, friendly (Muse's default) |
| `Warm Pebble` | M | American | Warm, professional |
| `Bold Flag` | M | American | Heroic, bold |
| `Boomy Mountain` | M | British | Deep, regal |

For any other voice, ask Muse in a chat (`muse-chat`) to look it up in its text-to-speech voice catalogue. OpenAI voice names keep working: `alloy`, `coral`, `nova`, `sage` and `shimmer` become `Aria`, the others become `Helio`, or `Glad Kite` / `Kindhearted Jetty` when the text is Vietnamese.

### Video and long jobs: the task API

Video takes minutes, so use the task API: create a task, then poll it or receive a webhook. Results are stored on your machine.

### Create a task

```bash
curl http://127.0.0.1:1412/v1/tasks \
  -H "content-type: application/json" \
  -H "authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "muse-video",
    "prompt": "A cat playing piano on a rooftop at night",
    "duration": 30,
    "ratio": "9:16",
    "images": ["https://example.com/cat.jpg"],
    "webhook_url": "https://example.com/hooks/muse",
    "webhook_secret": "choose-a-secret"
  }'
```

The gateway answers `202` right away with a task whose `status` is `running`.

| Field | Required | Meaning |
|---|---|---|
| `prompt` | yes | What to create, up to 20,000 characters |
| `model` | no | `muse-video` (default), `muse-image`, `muse-voice` or `muse-chat` |
| `duration` | no | Video length in seconds, 1 to 60 |
| `ratio` | no | `9:16`, `16:9`, `1:1`, `4:3` or `3:4` |
| `voice`, `language`, `speed` | no | Voice models only, as in `/v1/audio/speech`. A voice task's prompt is the text to read, up to 6,000 characters |
| `images` | no | Up to 16 reference images, as `http(s)` URLs or `data:image/...` URLs, at most 20MB each |
| `webhook_url` | no | Called once when the task ends |
| `webhook_secret` | no | Signs the webhook |
| `idempotency_key` | no | Sending the same key again returns the existing task |
| `new_chat` | no | Default `true`. Set `false` to continue the current conversation |
| `thread`, `account` | no | Continue a Muse thread; pass both, from an earlier result |

A URL that can't be loaded fails the request with `400`, so a job never runs without the reference you sent.

### Read the result

```bash
curl http://127.0.0.1:1412/v1/tasks/TASK_ID -H "authorization: Bearer YOUR_KEY"
```

```json
{
  "id": "task_3f9c...",
  "object": "task",
  "status": "succeeded",
  "model": "muse-video",
  "requested_duration_sec": 30,
  "url": "http://127.0.0.1:1412/api/media/media-abc.mp4",
  "duration_sec": 30.1,
  "media": [{ "url": "http://127.0.0.1:1412/api/media/media-abc.mp4", "kind": "video", "duration_sec": 30.1 }],
  "partial": false,
  "text": "Your video is ready.",
  "thread_url": "https://muse.ai/thread/...",
  "account_id": "...",
  "error": null,
  "webhook_status": "delivered"
}
```

- `status` is `running`, `succeeded`, `failed` or `cancelled`. Poll every 10 seconds or so.
- `url` is the final file. `media` lists everything delivered.
- `partial: true` means Muse stopped before the requested length, and `url` is the longest clip it delivered. Open `thread_url` to check it.
- Media links are permanent only while the gateway keeps the file. Copy results you want to keep.

Other calls:

| Call | Effect |
|---|---|
| `GET /v1/tasks?limit=20` | Your latest tasks, up to 100 |
| `DELETE /v1/tasks/TASK_ID` | Stops waiting for the task. A render already inside Muse keeps running there and may use your Muse quota. |

Restarting the gateway fails tasks that were still running; finished results stay readable. The last 500 finished tasks are kept.

### Webhook

When a task ends, the gateway sends a `POST` to `webhook_url`, retrying twice if your server doesn't answer with `2xx`:

```json
{ "event": "task.succeeded", "task": { "id": "task_3f9c...", "status": "succeeded", "url": "..." } }
```

The event is `task.succeeded`, `task.failed` or `task.cancelled`. With a `webhook_secret`, verify `X-Muse-Signature`, which is `sha256=` plus the HMAC-SHA256 of the raw body:

```js
import crypto from "node:crypto";

const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const valid =
  signature.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
```

A webhook needs an address the gateway can reach. Calls that come through a tunnel can't target private network addresses, so `localhost` webhooks only work for local callers.

### Use chat completions instead

`POST /v1/chat/completions` with `muse-image` or `muse-video` (or an image/video combo) also generates media, which suits tools that only speak the OpenAI API. Send `stream: true`, because proxies cut long silent requests. Extra fields are `duration`, `thread`, `account`, `new_chat` and `idempotency_key`. Images go in `image_url` parts, as URLs or data URLs, on the last user message.

Links appear as text under `Attachments:`, and the final chunk also carries them in structured form:

```json
{ "muse": { "media": [{ "url": "...", "kind": "video", "duration_sec": 30.1 }], "partial": false, "thread_url": "...", "account_id": "..." } }
```

### Good to know

- One job delivers up to 60 seconds. Split longer videos into several tasks.
- A long video can take many minutes. The gateway waits for the requested length, and returns what it has after 5 minutes without progress. Change this with `MUSE_LONG_RENDER_GRACE_MS`.
- Each account runs a few jobs at once; extra jobs wait in line.
- Audio input isn't supported.
- `/v1/responses` doesn't accept reference images.

### Errors

| HTTP | Meaning |
|---|---|
| `400` | Invalid request, or a reference image couldn't be loaded |
| `401` | API key missing or wrong |
| `403` | This key can't use that model |
| `404` | Task not found, or it belongs to another key |

## Your responsibility

The gateway drives your own muse.ai accounts through a browser. Check that this fits Muse's terms before you use it, and accept the risk that an account may be limited or banned. Only generate content you have the right to make, especially when using a real person's face.

## Commands

| Command | Effect |
|---|---|
| `muse-gateway` | interactive menu |
| `npx muse-gateway` | same, without needing npm's bin dir on PATH |
| `muse-gateway stop` | stop the background instance |
| `muse-gateway --open` | open the dashboard |
| `muse-gateway --serve` | run server in foreground (used internally) |
| `muse-gateway --version` | print version |
| `MUSE_PORT=4000 muse-gateway` | custom port (default 1412) |

## Data location

All runtime state (sessions, license, API keys, usage, media, logs) lives in
`~/.muse-gateway` — never inside the installed package. Uninstalling keeps data;
delete `~/.muse-gateway` for a full reset.

- `~/.muse-gateway/server.log` — background server log
- `~/.muse-gateway/data/` — sessions, license.json, keys.json, pool, media

## Requirements

- Windows 10/11, Node.js ≥ 20.9
- Chrome or Edge installed (used for Muse account login capture)

## License

MIT — open source at https://github.com/lynbyte/muse-gateway. All features are free for everyone; a license key only adds a fixed tunnel URL.
