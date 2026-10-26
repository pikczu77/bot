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
- Tests: `test/economy.test.js`, `test/economy-views.test.js`, `test/economy-rules.test.js`, `test/progress.test.js`.

## Economy rules the owner set (keep them)
- `/rob` takes 80% of the victim's cash and 50% of the bank. Each "Bank security" level takes
  10 points off the bank share, down to 10%.
- Luck adds percentage points to the win chance (40% with luck +3 is 43%). Luck upgrade:
  +1 point per level, 15 levels. All luck sources together give at most +25 (cap). Since
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
- Tests: `test/minecraft-whitelist.test.js` (fake panel and fake Mojang API through `globalThis.fetch`),
  `test/minecraft-panel.test.js` (panel API over HTTP, fake hosting panel), `test/minecraft-console.test.js`
  (fake websocket through `consoleSocket.create`).

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
