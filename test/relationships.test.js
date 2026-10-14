// /randka (dates) and /slub (marriage with a joint bank), run against in-memory storage.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let buttons;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  buttons = new Map((await import('../src/interactions/buttons/fun/relationships.js')).default.map((button) => [button.name, button]));
});

function setup(name) {
  const guild = mockGuild(client, name);
  const channel = mockChannel(guild, 'ogolny');
  const member = (nick) => mockMember(guild, mockUser(nick));
  const run = async (commandName, { member: who, locale = 'en', ...rest }) => {
    const interaction = mockInteraction({ client, guild, channel, member: who, commandName, ...rest });
    await runWithLocale(locale, () => client.commands.get(commandName).execute(interaction, {}, client));
    return interaction;
  };
  const press = async (who, customId, locale = 'en') => {
    const calls = { reply: [], update: [], followUp: [] };
    const interaction = {
      id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member: who, user: who.user, customId,
      reply: async (payload) => { calls.reply.push(payload); },
      update: async (payload) => { calls.update.push(payload); },
      followUp: async (payload) => { calls.followUp.push(payload); },
    };
    const [name, ...args] = customId.split(':');
    await runWithLocale(locale, () => buttons.get(name).execute(interaction, client, args));
    return calls;
  };
  return { guild, channel, member, run, press };
}

const text = (payload) => replyText({ replies: [payload] });
const buttonIds = (interaction) => interaction.replies.at(-1).components.flatMap((row) => row.toJSON().components.map((button) => button.custom_id));

test('joint bank: one bank with two accounts, money in fills the own account, money out takes own first', async () => {
  const { getEconomyData, setEconomyData, getMaxBankCapacity, ownBank } = await import('../src/utils/economy.js');
  const { marry, divorce } = await import('../src/services/marriageService.js');
  const { guild, member } = setup('Bank');
  const first = member('Ania');
  const second = member('Bartek');
  const read = (who, options) => getEconomyData(client, guild.id, who.id, options);
  const own = async (who) => (await read(who, { joint: false })).bank;

  await setEconomyData(client, guild.id, first.id, { ...(await read(first)), bank: 6000 });
  await setEconomyData(client, guild.id, second.id, { ...(await read(second)), bank: 4000 });
  const single = getMaxBankCapacity(await read(first));
  assert.equal((await marry(guild.id, first.id, second.id)).ok, true);

  const joint = await read(first);
  assert.equal(joint.bank, 10_000);
  assert.equal(ownBank(joint), 6000);
  assert.deepEqual({ partnerId: joint._joint.partnerId, partnerBank: joint._joint.partnerBank }, { partnerId: second.id, partnerBank: 4000 });
  assert.equal(getMaxBankCapacity(joint), single * 2);
  assert.equal((await read(second)).bank, 10_000);

  // Taking 8000: the own 6000 first, then 2000 of the spouse's account.
  joint.bank -= 8000;
  joint.wallet += 8000;
  await setEconomyData(client, guild.id, first.id, joint);
  assert.deepEqual([await own(first), await own(second)], [0, 2000]);
  // Saving the same object again does not take the money twice.
  await setEconomyData(client, guild.id, first.id, joint);
  assert.deepEqual([await own(first), await own(second)], [0, 2000]);

  // Paying in fills the own account up to its capacity, the rest goes to the spouse's.
  const deposit = await read(first);
  deposit.bank += single + 500;
  await setEconomyData(client, guild.id, first.id, { ...deposit });
  assert.deepEqual([await own(first), await own(second)], [single, 2500]);

  // A divorce leaves both accounts as they are.
  assert.equal((await divorce(guild.id, second.id)).ok, true);
  const after = await read(first);
  assert.equal(after.bank, single);
  assert.equal(after._joint, undefined);
  assert.equal((await read(second)).bank, 2500);
});

