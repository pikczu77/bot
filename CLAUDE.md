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
- Tests: `test/economy.test.js`, `test/economy-views.test.js`, `test/economy-rules.test.js`.

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
  reads digits/symbols as letters (`findSlur`). Keep it that way.
- `rules.words.freeChannels`: channels where swearing is allowed (the owner's #wulgarny-chat).
- Night channel: `src/services/nightChannel.js`, settings `nightChannel` in the automod config,
  job `night_channel` every minute (`src/services/features.js`), also run after a panel save.
  Remembers who could see the channel before closing (store `night-channel`) and restores it.

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
