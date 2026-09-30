# Playing online

Players who are online see each other in the city: figures in bright shirts with a name tag, their taxi or sky taxi
when they ride, and short emotes over their heads. The game stays a static site on GitHub Pages; a small server on
Cloudflare (in [`server/`](../server)) relays where everyone is. Without it, the game plays exactly as before.

## What players can do, and cannot

- **See** the nearest 48 other players within 150 m.
- **Emote** from a fixed list (`Z`, or EMOTE on a phone): hello, follow me, wow, cat here, nice view, dance, meow, bye.
  Some come with a gesture (a wave, arms up, a spin); a meow is heard nearby.
- **Be found**: a shared link ("Share this view", `L`) opens the same spot in the same city, so friends land next to you.
- **Nothing else.** There is no chat and no typed name. Names are drawn from two word lists (e.g. `COSMIC GECKO`) and
  can be re-drawn in the panel. Players do not collide or block each other, so there is nothing to grief with.

This is deliberate: free text needs moderation (filters, reports, bans, someone reading them). Keeping to a fixed
vocabulary means nothing anyone sends can be offensive. When adding emotes, append to `EMOTES` in
[`src/net/protocol.ts`](../src/net/protocol.ts) and keep them just as harmless; name words live in
[`src/net/names.ts`](../src/net/names.ts) and must stay harmless in any pairing.

## Who is online

The ONLINE line in the panel reads like `3 near you, 57 in the city`, and the District list shows how many players
are in each district (`JAPANTOWN (12 online)`), so it doubles as a way to go where people are.

Each zone room counts the players standing in it, by district (the page says which district it is in when that
changes), and reports to one `Stats` object per city: 5 s after someone arrives, leaves or changes district, and every
45 s while someone stands in it, using an alarm so a sleeping room still reports. The reply is the whole city's count,
which the room passes to its players over their existing connections, so pages never poll. Counts are therefore up to
about a minute behind, and a room that vanishes without reporting drops out after 150 s. Only connected players count:
hidden tabs and idle players have already disconnected. Cloudflare takes the `Stats` object out of memory about 10 s
after its last call, so it keeps each room's count in its storage too, rewriting an unchanged one at most once a
minute.

The same numbers are public as JSON, cached for 30 s:
<https://glyphwalk-online.benjamin-soulier.workers.dev/stats> (add `?seed=42` for another city):

```json
{"seed":1337,"online":57,"districts":{"DOWNTOWN":31,"JAPANTOWN":12,"MEDINA":14}}
```

## When players do not see each other

Two players see each other only when all of these hold:

- **Within 150 m.** A district is far bigger than that, so "2 online" in the District list can be two players a
  kilometre apart; the ONLINE line then reads `nobody within 150 m, 2 in the city`. To meet, one shares a link
  ("Share this view", `L`) and the other opens it.
- **The same city**: a link with `seed=` is another city (Stats for nerds shows the world seed).
- **Both connected**: a tab hidden for 20 s, or a player idle for 10 minutes, disconnects (`paused while away`).
  Two tabs of one window cannot test this, since one of them is always hidden: use two windows side by side.
- **The same layer**, which only differs once a zone room holds 250 players.

To find out which one fails:

- **Stats for nerds** (`I`) shows the player's name, status, how many are in sight and how far the nearest is, and a
  line per zone connection (`0,0 layer 0 (you are here): open, 42 received`, with why it last closed). Two players
  standing together must both be open on the same zone and layer.
- **<https://glyphwalk-online.benjamin-soulier.workers.dev/debug>** (add `?seed=42` for another city) lists the
  occupied rooms: each zone (1024 m squares, with the x and z it covers), its layer, its players by district and
  how long ago its count was recorded (up to a minute more than its last report, see above). Counts only, cached
  for 5 s.
- **The server's log**: `cd server && npx wrangler tail` streams it live, and the Cloudflare dashboard (Workers &
  Pages > glyphwalk-online > Logs) keeps it for a few days. One line per event, with the room as
  `seed/zx/zz/layer`: `join` and `refused` (with the reason, such as `outdated page` or `full`), `placed` (the first
  position arrived, `here: false` for a player only watching across the zone's edge), `leave` (with the close
  reason), and `room`, each time a room reports its head count: who is in it, how many players each is sent
  (`sees`) and how far away the nearest one standing there is (`nearest`, in metres).

## How it scales

```
browser --wss--> Worker (/zone) --> Durable Object "zone"  (one per world seed x 1 km zone x layer)
```

- **Zones.** The city is cut into 1024 m squares. Each is one Durable Object: a single-threaded room that holds the
  WebSockets of the players in it. A player connects to the zone they stand in, and to a neighbouring one when they are
  within 150 m of its edge (so usually one or two connections), and only the zone they stand in shows them to others.
- **Layers.** A zone room takes at most 250 connections. The next player is refused with a "full" message and joins
  layer 1 of the same zone, then 2, up to 32. Layers are separate copies of the zone: players in different layers do
  not see each other. This is what keeps a crowd at the spawn point, or a link shared to thousands, from overloading
  one room; each layer runs on its own.
- **Interest management.** Each tick a client is sent only players that are new to it or moved, among its 48
  nearest within sight, plus the ids to forget and the emotes near it. States are 13 bytes up and 16 down.
- **Quiet rooms cost nothing.** The server only ticks (every 100 ms) while something changes. Idle rooms stop, and
  with the WebSocket hibernation API the object sleeps with the sockets still open; pings are answered without waking
  it. Clients send only while they move (5 times a second to their own zone, once a second to a neighbour).