test('/slub: proposal buttons, joint bank in /slub info, /rob hits the whole joint bank, divorce', async () => {
  const { updateEconomySettings } = await import('../src/services/economySettings.js');
  const { getEconomyData, setEconomyData } = await import('../src/utils/economy.js');
  const { getSpouseId } = await import('../src/services/marriageService.js');
  const memberRemove = (await import('../src/events/guildMemberRemove.js')).default;
  const { guild, member, run, press } = setup('Wesele');
  const bride = member('Kasia');
  const groom = member('Tomek');
  const thief = member('Zlodziej');
  const own = async (who) => (await getEconomyData(client, guild.id, who.id, { joint: false })).bank;
  const save = async (who, patch) => setEconomyData(client, guild.id, who.id, { ...(await getEconomyData(client, guild.id, who.id, { joint: false })), ...patch });

  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: 'zł', position: 'right', separator: ' ' };
    settings.commands.rob = { ...settings.commands.rob, successPercent: 100, minVictimCash: 100 };
  });
  await save(bride, { wallet: 0, bank: 1000 });
  await save(groom, { wallet: 0, bank: 3000 });

  await assert.rejects(run('slub', { member: bride, subcommand: 'oswiadcz', options: { osoba: bride.user } }), /Proposal to self/);
  const proposal = await run('slub', { member: bride, subcommand: 'oswiadcz', options: { osoba: groom.user } });
  assert.match(replyText(proposal), /proposes to/);
  const [yes, no] = buttonIds(proposal);
  assert.match(yes, new RegExp(`^slub:tak:${bride.id}:${groom.id}:`));

  // Somebody else cannot answer; the proposer cannot say yes for the other person.
  assert.match(text((await press(thief, yes)).reply[0]), /not for you/);
  assert.match(text((await press(bride, yes)).reply[0]), /Only/);
  const accepted = await press(groom, yes);
  assert.match(text(accepted.update[0]), /are now married/);
  assert.match(text(accepted.update[0]), /4 000 zł/);
  assert.equal(await getSpouseId(guild.id, bride.id), groom.id);
  assert.equal(accepted.update[0].components.length, 0);
  assert.match(text((await press(groom, no)).update[0]), /turned down/); // an old message only closes

  await assert.rejects(run('slub', { member: bride, subcommand: 'oswiadcz', options: { osoba: thief.user } }), /Already married/);
  await assert.rejects(run('slub', { member: thief, subcommand: 'oswiadcz', options: { osoba: groom.user } }), /Target already married/);

  const info = replyText(await run('slub', { member: thief, subcommand: 'info', options: { osoba: groom.user } }));
  assert.match(info, /Joint bank/);
  assert.match(info, /4 000 zł/);
  assert.match(info, /1 000 zł/);
  assert.match(replyText(await run('slub', { member: bride, subcommand: 'info', locale: 'pl' })), /Wspólny bank/);

  // /rob takes 50% of the whole joint bank: the victim's own account first, then the spouse's.
  await save(thief, { wallet: 0, lastRob: 0 });
  await run('rob', { member: thief, options: { user: bride.user } });
  assert.deepEqual([await own(bride), await own(groom)], [0, 2000]);

  // Divorce: confirmation first, then the joint bank (2000) is split in half.
  await save(bride, { bank: 1 }); // odd total: the spouse who did not ask for the divorce gets the extra coin
  const confirm = await run('slub', { member: groom, subcommand: 'rozwod' });
  assert.match(replyText(confirm), /split in half/);
  assert.match(replyText(confirm), /2 001 zł/);
  const [divorceId, cancelId] = buttonIds(confirm);
  assert.match(text((await press(groom, cancelId)).update[0]), /No divorce/);
  assert.match(text((await press(bride, divorceId)).reply[0]), /not for you/);
  const divorced = await press(groom, divorceId);
  assert.match(text(divorced.update[0]), /divorced/);
  assert.match(text(divorced.followUp[0]), /split in half/);
  assert.equal(await getSpouseId(guild.id, bride.id), null);
  assert.deepEqual([await own(groom), await own(bride)], [1000, 1001]);
  assert.equal((await getEconomyData(client, guild.id, groom.id)).bank, 1000);
  await assert.rejects(run('slub', { member: groom, subcommand: 'rozwod' }), /Not married/);

  // Leaving the server ends a marriage.
  const thirdId = member('Ola');
  assert.match(text((await press(thirdId, buttonIds(await run('slub', { member: groom, subcommand: 'oswiadcz', options: { osoba: thirdId.user } }))[0])).update[0]), /married/);
  await memberRemove.execute({ guild, user: thirdId.user, client, id: thirdId.id, displayName: 'Ola' });
  assert.equal(await getSpouseId(guild.id, groom.id), null);
});

