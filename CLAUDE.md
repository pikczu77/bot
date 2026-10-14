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
- Jail: `src/services/economyJail.js` (`assertNotJailed`).
- Jobs of `/work`: `src/services/economyJobs.js`, `src/commands/Economy/modules/work_shift.js`.
- Shop items and tiers: `src/config/shop/items.js`.
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
  +1 point per level, 15 levels. All luck sources together give at most +25.
  Bets that pay more than x2 get fewer points, `(2 / payout)^2` of them; the owner wanted big
  payouts (roulette number x36) to get "an even smaller chance".
- Fortune: 5 levels, +10% of every payout per level (max +50%), expensive (25,000 doubling to
  400,000). It multiplies work, mine, fish, crime, slut, beg, `/daily`, chat money and level-up money.
- Stamina: 10 levels, -5% per level (max -50%). It shortens the breaks of every earning command
  and the casino. Not `/daily`, not jail.
- Jail (after a failed `/crime`) blocks `/work`, `/mine`, `/fish`, `/beg`, `/crime`, `/slut`,
  `/rob` and the casino. `/daily`, bank, `/pay`, shop and upgrades still work.

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