- **Idle players leave.** A tab hidden for 20 s, or a player idle for 10 minutes, closes its connections and
  reconnects when they come back. Automated browsers never connect.
- **Reconnects** back off exponentially with jitter (1 s to 30 s), so a server restart does not bring every client
  back in the same second.

Measured on a laptop: a full room of 250 players packed within 20 m, all moving, costs about 6 ms of CPU per 100 ms
tick and sends about 100 KB per tick; spread over a street it is under 1 ms. The load test below, run against
`wrangler dev`, splits 500 players at one spot into two layers of 250, each receiving its 48 nearest, with a move
reaching a watcher in about 120 ms (95th percentile about 200 ms).

### Limits and cost

On the Workers Free plan (as of 2026): 100,000 requests a day, where 20 incoming WebSocket messages count as one
request, and 13,000 GB-s a day of Durable Object time (a room is billed at 128 MB while awake).

- Messages: a moving player sends 5 a second, which is about 900 billed requests an hour, so about 110 player-hours
  a day while everyone keeps moving (standing still sends nothing).
- Time: an awake room costs 450 GB-s an hour, so about 29 room-hours a day.
- Head counts: an occupied room reports about 80 times an hour (a report and an alarm each time), so about 4,000
  requests a day for a room that is never empty. Its count is written to storage when it changes, else at most once a
  minute: about 40 rows an hour, 1,000 a day of the free 100,000.
- Logs: three lines per connection (join, placed, leave) and one per report, far under the free 200,000 a day.

Over the free limits, joining fails until 00:00 UTC and the game carries on single-player. The Workers Paid plan
($5/month) includes 1 million requests and 400,000 GB-s a month, then $0.15 per million requests and $12.50 per
million GB-s: roughly half a cent per room-hour. See the
[pricing page](https://developers.cloudflare.com/durable-objects/platform/pricing/) for current numbers.

## Safety

- **Rate limits**, per connection: 12 messages a second on average (bursts of 30); over that, messages are dropped,
  and a client that keeps flooding is disconnected. One emote every 2 s. Malformed messages disconnect.
- **Validation**: positions must be finite and within range, modes and emotes must exist. Nothing a client sends is
  passed on except its position, mode, heading and emote index.
- **Origins**: only the pages listed in `ALLOWED_ORIGINS` (in [`server/wrangler.jsonc`](../server/wrangler.jsonc)) can
  connect from a browser, so other sites cannot embed the rooms.
- **Ids**: two connections with the same id in one room are refused; the second page draws a new id.
- If someone scripts a flood of connections from outside a browser, add a rate limiting rule for `/zone` per IP in the
  Cloudflare dashboard (Security > WAF > Rate limiting rules).

## Privacy

The server stores no positions: they live in memory while players are connected, and a room keeps only the last
position of each open socket so it can sleep. The only thing sent is where the player is, their camera mode and
heading, and emotes. The id (and so the name) is random, kept in `localStorage` under `glyphwalk.online.v1`, and
re-drawn with "new name". Cloudflare sees connecting IP addresses, as any host does; the Worker does not log them.
Its log (see above) holds only generated names, rooms, counts, close reasons and distances between players, never a
position; invocation logs are off (`observability` in [`server/wrangler.jsonc`](../server/wrangler.jsonc)), so no
request details are kept either. Set `"enabled": false` there to stop keeping the log.

## Deploying the server

Needs a Cloudflare account (the free plan is enough).

```sh
cd server
npm install
npx wrangler login           # opens the browser once
npx wrangler deploy          # prints https://glyphwalk-online.<your-subdomain>.workers.dev
curl https://glyphwalk-online.<your-subdomain>.workers.dev/   # "Glyphwalk online server"
```

Then point the site at it: set `VITE_ONLINE_URL=wss://glyphwalk-online.<your-subdomain>.workers.dev` in
[`.env.production`](../.env.production), commit, and publish the site as usual (`npm run deploy`, see
[DEPLOYMENT.md](DEPLOYMENT.md)). The ONLINE line in the panel shows the connection.

If the page moves to another address, add it to `ALLOWED_ORIGINS` and run `npx wrangler deploy` again.

The server needs no secrets. `wrangler login` keeps the Cloudflare credentials in your home folder, never in the
repository; if one is ever needed, store it with `npx wrangler secret put NAME`, not in `wrangler.jsonc` or a committed
file. The server URL itself is public (every page has to know it); what protects the server is described under Safety.

### Changing the protocol

Both ends share [`src/net/protocol.ts`](../src/net/protocol.ts). Anything incompatible must bump `PROTOCOL`: the
server then turns older pages away with a "reload the page" message instead of misreading them. Deploy the server
first, then the site. Appending emotes needs no bump.

## Developing and testing

```sh
cd server && npm run dev      # the server on ws://127.0.0.1:8787, rooms in memory
npm run dev                   # in the repository root
# open http://localhost:5173/?online=ws://127.0.0.1:8787 in two browser windows (one private, for a second id)
```

- Unit tests (`npm test`) cover the protocol, the room logic in [`server/src/zone.ts`](../server/src/zone.ts) (which
  has no Cloudflare dependency, so it runs in Node), and the client's connections and smoothing.
- `cd server && npm run typecheck` checks the Worker against the Cloudflare types.
- `cd server && npm run load` runs the load test against a running server (`N`, `SPREAD`, `SECONDS` and `URL`
  environment variables). Locally, `wrangler dev` itself becomes the bottleneck at around 1000 connections, since it
  proxies every frame through one Node process; on Cloudflare each room runs separately.
