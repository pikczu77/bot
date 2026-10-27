# Notes for Claude: Klubik Pikcza bot

This is the "Klubik Pikcza" Discord bot, a fork of TitanBot (discord.js 14). The owner (Pikczu)
writes in Polish. Keep this file current: add a dated entry under "Change log" for every
change you make, so the next session knows what was done and why.

## Never do
- Never run `npm start` with the real `.env`. The same token runs on the host, so you would log
  in as the live bot and touch production data.
- Never commit `.env`, `data/`, keys or the bot's address. **This repository is public.**
- Never remove bot commands on your own. List the candidates and let the owner choose.
  Never propose removing economy commands (the owner said the economy is very important).

## Test and ship
- `npm test` uses in-memory storage and mock Discord objects. All tests must pass.
- Boot check: from an empty folder run `node <repo>/src/app.js` with `DISCORD_TOKEN=invalid`.
  It must reach "Logging into Discord..." and fail only on the token.
- `npm run i18n` lists missing translations. English text in the source is the key. Polish lives
  in `src/i18n/locales/pl*.json`. Every user-facing string goes through `t` from `src/i18n/index.js`.
- Discord allows 100 global slash commands. Add features as subcommands of an existing command
  (see `createCommandGroup` in `src/utils/commandGroup.js`), not as new top-level commands.
- Release: `node scripts/publish.js --message-file <file>` regenerates `release-files.json`, runs
  the tests, commits everything (`git add -A`) and pushes `main`. The host pulls `main` at its next
  restart, which only the owner can do. If other Claude sessions have unfinished files in this
  folder, commit your own files by path and push by hand instead.
- `release-files.json` must match `src/` (`node scripts/release-files.js` rewrites it); a test fails otherwise.

## Economy map
- Upgrades (`/ulepszenia`): `src/services/economyUpgrades.js` (`UPGRADES`, prices, `staminaCooldown`).
- Payout scaling: `scaleEarnings(settings, amount, userData)` in `src/services/economySettings.js`.
  It applies the server multiplier and the Fortune upgrade. Pass `userData` at every payout.
- Casino and luck: `src/services/casino.js` (`applyLuck`, `luckPoints`, `takeLuck`, `checkBet`).
- Jail: `src/services/economyJail.js` (`assertNotJailed`, bail: `bailOffer`, `payBail`), bail button
  `src/interactions/buttons/economy/jail.js` (custom id `wiezienie:wykup`). Pass `{ settings, guildId }`
  to `assertNotJailed` so the jail message offers bail. A user error can carry buttons in
  `context.components`; `handleInteractionError` sends them with the embed.
- Jobs of `/work`: `src/services/economyJobs.js`, `src/commands/Economy/modules/work_shift.js`.
- Shop items and tiers: `src/config/shop/items.js`. Items with `retired: true` are not sold but
  members keep them, and they count as their `sameAs` item (`ownsItem`, `takeConsumable`).
- Collections: `src/services/collections.js` (rarities, golden/diamond versions, the 20 fish, the
  21 Club'o'mony cards, the 3 packs and their odds). `/paczka` and `/index`:
  `src/commands/Economy/modules/collection_view.js`, buttons `paczka:*` / `index:*` in
  `src/interactions/buttons/economy/collection.js`, sell menu `src/interactions/selectMenus/economy/index.js`.
  Member data: `cards` and `fishIndex` maps, key `<id>` / `<id>:golden` / `<id>:diamond`.
- `/pozwij`: `src/commands/Economy/modules/lawsuit.js` (`sueChance`), buttons `pozew:*` in
  `src/interactions/buttons/economy/lawsuit.js`, settings `commands.sue`.
- `/nagraj` (YouTuber job, was `/mine`): `src/commands/Economy/mine.js` (`VIDEO_RARITIES`,
  `rollVideo`). Internally it is still "mine": `settings.commands.mine`, `lastMine`, the `mine`
  upgrade and item chain, the `mine` cooldown type. Do not rename those ids: stored data uses them.
- Guide for the info channel: `src/commands/Economy/modules/economy_guide.js` (`/economy poradnik`),
  menu handler `src/interactions/selectMenus/economy/guide.js` (custom ids `poradnik:pokaz`,
  `poradnik:zmien`). The channel gets one short message with a topic menu; each topic opens as a
  private reply built from the server's settings at that moment, so it never goes stale. When you
  add or change an economy command, update `GUIDE_TOPICS` and the Polish text in `pl.eco-guide.json`.
  Visual check without Discord: dump the views to JSON and render a Discord-like HTML page, then
  screenshot it with headless Edge (`msedge --headless=new --screenshot=...`).
- Missions, badges, stats (since 2026-10-26): `src/services/progress.js`. Every earning command calls
  `recordProgress(userData, events, { settings, now })` before it saves and adds `progressEmbeds(progress, guildId)`
  to its reply (casino: `playRound` does it from `result.events`; blackjack: `finish`). Event keys = stat names:
  work, fish, nagraj, beg, slut, crime, crimeWin, jail, rob, robWin, sue, sueWin, daily, casino, casinoWin, jackpot,
  rouletteNumber, blackjackNatural, packs, earned (job money), fishRare, fishLegendary, videoViral, videoLegendary,
  wordle, quiz, trades. A new earning command must send its events too. Missions: 3 daily (new at Warsaw midnight)
  and 3 weekly (Monday), `MISSIONS`, paid at once times the server multiplier, a full set gives a free pack
  (`BONUS_PACKS`), one swap per period (`misje:zmien`). Badges: `ACHIEVEMENTS` with `progress(userData)`, paid once.
  Views: `modules/progress_view.js` (`/misje`, `/osiagniecia`). Day/week keys: `src/utils/warsawTime.js`.
  `progressOptions.enabled` is false under `NODE_ENV=test` (old tests check exact balances); `test/progress.test.js` turns it on.
- `/napad` (team heist, since 2026-10-26): `modules/heist.js` (`HEIST_TARGETS`, `heistChance`, lobbies in memory),
  buttons `napad:dolacz|zapros|start|wyjdz:<id>` (`interactions/buttons/economy/heist.js`), invite picker `napad:kogo:<id>`
  (`selectMenus/economy/heist.js`). Settings `commands.heist` (cooldownMinutes, payoutPercent). Events heist, heistWin, earned, jail.
- Missions switch: `settings.missions` { enabled, rewardPercent } (`missionsEnabled`, `missionReward` in progress.js).
  Off = no missions are handed out or paid; stats and badges still count.
- Guide: bump `GUIDE_VERSION` in `economy_guide.js` when the channel message or the topic list changes; `refreshEconomyGuides`
  (ready event) edits the posted guides once.
- `/gielda` (since 2026-10-27): `src/services/stockMarket.js` (`COMPANIES`: 6 made-up companies, `advanceMarket` once an hour,
  log-price pulled 3% an hour towards the base, limits 20%-500% of the base, a headline shock 8-25% in 8% of hours; store
  `guild:{id}:stock-market`; job `stock_market`). Member data `stocks = { [id]: { shares, cost } }`. Settings `commands.stocks`
  { feePercent, maxShares }. Events stockTrades, stockProfit. Shares are safe from /rob; no multiplier or Fortune on prices.
- `/klub` (since 2026-10-27): `src/services/clubs.js` (store `guild:{id}:clubs`, lock key `#clubs` before member locks), invite buttons
  `klub:tak|nie:<clubId>:<userId>` (`interactions/buttons/economy/club.js`). Members carry `userData.club = { id, bonus, crew }`
  (`syncMembers`): `clubBonusPercent` in `earningMultiplier` (not /daily), `clubCrewBonus` in /napad. Weekly points = stat `earned`
  minus each member's `baseline`; job `clubs_week` pays the top 3 on Monday (`settleClubWeek`, posted on the events channel).
  Settings `commands.clubs` { foundPrice, weeklyPrize }. Events clubJoin, clubDeposit.