test('/randka: invitation, payment by the inviter, hearts, cooldown, married bonus', async () => {
  const { getEconomyData, setEconomyData } = await import('../src/utils/economy.js');
  const { DATE_COOLDOWN_MS, getPair, marry, rollDate, getDatePlace } = await import('../src/services/marriageService.js');
  const { settleDate } = await import('../src/commands/Fun/modules/relationships.js');
  const { guild, member, run, press } = setup('Randki');
  const romeo = member('Romeo');
  const julia = member('Julia');
  const other = member('Inny');
  const save = async (who, patch) => setEconomyData(client, guild.id, who.id, { ...(await getEconomyData(client, guild.id, who.id)), ...patch });

  assert.equal(rollDate({ shipScore: 100, place: getDatePlace('kolacja'), married: true, random: () => 0.99 }).tier.id, 'magic');
  assert.equal(rollDate({ shipScore: 0, place: getDatePlace('spacer'), random: () => 0 }).tier.id, 'disaster');
  assert.equal(rollDate({ shipScore: 0, place: getDatePlace('spacer'), random: () => 0 }).tier.hearts, 0);

  await assert.rejects(run('randka', { member: romeo, options: { osoba: romeo.user } }), /Date with self/);
  await save(romeo, { wallet: 100, bank: 0 });
  await assert.rejects(run('randka', { member: romeo, options: { osoba: julia.user, miejsce: 'kino' } }), /Cannot afford/);

  await save(romeo, { wallet: 400, bank: 400 });
  const invite = await run('randka', { member: romeo, options: { osoba: julia.user, miejsce: 'kino' } });
  assert.match(replyText(invite), /Cinema/);
  assert.equal(invite.replies.at(-1).content, `<@${julia.id}>`);
  const [yes, no] = buttonIds(invite);
  assert.match(yes, new RegExp(`^randka:tak:${romeo.id}:${julia.id}:kino:`));

  assert.match(text((await press(other, yes)).reply[0]), /not for you/);
  assert.match(text((await press(romeo, yes)).reply[0]), /Only/);
  const date = await press(julia, yes);
  assert.equal(date.update.length, 1);
  assert.match(text(date.update[0]), /Hearts/);
  assert.match(text(date.update[0]), /Dates together: 1/);
  const paid = await getEconomyData(client, guild.id, romeo.id);
  assert.deepEqual({ wallet: paid.wallet, bank: paid.bank }, { wallet: 0, bank: 200 }); // 600: cash first, then the bank
  assert.equal((await getPair(guild.id, julia.id, romeo.id)).dates, 1);

  // A second click on the same invitation and a new invitation both wait for the cooldown.
  assert.match(text((await press(julia, yes)).update[0]), /Next date in/);
  await assert.rejects(run('randka', { member: julia, options: { osoba: romeo.user } }), /Date cooldown/);
  assert.match(text((await press(julia, no)).update[0]), /says no/);

  // After the break; married couples get the bonus line.
  await marry(guild.id, romeo.id, julia.id);
  const later = await settleDate(client, guild.id, romeo.id, julia.id, getDatePlace('spacer'), { now: Date.now() + DATE_COOLDOWN_MS + 1000, random: () => 0.5 });
  assert.equal(later.ok, true);
  assert.equal(later.married, true);
  assert.equal(later.pair.dates, 2);

  const polish = await run('randka', { member: other, locale: 'pl', options: { osoba: julia.user, miejsce: 'spacer' } });
  assert.match(replyText(polish), /zaprasza/);
  assert.match(replyText(polish), /Spacer w parku/);
});