- `/nieruchomosci` (since 2026-10-27): `src/services/properties.js` (`PROPERTIES`, rent by the full hour, at most
  `commands.property.maxHours` waits, 3 upgrades +30% each, sale returns `sellPercent` of everything spent). Member data
  `properties = { [id]: { level, collectedAt, spent } }`. Rent: server multiplier and `incomePercent`, no Fortune or events.
  Events propertyBuy, propertyCollect, propertyIncome.
- Tests: `test/economy.test.js`, `test/economy-views.test.js`, `test/economy-rules.test.js`, `test/progress.test.js`, `test/heist.test.js`,
  `test/market.test.js` (stocks, clubs, buildings, open trade offers).

## Economy rules the owner set (keep them)
- `/rob` takes 80% of the victim's cash and 50% of the bank. Each "Bank security" level takes
  10 points off the bank share, down to 10%.
- Luck adds percentage points to the win chance (40% with luck +3 is 43%). Luck upgrade:
  +1 point per level, 15 levels. All luck sources together give at most +25 (cap); since 2026-10-26 +20 (owner). Since
  2026-10-15 the Diamond Clover gives +5 (owner), so the real best is 15 + 5 + 4 = 24.
  Bets that pay more than x2 get fewer points, `(2 / payout)^2` of them; the owner wanted big
  payouts (roulette number x36) to get "an even smaller chance".
- Fortune: 5 levels, +10% of every payout per level (max +50%), expensive (25,000 doubling to
  400,000). It multiplies work, mine, fish, crime, slut, beg, `/daily`, chat money and level-up money.
- Stamina: 10 levels, -5% per level (max -50%). It shortens the breaks of every earning command
  and the casino. Not `/daily`, not jail.
- Jail (after a failed `/crime`) blocks `/work`, `/mine`, `/fish`, `/beg`, `/crime`, `/slut`,
  `/rob` and the casino. `/daily`, bank, `/pay`, shop and upgrades still work.
- Bail: leave jail at once for 2,000 (owner: "wykupic sie z wiezienia za 2000").
- `/nagraj` works like `/fish`: each video has a rarity and a view count; common pays little,
  legendary a lot. Items: Computer (needed), Internet +50%, Better Internet +100%. `/work` items:
  Pen +50%, Suit +100%. What members bought before stays with them and counts as the new item.
- Club'o'mony packs (`/paczka`): Starter 1,500 (1 card), Collector 5,000 (2), Legend 10,000 (3).
  A common card is worth about $2, a legendary 15,000-30,000. Legendary chance: highest in the
  Legend pack, tiny but real in the Starter pack. Packs must stay "not too OP": on average a pack
  returns less than it costs. Golden x1.2, diamond x1.6 (cards and fish).
- `/pozwij`: any amount; the higher it is, the lower the chance (shown before the case starts,
  with buttons to raise or lower the amount). "Street smarts" (upgrade id `crime`) counts for it.

## Automod map
- `src/services/automodService.js` (`checkMessage`, rules, free hours), lists in `src/config/automodPresets.js`.
- Rule `slurs` (owner: slurs like the n-word or "cwel" are never allowed, "nawet po 22"): on by
  default, checked before every other rule, ignores the words rule's free hours and free channels,
  reads digits/symbols as letters (`findSlur`). Keep it that way. Since 2026-10-26 its preset also
  holds sexual words that are never allowed on a server with young members (nudes, pedofil, porn).
- `rules.words.freeChannels`: channels where swearing is allowed (the owner's #wulgarny-chat).
- Night channels: `src/services/nightChannel.js`, settings `nightChannels: [{ channelId, from, to }]`
  (max 10, text or voice) in the automod config, job `night_channel` every minute
  (`src/services/features.js`), also run after a panel save. Remembers who could see each channel
  before closing (store `night-channel`, `{ channels: { [id]: state } }`) and restores it.

## Minecraft whitelist map
- `src/services/minecraftWhitelist.js`: Pterodactyl client API (default panel `https://ptero.mathost.eu`,
  the owner's paid MatHost server), channel handler `handleWhitelistMessage` (called from
  `src/events/featureMessages.js` after automod), `releaseMemberOnLeave` (from `guildMemberRemove.js`).
  Store `guild:{id}:minecraft-whitelist`: `enabled, channelId, roleId, removeOnLeave, panelUrl,
  serverId, apiKey, members: { [userId]: { name, at } }`.
- Commands: `/minecraft whitelista ustaw|dodaj|usun|lista|wylacz` in
  `src/commands/Minecraft/modules/whitelist.js`; the `ustaw` form is modal `whitelista:ustaw:<channel>:<role|->:<1|0>`
  (`src/interactions/modals/minecraft/whitelist.js`).
- The API key is secret: it is typed only into the private form, never returned by any reply, panel
  endpoint or log, and a saved key is never sent to a different panel address. `wylacz` deletes it.
- Web panel (pikczu.pl/bot, module "Minecraft"): `GET` / `PATCH /api/v1/guilds/:guildId/minecraft` in
  `src/api/panelApi.js` (`minecraftView`, `applyMinecraft`), also `modules.minecraft` in `GET /guilds/:guildId`.
  The view has `hasKey` instead of the key; `members[userId] = { name, at, user }` (`user` = Discord name).
  PATCH takes `enabled, channelId, roleId, removeOnLeave, panelUrl, serverId, postGuide`; `apiKey` in the body
  is refused (400). A different `panelUrl` is refused while a key is saved; a new `serverId` is first opened
  with the saved key (same panel). A new channel (while on) or `postGuide: true` posts the guide message.
  Saves go through `updateWhitelistSettings` (same lock as the member changes).
- Console channel: `src/services/minecraftConsole.js` (`handleConsoleMessage`, called from
  `featureMessages.js` after the whitelist handler), `/minecraft konsola [kanal]` in
  `src/commands/Minecraft/modules/console.js` (no channel = off). Same store and panel key as the
  whitelist, field `consoleChannelId`. Only Administrator / server owner / bot owners may run
  commands (and set the channel): the console can op players and stop the server. Output is read
  from the panel websocket (`GET /websocket`, `ws` with `origin` = panel address, Wings checks it;
  confirmed on the real MatHost panel 2026-10-23), for `consoleTiming.outputMs` after the commands.
- Chat link (since 2026-10-26): `src/services/minecraftChat.js`, `/minecraft czat [kanal] [wydarzenia]` in
  `src/commands/Minecraft/modules/chat.js` (Manage Server; no channel = off). Same store and panel key, fields
  `chatChannelId`, `chatEvents`. One long-lived panel websocket per guild reads the console (`parseChatLine`:
  vanilla/Paper chat, joins, leaves, advancements, deaths, start/stop); chat goes out through a "Minecraft"
  webhook with the player's name and mc-heads.net head (plain bot messages without Manage Webhooks), never pings.
  Discord messages on the channel become `tellraw @a` (`handleChatBridgeMessage`, after the console handler;
  bot and webhook messages are skipped earlier, so no loop). Job `minecraft_chat` every minute opens/closes the
  sockets (`syncChatBridges`), a dropped socket retries after 30 s ... 5 min. Panel API: `chatChannelId`,
  `chatEvents` in `minecraftView` / `applyMinecraft`. Chat plugins that change the console format are not read.
- Tests: `test/minecraft-whitelist.test.js` (fake panel and fake Mojang API through `globalThis.fetch`),
  `test/minecraft-panel.test.js` (panel API over HTTP, fake hosting panel), `test/minecraft-console.test.js`
  (fake websocket through `consoleSocket.create`), `test/minecraft-chat.test.js`, `test/minecraft-server.test.js`.
- Power and backups (since 2026-10-26): `src/services/minecraftServer.js` (`serverStatus`, `sendPower`, `createBackup`,
  `tickBackup`), `/minecraft serwer` + `/minecraft kopie [co_ile]` in `src/commands/Minecraft/modules/server.js`, buttons
  `mcserwer:start|restart|stop[:tak]|kopia|odswiez` (`src/interactions/buttons/minecraft/server.js`). Administrator only
  (`canUseConsole`). Store fields `backupEveryHours`, `lastAutoBackupAt`, `lastBackup`. Job `minecraft_backup` every minute.
  Automatic backups are named `Discord auto ...`; a full plan deletes only the oldest unlocked automatic backup. Panel API:
  `backupEveryHours` (0-168) in PATCH, `chatRecent` (last 30 chat lines, memory) and `lastBackup` in the view.
- Public status for pikczu.pl/smp (since 2026-10-26): `src/services/minecraftLive.js`, job `minecraft_live` every minute
  for each guild with a connected whitelist panel: panel `/resources` (state, uptime) + mcsrvstat.us ping at the address of a
  `/minecraft track` server on that guild, else the panel's default allocation (`GET ''`, cached 1 h; `0.0.0.0` = no
  address, the poll fails). "Since" in memory (a chat-bridge join line gives the exact minute), "last seen" in the store
  `guild:<id>:minecraft-live` (`seen`). A sample of names (names < count) never marks anyone as gone. Panel API
  `GET /api/v1/minecraft/live` -> `{ servers: [{ guildId, checkedAt, state, startedAt, count, players }] }`, players =
  online first (longest playing first), then the whitelist nicks with `lastSeen`. The owner's rule: the Club SMP is a private
  SMP of YouTubers - this view must never carry the address, version, player limit, Discord names or chat
  (`test/minecraft-live.test.js` checks the response text).

## Music map
- Riffy 1.0.12 + public Lavalink v4 nodes from `lavalink/nodes.json` (no own Lavalink server).
  `src/services/music/riffySetup.js` subclasses Riffy: node order from `nodeHealth.js` (`rankNodes`:
  playing players per core, CPU, lost audio frames, 3 min penalty after a failure) instead of Riffy's
  REST call count; endless reconnects (Riffy deleted a node after 3 tries); no 30 s retry on 5xx;
  `prepareNode` drops events from a node a player has left.
- `playerRecovery.js`: a failed or stuck track moves to another node and continues at the same second
  (max 2 moves per track), a dropped node's players move, a node losing >4% of frames is left
  (checked every minute). `movePlayer` sends `channelId` with the voice data (Lavalink 4.2 needs it).
- `musicActions.js`: `resolveTracks` asks the player's node, then the others; plain text tries
  ytmsearch, ytsearch, scsearch. `cleanQuery` cuts YouTube Mix (`list=RD`) links to the song.
- Look: `musicEmbeds.js` (player message, `/play` answer, queue). Text in `pl.music.json`.
- Volume default 100 and max 100: any other volume makes the node re-encode the audio.
- Before changing nodes: probe them (`/v4/info`, `/v4/loadtracks`, and a player without voice:
  `TrackStartEvent` = the node can stream, `TrackExceptionEvent` = it cannot).
- Own Lavalink server (since 2026-10-26, owner's guide in `lavalink/README.md`): `LAVALINK_HOST` in `.env` adds a
  node named `LAVALINK_NAME` (default `Wlasny`) before the public ones; `rankNodes` puts it first while it is not
  cooling down and loses at most 4% of frames. `LAVALINK_ONLY_OWN=true` drops the public nodes.
- Tests: `test/music.test.js`. Voice itself cannot be tested without the live bot (owner checked it 2026-10-26).

## Change log
- **2026-10-14 evening** (not yet live; the owner must restart the bot after the push):
  - Luck model changed from a relative multiplier to percentage points (owner's request).
    Luck upgrade 10 to 15 levels. Total luck capped at +25 (owner's answer). To keep each source
    useful under the cap I lowered the items (my decision): golden clover 10 to 4, diamond clover
    15 to 6, Lucky Clover 10 to 4, Lucky Charm 5 to 2. Max = 15 + 6 + 4 = 25.
  - New upgrade "Fortune" (💰, id `fortune`). My decisions: it does not apply to casino wins,
    robberies or `/daily` interest; it is counted last, after all other bonuses.
  - Stamina 8 to 10 levels, now also on `/crime`, `/slut`, `/rob` and the casino.
  - Jail now blocks all earning and the casino (owner: "wiezienie ma powodowac ze nie mozesz pracowac").
  - `/work` job offers show the member's server level in the title, and how many levels are
    missing to the next job.
  - New `/economy poradnik [kanal]`: posts the economy guide (7 embeds, 2 messages). Running it
    again in the same channel edits the same messages. Message ids are stored in
    `guild:{id}:economy-guide`. The owner wants it in `#ekonomia-info`.
  - Note for balance: with the live server's `/gamble` at 50% and x2, +25 luck gives 75% and a
    profit on every bet. A max bet or a lower win chance would limit that; the owner has not chosen.
- **2026-10-14 ~19:15** (owner: the first guide "wygląda jak sraka", wants to pick a tutorial):
  - `/economy poradnik` now posts ONE message with a topic menu (10 topics: first steps, earning,
    bank and robberies, casino, luck, upgrades, shop, jail and breaks, dates and marriage, all
    commands). A pick opens the tutorial privately (ephemeral) with its own menu to switch topics.
    The channel menu is reset by answering with `update`, the tutorial comes as a `followUp`.
  - Re-running the command replaces the old 2-message guide (stored ids) with the new message.
  - Breaks read "1 h 30 min" / "24 h" instead of "1d".
  - Upgrade effects name their command ("+30% /work pay" instead of "+30% earnings"), also in
    `/ulepszenia` and the earning messages.
- **2026-10-15** (owner: "zrob zeby mozna bylo wykupic sie z wiezienia za 2000"; live after the
  owner restarts the bot):
  - Bail: every jail message (the failed `/crime` and each blocked command) shows
    "🔓 Wykup się ($2,000)". Pressing it pays from cash first, then bank, and ends jail at once.
  - New setting `commands.crime.bailPrice` (default 2000, 0 = no bail). The panel shows the field
    "Wykup z więzienia" under /crime only when the bot returns it, so an older bot never gets it.
  - My decisions: no new command (the button is enough and keeps the command count); whoever
    presses the button pays their own bail (no owner id in the custom id, because the jail check
    does not know the member's id everywhere); the price is fixed (no server multiplier, no
    Discount upgrade, no Fortune); the guide's jail topic shows the price.
- **2026-10-15 ~07:00** (owner: change the miner job to a YouTuber job, keep what members bought,
  sell computer, internet and better internet; `/work` items become pen and suit; like fishing,
  show the views, legendary pays a lot, common little). Live after the owner restarts the bot:
  - `/mine` is now `/nagraj` (owner picked the name). Prefix `!mine`, `!yt`, `!youtube` still work.
    Same file `mine.js`, same internal id "mine" (settings, cooldown, upgrade, item chain).
  - Rarity chances 50/25/15/8/2% (common, uncommon, rare, epic, legendary), pay multipliers
    x0.4 / x0.8 / x1.5 / x3 / x8 of a base between the server's min and max (average ≈ x1.03, so
    the economy stays where it was). Views: 50-2,000 / 2k-25k / 25k-250k / 250k-1M / 1M-10M.
    Within a rarity more views also pay more (one random position drives both). My numbers.
  - New items: `pc` Computer 2,500 (needed), `internet` 18,000 (+50%), `fiber_internet` Better
    Internet 50,000 (+100%); `pen` 8,000 (+50% /work), `suit` 25,000 (+100% /work, needs the pen);
    `clickbait` Clickbait Thumbnail (next video: double views and pay, priced like the old dynamite).
  - Retired (not sold, kept, owner chose "count as the new ones"): pickaxe = pc, steel pickaxe =
    internet, diamond pickaxe = better internet, laptop = pen, gaming computer (`computer`) = suit,
    dynamite = clickbait. `/ekwipunek` shows "→ works as ...". Shop price overrides stored for the
    old ids are ignored; the new items start at the default prices.
  - The "Mining" upgrade is now "YouTube" (🎬), same id, levels kept. Guide, `/ulepszenia` and the
    panel (pikczu.pl/bot, Ekonomia > Zarobki: card "/nagraj") updated. Tests: `test/nagraj.test.js`.
- **2026-10-15 ~07:20** (owner, three messages: a card collection job where you spend to earn,
  "Club'o'mony", 3 packs from weak to best, 1/2/3 cards, common $2, legendary 15-30k, starter pack
  1,500, best 10,000, not too OP but a chance to get rich; then "niech będzie /index", fish collected
  there too, more fish, golden x1.2, diamond x1.6; then `/pozwij`). Live after the owner restarts the bot:
  - `/paczka [rodzaj]`: buys and opens a pack (cash first, then bank; blocked in jail). Without a
    choice it lists the packs with odds. After opening: "Sell these cards", "Your index", and a
    button per pack. Packs and card names are mine: Starter (📦 1,500, 1 card), Collector (🎁 5,000,
    2), Legend (👑 10,000, 3). 21 cards (parody names, e.g. Bulwazaur, Iwi, Czaryzard, Król Pikczu
    30,000). Average return 84% / 88% / 92%; a legendary in 0.6% / 3.4% / 11% of packs (my numbers,
    checked by `test/collections.test.js`). Card values are fixed: no multiplier, Fortune or Discount.
  - Golden (5%, x1.2) and diamond (1%, x1.6) versions for cards and fish (the owner said "etc.";
    I applied it to both).
  - `/index [osoba] [zakladka]`: cards tab (X/21, value, ❔ ??? for missing ones, sell menu for one
    card, "Sell duplicates" keeps one of each version, pack buttons) and fish tab (X/20 species).
    Someone else's index can only be looked at.
  - `/fish`: 20 species (was 9). My change: the fish now sets the pay like `/nagraj` videos
    (common x0.4 ... legendary x8 of the server's min-max, average ≈ x1); before, the rarity was
    only a label. The owner's earlier message assumed fish already worked that way.
  - `/pozwij osoba kwota`: private preview with the chance and buttons -50% / -10% / +10% / +50%,
    "Sue (X%)" and "Cancel"; the result is posted in the channel. Chance = 60% x (1 - amount /
    defendant's cash+bank)^2, at least 1%; the amount can never be more than they have. Won: the
    defendant pays (cash first, then bank), the plaintiff gets the amount + Street smarts bonus.
    Lost: 20% court costs to the defendant (Insurance pays them once). Break 60 min (Stamina
    shortens it), defendant needs at least 500, no spouse, blocked in jail. Settings
    `commands.sue` (panel card "/pozwij", shown only when the bot returns it). My decisions: no
    jail for a lost case, no Fortune or server multiplier on the payout.
  - 74 commands now (was 71).
- **2026-10-15 ~16:00** (owner, three Discord messages: admin option to reset one member's
  money, get someone out of jail or remove upgrades one by one or all; Diamond Clover 5%; in
  the upgrades show that the full fish deck gives +50% fishing money and all cards +20% from
  all jobs). Live after the owner restarts the bot:
  - `/economy gracz osoba` (Manage Server): private view with cash, bank, jail, upgrades; buttons
    "Reset money" (asks first; cash/bank = the server's starting amounts, the member's own account
    only - items, cards, fish and upgrades stay), "Free from jail", "Remove every upgrade" (asks
    first), menu "Remove one upgrade". Code: `modules/economy_admin.js`, custom ids `ekoadmin:*`.
  - Diamond Clover +6 -> +5 (luck best 24 now, under the cap 25).
  - Collection bonuses (`services/collections.js`, read in `earningMultiplier`): every fish species
    caught once = +50% on `/fish`; at least one copy of every card = +20% on `/work`, `/nagraj`,
    `/fish`, `/beg`, `/crime`, `/slut`, `/pozwij` (not `/daily`, my reading of "all jobs").
    Added to the upgrade bonus, not multiplied. Shown in `/ulepszenia` (field "📖 Kolekcje"),
    `/index` and the guide; the sell menu warns before the last copy of a card goes. My decision:
    the card bonus needs the cards held now, the fish bonus counts every catch ever.
    `/beg` now also uses `earningMultiplier(userData, 'beg')` (only the card bonus applies there).
  - Tests: `test/admin-bonus.test.js`.
- **2026-10-16 morning** (owner, Discord messages: "na nigger, cwel i tego typu podobne słownictwo
  nie pozwalam nawet po 22"; #wulgarny-chat visible only 22:00-6:00 with swearing allowed there).
  Live after the owner restarts the bot; the web panel part is deployed:
  - New automod rule "Wyzwiska" (`slurs`), on by default with `PRESET_SLURS` (racist and
    homophobic words; asfalt/bambus left out because they are normal words), action "delete +
    warning". Works also in the free hours and on free channels. Exempt roles/channels and
    Manage Messages still skip automod as before.
  - Words rule: "Kanały, gdzie wolno przeklinać" (`freeChannels`).
  - Panel Automoderacja: card "Wyzwiska" (list + ready list), free-channel chips in "Zakazane
    słowa", tab "Noc" (channel, opens at, closes at). The owner still has to pick #wulgarny-chat
    there twice: as the night channel and as a free channel (my split: one is visibility, the
    other swearing). I did not set it on the live server myself.
  - My decisions: closing denies View Channel to @everyone and every overwrite that allowed it,
    the bot keeps itself an allow; Administrators always see every channel (Discord rule).
- **2026-10-16 ~06:20, finished 2026-10-17** (owner: "więcej haczyków i więcej kamer, żeby można
  było kilka razy pod rząd używać fish i nagrywaj, tak samo jak work"; "jak masz dalej użycia, to po
  użyciu jednym daj guzik pracuj ponownie"). One session wrote the code on 2026-10-16 and stopped
  before testing; the next session added the Polish text, `test/hooks.test.js` and pushed it.
  Live after the owner restarts the bot:
  - Two new item chains in `src/config/shop/items.js` (field `inARow` = uses before the break):
    hooks for `/fish` - Spare Hook 6,000 (2), Hook Set 15,000 (3), Tackle Box 35,000 (4); cameras
    for `/nagraj` - Second Camera 8,000 (2), Camera Kit 20,000 (3), Recording Studio 45,000 (4).
    Names and prices are mine. They appear in `/sklep`, `/ulepszenia` (Items folder), the guide
    and the panel's shop list (the panel reads the catalog, no panel change needed).
  - `takeUseInARow` in `src/services/economyUpgrades.js` works like the `/work` Overtime row:
    stored `fishStreak` / `mineStreak` next to `lastFish` / `lastMine`; after the row an Energy
    Drink skips the break. Members who used the command before rows existed count as 1 use.
  - Button "Pracuj / Łów / Nagrywaj ponownie (N)" (`modules/again_button.js`, handler
    `src/interactions/buttons/economy/again.js`, custom id `ponownie:<work|fish|nagraj>:<ownerId>`)
    under `/work`, `/fish` and `/nagraj` while uses are left, or while an Energy Drink / Extra Work
    Shift could skip the break (then the label shows how many). It replaces the message; only the
    owner can press it, a break or jail answers privately. `/fish` and `/nagraj` now run inside
    `withEconomyLock` (`runFish`, `runRecord`), so a double click cannot use one break twice.
- **2026-10-17** (owner: channel 1560399575481589822 must appear at 22:00 and disappear daily;
  "niech bedzie w automoderacji jako kanaly do ustawienia z godzinami na stronie"). Live after the
  owner restarts the bot; panel deployed:
  - The single `nightChannel` became a list `nightChannels` (each channel its own hours). An old
    stored `nightChannel` and its closed state are read as the first list entry.
  - Panel Automoderacja, tab "Godziny": rows channel / od / do, "+ Dodaj kanał", "Usuń". An older
    bot still gets the old "Noc" card.
  - My decisions: closing remembers permissions before editing and retries if it fails half-way;
    one run per guild at a time; voice channels allowed; same from/to rejected.
  - Not done: the channel itself is not set on the live server (the panel key on disk did not
    match the host). The owner picks it in the panel; disappear hour default 6:00 (my guess).
- **2026-10-21** (owner, Discord message: "dodaj drugi serwer pod bota, to ma być bot połączony z
  serwerem minecraft ... automatycznie dodawał na whiteliste nicki które napisze się na danym kanale";
  answers: the same bot on a second Discord server, the Minecraft server is a paid MatHost server, Java).
  Live after the owner restarts the bot:
  - No new top-level command: `/minecraft whitelista` group (see "Minecraft whitelist map").
    The bot is already multi-server; the second Discord server only needs the bot invited.
  - MatHost runs Pterodactyl (`ptero.mathost.eu`, found through their `MatHost-Node` npm module),
    so the bot uses the panel client API instead of RCON: console command `whitelist add` when the
    server runs (then reads `whitelist.json` back to confirm), direct edit of `whitelist.json` when
    it is stopped (UUID from Mojang, or the offline UUID when `online-mode=false`).
  - My decisions: one nick per member (a new one replaces the old one), a nick held by someone else
    is refused, 10 s pause per member, answers in the channel disappear after 20 s (the ✅/❌
    reaction stays), nick removed when the member leaves (on by default, option
    `usun_po_wyjsciu`), optional role for whitelisted members, the guide message is posted when
    `ustaw` is saved.
  - Not done: the web panel (pikczu.pl/bot) still serves only Klubik Pikcza (`SERWER` in
    `pikczu/tools/serwer/bot.js`), so the second server is configured with commands only.
- **2026-10-22** (site only, no bot code changed; live on pikczu.pl): the web panel now has a
  server picker. The site asks for the bot's servers and sends `serwer` with every request, so the
  existing `/api/v1/guilds/:guildId/...` routes serve the second Discord server too. Access is
  checked per server on the site side (details in `pikczu/README.md`, "WYBOR SERWERA W PANELU").
  Still no panel view for the Minecraft whitelist: `panelApi.js` has no endpoint for it, and one
  must never return `apiKey`.
- **2026-10-22 afternoon** (task from the session that built the server picker: a "Minecraft" module in
  pikczu.pl/bot so the owner sees and changes the whitelist settings of the second Discord server without
  slash commands). Live after the owner restarts the bot; the page side is in the site project
  (`pikczu/CLAUDE.md`, 2026-10-22 "Minecraft" entry). Until the restart the panel says the bot lacks the module:
  - New `GET` / `PATCH /api/v1/guilds/:guildId/minecraft` and `modules.minecraft` in the guild overview
    (details in "Minecraft whitelist map"). No new command, no new translation.
  - The panel key stays Discord-only: the view says `hasKey`, PATCH refuses `apiKey`, and a different panel
    address is refused while a key is saved (the owner changes the address with `/minecraft whitelista ustaw`).
  - My decisions: turning the whitelist on needs a saved key and a channel; a new server ID is checked with
    the saved key before it is stored; the guide message is posted for a new channel (while on) or on the
    panel's "send the guide again" button; turning it off from the panel keeps the key (only `wylacz` deletes
    it); the panel shows who holds which nick but cannot add or remove nicks (still `/minecraft whitelista`).
- **2026-10-23** (owner: "dodaj zebym mogl wpisywac komendy na jakims czacie"). Live after the owner
  restarts the bot:
  - `/minecraft konsola kanal:#...` makes a Discord channel the server console: each line of a message
    is sent as a console command through the panel API, and the bot replies with the console lines
    printed in the next 2.5 s (code block, colour codes removed, newest lines kept, no pings).
  - My decisions: Administrator only (Manage Server is not enough), also for setting the channel; at
    most 5 commands of 400 characters per message; it cannot be the whitelist channel; a warning when
    @everyone can see the channel; every run is logged with the member and the commands; refusals
    disappear after 20 s, output stays. `wylacz` of the whitelist deletes the key, so it stops the
    console too. No panel (pikczu.pl/bot) field for the console channel yet.
  - New dependency `ws` (was already installed through discord.js and riffy).
- **2026-10-26** (owner: "na glownym czacie dalej da sie pisac przeklenstwa od 22 a nie powinno tak byc").
  No code change; live setting changed through the panel API with the owner's yes:
  - Cause: on pikczu club™ the words rule had `freeHours` on (22-6). Free hours allow banned words on
    EVERY channel, so #chat let members swear after 22. 🤬｜nocny-chat was already in `freeChannels`
    and in `nightChannels` (visible 22-6).
  - Set `rules.words.freeHours` to false (PATCH sent only that field). Now swearing is allowed only on
    🤬｜nocny-chat; slurs stay banned everywhere. Read back after the change: other settings unchanged.
  - If the owner asks for swearing "after 22" again: that is `freeChannels` (+ a night channel), not
    `freeHours`, unless they want it on all channels.
- **2026-10-26, later** (owner, Discord: "stulejka i takie nieodpowiednie słowa dla młodszej widowni też
  usuwaj", "dih", "na chacie ma nie być nigdy można pisać, ma być można tylko na tym przekleństwa",
  "nudes itp", "pedofil"). Live lists changed through the panel API (owner's words kept, new ones
  appended: words 54 to 87, slurs 21 to 36); presets in `src/config/automodPresets.js` updated for the
  panel's "Gotowa lista" buttons and new servers:
  - `PRESET_WORDS` + sexual words (stulej*, dih, dick*, cycki, seks, masturb*, "wal* konia", zboczeniec
    ...): deleted everywhere except the free channel (🤬｜nocny-chat).
  - `PRESET_SLURS` + nudes*, pedofil*, porn*, hentai*, r34, onlyfans*, dickpic* ...: never allowed,
    also on the night chat. My call: the server has young members and these are not swearing.
    The panel card still describes this list as "rasistowskie i homofobiczne" (site text not changed).
  - Test: `test/automod-night.test.js` ("words for a young audience"), innocent words checked (nudy,
    pedagog, zboczenie z trasy, cyklon, stulecie).
- **2026-10-17, finished 2026-10-26** (owner: "nie dziala w ogole odtwarzanie muzyki, popraw jak wyglada
  i zeby dzialal, jak juz dziala to mega zacina"; the session was interrupted on 2026-10-17 and resumed
  with "try again"). Live after the owner restarts the bot. Details in "Music map":
  - Causes found: 2 of 4 public nodes were dead (Jirayu: REST 500, 1025 players on 2 cores, lost
    frames; TriniumHost: 502) and Riffy rotated players and searches onto them; a 5xx search waited
    30 s; after 3 failed reconnects Riffy deleted a node for good, so a long-running bot ended with no
    nodes; default volume 75% forced re-encoding on busy nodes (stutter); the idle timer never left
    the channel (Riffy keeps `player.current`); auto-pause in an empty channel never ran because
    `voiceStateUpdate.js` returned before the music call.
  - Nodes now: Nazha (Lavalink 4.2.2), Serenetia, MilloHost; all three streamed YouTube in a test on
    2026-10-17 and again on 2026-10-26. Spotify links and YouTube playlists resolve (Nazha).
  - YouTube links are allowed again (were refused); Mix links play only the song.
  - New look: one player message with a progress bar, artwork, requester, volume, loop, next song,
    emoji control buttons (one play/pause toggle), Polish text; nicer `/play` answer and queue.
  - My decisions: volume max stays 100% (above it the node re-encodes); a failed track gets two
    other nodes before it is skipped; a stuttering player moves at most once per 4 minutes.
  - Confirmed by the owner on 2026-10-26 after the restart: music plays without stutter.
    If it stutters again, the real fix is an own Lavalink server near Europe (`lavalink/application.yml`).
- **2026-10-26 afternoon** (owner: "kasyno dajemy zeby dawalo x1.7", after I showed that `/gamble` at 50% x2
  with +25 luck wins on every bet). Live after the owner restarts the bot:
  - `/gamble` default payout x2 -> x1.7. A stored x2 (the live server had 50% / x2) becomes x1.7 once:
    `BALANCE_VERSION` 3 in `economySettings.js`. A payout picked in the panel after that stays as picked.
    The shop price reset of version 2 still runs only for settings older than version 2.
  - Roulette colour, even/odd and halves (`EVEN_MONEY_PAYOUT` in `casino.js`) and a won blackjack hand pay
    x1.7 too (my reading of "kasyno"). Blackjack 3:2, dozens x3, number x36 and slots are unchanged.
  - I could not change the live setting through the panel API myself (reading the key file was blocked).
  - Math for the owner: 50% x1.7 = 85% return; with the best luck (+24) 74% x1.7 = 126%, still a profit.
    Break-even at 50% base is about +9 luck.
  - Panel (pikczu.pl/bot, Minecraft): card "Konsola serwera". `minecraftView` returns `consoleChannelId` and
    `consolePublic` (@everyone sees the channel); PATCH takes `consoleChannelId` (null = off) with the same rules
    as `/minecraft konsola`: a saved key, not the nick channel while the whitelist is on, bot permissions; a new
    channel gets the console guide. Running commands still needs Administrator on Discord.
  - Own Lavalink (owner: "zrob" on my idea list): code and guide only. The owner still has to create the Java
    server, upload `Lavalink.jar` + `lavalink/application.yml` and add `LAVALINK_HOST/PORT/PASSWORD` to the bot's
    `.env`. Until then nothing changes (public nodes).
  - `/misje` and `/osiagniecia` (owner: "6 zrob", "7,8 zrob" on my list; details in "Economy map"). 76 commands.
    My decisions: rewards and goals (`MISSIONS`, `ACHIEVEMENTS`), a free Starter pack for all daily missions and a
    Collector pack for all weekly ones, one free swap a day and a week, badges reached before the release (fish
    already in /index) are given on the next action, "earned" counts job money only (not casino, robbery, /daily).
  - `/wymiana osoba [daje] [chce] [doplacam] [chce_kasy]` (`modules/trade.js`, buttons `wymiana:ok|nie|anuluj:<offerId>`):
    cards (autocomplete from each side's cards) and money one way; posted in the channel, only the partner accepts,
    both sides are checked again at the swap. My decisions: only cards and money (fish are sold when caught, so
    there is nothing to trade); offers live 15 min in memory (gone after a restart); own accounts only, no joint
    bank of a marriage. 77 commands.
  - Economy events (owner: "9 fajne, niech bedzie info na osobnym kanale i niech usuwa sie po skonczeniu"):
    `src/services/economyEvents.js`, `/economy event start|stop|ustaw` (`modules/economy_events.js`), job
    `economy_events` every minute. Settings `events` in the economy settings (channel, role ping, automatic
    events every ~`everyHours` for `durationMinutes`, the running one in `active`). Types: kasa (x2 every payout
    to a member through `scaleEarnings` with `userData`, not prices or rewards), ryby (/fish x2, golden and diamond
    x3 as often), youtube (/nagraj x2), szczescie (+5 casino luck, above the 25 cap), paczki (packs half price).
    The announcement is deleted when the event ends or is stopped. My decisions: the types, one event at a time,
    automatic events off by default (random type, the next one 0.75-1.25 x `everyHours` later).
  - `/wordle` (owner: "zrobmy wordle za kase, ze mozna raz dziennie zrobic wordle"): `src/services/wordle.js`, views
    `modules/wordle_game.js`, button `wordle:zgaduj:<owner>`, modal `wordle:odp:<owner>`, words
    `src/config/wordleWords.js` (243 common Polish five-letter words, my list). One word a day per server (Warsaw
    midnight, a different order per server, no repeat until the list is used up), six guesses, private board,
    the finished result posted in the channel as squares only. Reward `commands.wordle.reward` (default 3,000) x
    1 / 0.85 / 0.7 / 0.55 / 0.4 / 0.25 by guesses, then the server multiplier, Fortune and a "kasa" event.
    My decisions: any five Polish letters count as a guess (no dictionary check), streak for days in a row. 78 commands.
  - `/quiz pytanie|ustaw` (owner picked idea 13; Manage Server): `src/services/quiz.js`, 123 Polish questions in
    `src/config/quizQuestions.js` (`a[0]` is right, shuffled when posted), buttons `quiz:<questionId>:<0-3>`
    (`interactions/buttons/fun/quiz.js`), job `quiz` every minute, `noteQuizActivity` in `featureMessages.js`.
    Store `guild:{id}:quiz` (channel, auto, everyMinutes, reward 1,500, recent questions). My decisions: one try per
    member, 45 s per question, the first right answer wins (prize x server multiplier, Fortune, "kasa" event),
    automatic questions only when a member wrote on the channel since the last one, the running question lives in
    memory (a restart ends it). 79 commands.
- **2026-10-26 ~12:00, finished ~14:30** (owner picked idea 14: Minecraft chat on Discord). One session wrote the
  code and tests and stopped before translating and committing; the next session (asked to "continue where the
  other session stopped") added the Polish text (`pl.minecraft-chat.json`), checked it and pushed it.
  Live after the owner restarts the bot. Details in "Minecraft whitelist map":
  - `/minecraft czat kanal:#... [wydarzenia]`: game chat comes to the channel as the player (name + head), Discord
    messages go to the game as "[Discord] Name: text" (blue/aqua, max 200 characters, attachments as
    "[załącznik]"). Joins, leaves, deaths, advancements, server on/off as short lines unless `wydarzenia:false`.
  - Panel API takes `chatChannelId` (null = off) and `chatEvents`, same rules as the command: a saved key, not
    the whitelist or console channel. The pikczu.pl/bot page has no card for it yet (site project).
  - Decisions of the first session: Manage Server (not Administrator) because the link cannot run commands;
    consecutive lines of one player go in one message (1 s window); a failed send to the game reacts ❌.
  - Not tested against the real MatHost server (no access); the websocket part is the one the console already
    uses there. Each Discord message is one panel API call (Pterodactyl allows about 240 a minute).
  - 79 commands (a subcommand, no new top-level command).
- **2026-10-26 ~15:00** (owner picked from my list: "2,3,9 (dodaj przed rozpoczeciem napadu ze mozna kogos zaprosic),
  15,16 - dodaj tez zeby o tych grach bylo wiadomo w tej wiadomosci info o ekonomii"). Live after the owner restarts the bot:
  - 2: `/minecraft serwer`: private status (state, CPU, RAM, disk, uptime, backups) with Start / Restart / Stop (Stop and
    Restart ask a second time) and "Kopia teraz". Administrator only, like the console.
  - 3: `/minecraft kopie co_ile:` automatic backups every 1-168 h (first one after a full period). My decision: when the
    plan's backup slots are full, the oldest unlocked automatic backup is deleted (what Pterodactyl's own schedules do);
    hand-made and locked backups are never deleted, a backup by hand on a full plan is refused with an explanation.
    A failed automatic backup is retried after 30 min and shown in `/minecraft serwer`.
  - 9: `/napad cel:sklep|kantor|bank [tylko_zaproszeni]`: lobby with Join / Invite / Start / Leave; the leader invites up
    to 4 people at a time from a private picker, they are pinged in the channel under the lobby. My numbers: crew 1+/2+/3+,
    chance 55/45/35% +8 per extra member (max 85%), loot per person 2-4k / 5-9k / 12-22k (x Street smarts, server
    multiplier, Fortune), gear 500 / 1,500 / 4,000 each paid at the start, caught = gear lost + `/crime` jail time for
    everyone (bail works), break 180 min (Stamina). Lobby 5 min in memory. New missions: daily "take part in a heist",
    weekly "2-3 successful heists". 80 commands.
  - 15: panel API for games: `commands.heist`, `missions` { enabled, rewardPercent 0-1000 }, `quiz` { channelId, auto,
    everyMinutes, reward } (quiz store, validated before anything is saved). `commands.wordle` was already there.
  - 16: `chatRecent` for the panel's chat preview (both directions, events when `chatEvents` is on, memory only).
  - Guide: new topics "🎮 Gry i napady" and "🎯 Misje i odznaki", games in "Wszystkie komendy" and on the channel message;
    the posted message in #ekonomia-info is edited at the next start (`GUIDE_VERSION` 2), no repost needed.
  - Not tested against the real MatHost server (power and backups use the documented Pterodactyl client API).
- **2026-10-26 evening** (owner: "jak mam wlaczone powiadomienia discordowe o boostach to bot tam pisze o levelach
  napraw to"). Live after the owner restarts the bot; panel text deployed with the next site deploy:
  - Cause: with no level-up channel chosen, `sendLevelUpAnnouncement` (`services/leveling/xpSystem.js`) used
    `guild.systemChannel`, the channel where Discord posts boosts and joins.
  - Now: the chosen channel, otherwise the channel where the member wrote; never the system channel. A level
    from voice XP has no channel, so without a chosen channel it is not announced (my decision).
  - Panel API returns `levelUpChannel: 'same'` when none is chosen; the panel lost its "Kanał systemowy serwera"
    option (pikczu `tools/serwer/bot.html`).
  - `/profil [osoba]` (owner picked idea 11): `src/services/profileCard.js` draws a 1000x420 PNG with
    `@napi-rs/canvas` 1.0.11 (new dependency, prebuilt binaries; the host must run `npm install`, which a
    Pterodactyl Node server does at start) and Inter from `assets/fonts` (SIL OFL, `OFL.txt`; the container has no
    fonts). Avatar, level + XP bar, cash, bank, cards x/21, fish x/20, the 6 newest badges, spouse. No emoji on
    the picture (the font has none). Buttons `profil:odznaki|misje:<userId>` open the lists privately. When the
    canvas module does not load, the command answers with an embed. Command in `commands/Leveling` (no economy
    channel rules). 81 commands.
  - Panel API for five more modules (owner: "5 zrob" on my list; the site cards are in pikczu `bot.html`), all in
    `src/api/panelApi.js`, also in `modules` of `GET /guilds/:guildId`:
    `birthdays` (PATCH `channelId`, `roleId`, `remove: userId`; list read-only), `giveaways` (PATCH
    `start: { channelId, prize, minutes, winners, pingRoleId? }`, `end: messageId` = due now, the giveaway job ends
    it within a minute), `counting` (PATCH `channelId` (null = off), `system`, `reset: startNumber`; top 10),
    `serverstats` (PATCH `add: { type, categoryId, voice, name? }` creates the channel, `rename: { id, name }`,
    `remove: id` (+ `deleteChannel: true`)), `modmail` (PATCH `enabled, categoryId, staffRoleId, logChannelId,
    greeting, anonymous`; on needs a category). Tests: `test/panel-modules.test.js`.
  - Economy events in the panel (Ekonomia > Gry > "Eventy"; before only `/economy event`): `economyView` adds
    `eventTypes` and limits `eventEveryHours`, `eventMinutes`; `PATCH /economy` takes `events: { channelId, roleId,
    auto, everyHours, durationMinutes }` (saved with the rest; turning `auto` on plans the first one) and the actions
    `eventStart: { type, minutes }` / `eventStop: true` (run after the save; they post or delete the announcement).
- **2026-10-26 evening, second list** (owner: "1. +20", "2. koniecznie - zresetuj wszystkie warny, i ogarnij pokolei co
  robi ile warnow", "3. rob", "4. klasa", "8 fajne"). Live after the owner restarts the bot:
  - Casino luck cap 25 -> **20** (`MAX_LUCK`). Best permanent luck is now 15 + 5 = 20, so luck consumables add nothing
    at the cap. The "szczescie" event still goes 5 above it. Break-even at 50% / x1.7 is +9, so max luck still profits.
  - Warning punishments: `src/services/moderation/warningPunishments.js`. Every warning (`/warn` and automod rules with
    the "warn" action) goes through `warnMember`: stored, warnings of the last `expireDays` (30) counted, the step for
    that count runs, the member gets a DM (reason, count, punishment, next step). My ladder: 1 only a warning, 2 timeout
    10 min, 3 1 h, 4 6 h, 5 1 day, 6 3 days, 7 kick, 8 ban 7 days, 9+ ban 30 days (bans lift through `scheduleUnban`).
    No automatic permanent ban (moderators decide). A longer timeout already running is not shortened. Settings
    `guild:{id}:warning-punishments` (enabled, expireDays, steps), panel module "Ostrzeżenia" (`warnings` in the
    overview, `PATCH /warnings`, `POST /warnings/reset`).
  - Every warning on every server is deleted once at the next start (`resetAllWarningsOnce` in `initFeatures`, marker
    `bot:warnings-reset:2026-10-26`; owner's request).
  - `/loteria kup|info|ustaw` (owner: "3. rob"): `src/services/lottery.js`, job `lottery` every minute. Tickets all week
    (cash then bank), draw on Sunday 20:00 Polish time (`nextDrawTime`), one ticket wins the whole pot = tickets sold +
    `bonus` (server multiplier). Store `guild:{id}:lottery` (channelId, ticketPrice 500, maxTickets 50, bonus 2,000,
    round, last). Result on the lottery channel (or where the last ticket was bought) + DM. My numbers and rules.
  - `/pojedynek osoba kwota` (owner: "4. klasa"): rock, paper, scissors for money, `modules/duel.js`, buttons
    `pojedynek:ok|nie|pick:<id>[:r|p|s]`. Picks are private until both chose; a tie replays (3 ties = nobody pays);
    60 s to pick (the one who picked wins). No money is held during the duel: the loser pays at the end (cash then
    bank, at most what they have). Blocked in jail, min stake 50, max = the casino's highest bet. 83 commands.
  - `/daily` streak (owner: "8 fajne"): `src/services/dailyStreak.js`. `dailyStreak` +1 when claimed within the break
    plus one day, else 1; every 7th day a chest: 3x the daily amount + Starter pack 50% / Collector 25% / 2 Lucky
    Clovers 15% / Legend pack 10% (my odds). Shown under /daily.
  - New missions (daily: win a duel; weekly: lottery tickets, duels) and badges (lottery win, 10 duels, /daily 30 days
    in a row). Guide: duels, lottery, chest (`GUIDE_VERSION` 3, the posted guide refreshes at start).
  - Panel: module "Ostrzeżenia" (ladder, days, who has warnings, "Wyzeruj wszystkie" = `POST /warnings/reset`, site
    operation `warny-reset`) and the lottery card in Ekonomia > Gry (`lottery` in the economy view and PATCH).
  - Picture channels (owner, mid-task: "na fanarty jak sie wrzuci zdjecie to sa emotki serdusza a wiadomosci usuwaja
    sie automatycznie"): `src/services/mediaChannels.js`, `handleMediaMessage` in `featureMessages.js` (after automod and
    the Minecraft channels), `/channel zdjecia [kanal] [emotki] [usuwaj] [watki] [wylacz]` (Manage Channels), panel module
    "Kanały na zdjęcia" (`mediachannels`, PATCH takes the whole list). A message with a picture or video (file or link)
    gets the reactions (❤️ by default, up to 5, custom emoji allowed); any other message is deleted with a notice that
    disappears after 6 s; members with Manage Messages may write. My reading of "wiadomości usuwają się": text
    without a picture is removed, pictures stay. Optional thread for comments under every picture (off by default).
    The owner still has to pick the fan art channel (command or panel).
- **2026-10-26 night** (owner picked from my chat ideas "1,2,3,5 - zrob i ja chce zeby deadchat byl po 30 minutach bez
  gadania"). Live after the owner restarts the bot; panel module "Aktywność czatu" deployed:
  - `src/services/chatEngagement.js` (texts in `src/config/chatPrompts.js`), job `chat_engagement` every minute,
    `handleChatMessage` in `featureMessages.js`. One chat channel (`channelId`, picked in the panel) for all of it.
  - Drops: when someone wrote in the last 5 min, at least 15 messages since the last drop and 20-60 min passed: "the
    first to type <word> gets $500" (server multiplier, Fortune); 60 s, the message is edited with the winner.
  - Dead Chat: 30 min without a member message (owner) between 9:00 and 23:00 (my hours): ping of the Dead Chat role
    (picked, or the role named like "Dead Chat") with a topic; once until someone writes, at least 60 min apart.
    After a restart the quiet time counts from the start.
  - Question of the day at 18:00 with a thread "Odpowiedzi"; at the next question the answer with the most reactions
    wins 2,000. Happy hour 20:00-21:00: messages give x2 XP (`happyHourState.js`, read in `applyXpMultipliers`, not
    voice XP), announcement deleted at the end. Panel API `chat` (PATCH parts + `dropNow`, `questionNow`).
  - New daily mission "catch a chat drop", badge "Gwiazda czatu" (5 best answers). My numbers everywhere above.
- **2026-10-26 night, later** (owner: "chujowe z pytaniem dnia ze emotki, to ma byc odpowiedz i kto szybciej odpowie w
  odpowiedzi do wiadomosci czy cos to wygrywa, jedna odpowiedz"). Live after the owner restarts the bot:
  - Question of the day reworked: 68 short questions with accepted answers (`DAILY_TRIVIA` in `src/config/chatPrompts.js`,
    answers compared by `foldAnswer`: no case, Polish letters or punctuation). Members answer by **replying** to the bot's
    message; one answer per person (❌ wrong, ⛔ a second try); the first right one wins `question.reward`, the message is
    edited with the winner. No right answer within `question.minutes` (default 120, my number): the answer is shown.
    No more thread and no reactions vote. Panel field "Czas na odpowiedź".
- **2026-10-27** (owner sent a screenshot of a crash: `TypeError: Cannot read properties of undefined (reading 'a')`
  at `closeQuestion`, from `postQuestion` / `applyChat`). Live after the owner restarts the bot:
  - Cause: the live store still held a question saved by 4092fcc (thread + reactions), which has no `index`;
    `closeQuestion` read `DAILY_TRIVIA[undefined].a` while editing the old message.
  - `knownQuestion` in `chatEngagement.js`: a question without a valid `index` is only marked closed (nothing to
    reveal, its message is left as it is) and replies to it are ignored; the next question is posted normally.
  - Test "a question saved by the old version (no index) ..." in `test/chat-engagement.test.js` (fails without the fix).
- **2026-10-27 evening** (owner picked from my idea list: "8,9(nazwij kluby),10,11(ale wole zebys zrobil to jako trade zwykle)").
  Live after the owner restarts the bot; panel cards deployed with the site. Details in "Economy map". 86 commands:
  - 8 `/gielda ceny|kup|sprzedaj|portfel`: six made-up companies (Kebab u Stefana, Creeper Corp, Club'o'mony, Pikczu Media,
    Diamentowa Kopalnia, Ender Energia; names, base prices and moves are mine), prices every hour with a 24 h sparkline and news,
    buy by count or by budget (`za_kwote`), 1% fee each way, at most 10,000 shares of one company per member.
  - 9 `/klub zaloz|info|zapros|wplac|wyplac|ulepsz|ranking|wyrzuc|oddaj|wyjdz` (owner: call them clubs, not gangs). Founding 25,000,
    5 members (+3 per Clubhouse level, max 20), any member invites (24 h), the owner pays out, upgrades and kicks; upgrades from the
    treasury: Clubhouse, Club bonus (+2% job pay per level, max +10%), Heist crew (+4% /napad chance with 2+ members, max +12%).
    Weekly ranking = job money since Monday; prizes 25,000 / 10,000 / 5,000 to the treasury (x server multiplier). The owner who
    leaves hands the club to the earliest member; the last member closes it and gets the treasury. All numbers mine.
  - 10 `/nieruchomosci lista|kup|odbierz|ulepsz|sprzedaj`: Tent 5,000 (250 a day) ... Castle 1,000,000 (36,000 a day), each owned
    once, pays back in about 20-28 days; rent waits at most 48 h; upgrades 50/75/100% of the price for +30% each; sale 60%.
  - 11 (owner: card auctions, but "as a normal trade"): `/wymiana` without `osoba` is an open offer for everyone in the channel
    for 60 min; the first member who has the wanted part gets it (sell a card for money, buy one, swap). The wanted card can be
    any card (`catalogChoices`). A taker without the part gets a private note and the offer stays open. No Decline button there.
  - Missions: daily "trade on /gielda", "collect rent"; weekly club deposit, stock profit, rent. Badges: Club member, Market shark
    (50,000 stock profit), Landlord (3 buildings), Lord of the castle. Guide topic "📈 Giełda, kluby, budynki" (`GUIDE_VERSION` 4).
  - Panel API: `commands.stocks|clubs|property` through `COMMAND_LIMITS` (no new endpoint); site cards in Ekonomia > Gry.
- **2026-10-27, later** (owner: "dodaj wiecej ogolnych pytan i ogloszenia ze dostepne jest wordle i daily questy, wiecej ogolnych
  wordle i ogolnych pytan"; they first said the Dead Chat pings do not work, then "jednak pomin to o deadchat" - not looked into).
  Live after the owner restarts the bot; panel card deployed:
  - Daily announcement: new part `announce` { enabled, hour 10, channelId } of `chatEngagement.js` (`postAnnouncement`,
    `announcementEmbed`, `tickAnnounce`): "new Wordle #N, up to <reward>", new daily missions (Monday: daily and weekly, title
    "new week"), `/daily`, the question-of-the-day hour, on Sunday the lottery draw. Posted on `announce.channelId` or the chat
    channel; yesterday's announcement is deleted. State `announce: { day, messageId, channelId }`. Panel: card "Ogłoszenie dnia"
    in Aktywność czatu (`announce` in PATCH, `announceNow`). On by default (owner asked for it), 10:00 is my pick.
  - Question of the day: 95 more general questions (`DAILY_TRIVIA` 68 -> 163). Quiz: 67 more general questions (123 -> 190).
  - Wordle: 161 more everyday words (243 -> 404), appended. `LIST_SIZES` in `services/wordle.js` keeps days before 2026-10-28 on the
    first 243 words, so today's word does not change when the bot restarts mid-day. New words only at the end + a new LIST_SIZES line.
