import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithLocale } from '../src/i18n/index.js';
import { parseDuration, humanDuration } from '../src/utils/featureKit.js';
import { buildNotification, parseChannelPage, parseFeed, parseSubscriberText } from '../src/services/notifications/youtube.js';
import { checkMessage, findBannedWord } from '../src/services/automodService.js';
import { findUsedInvite, totalInvites } from '../src/services/inviteService.js';
import { matchResponder, normalizeTagName, renderTagText } from '../src/services/tagService.js';
import { diffPlayers, normalizeAddress } from '../src/services/minecraftService.js';
import { createCommandGroup } from '../src/utils/commandGroup.js';
import { buildGreetingMessage } from '../src/utils/welcome.js';

test('durations parse and print', () => {
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('1d12h'), 129_600_000);
  assert.equal(parseDuration(' 2H 30M '), 9_000_000);
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration('10'), null);
  assert.equal(parseDuration('0m'), null);
  assert.equal(humanDuration(5_400_000), '1h 30m');
  assert.equal(humanDuration(45_000), '45s');
});

test('YouTube feed and channel page parsing', () => {
  const xml = `<feed><entry><id>yt:video:abc123DEF45</id><yt:videoId>abc123DEF45</yt:videoId>
    <title>Tom &amp; Jerry &lt;3</title><author><name>Wisp</name></author>
    <published>2026-09-02T18:15:00+00:00</published></entry>
    <entry><yt:videoId>zzz999YYY88</yt:videoId><title>Older</title><published>2026-09-01T10:00:00+00:00</published></entry></feed>`;
  const videos = parseFeed(xml);
  assert.equal(videos.length, 2);
  assert.deepEqual(videos[0], {
    id: 'abc123DEF45',
    title: 'Tom & Jerry <3',
    url: 'https://www.youtube.com/watch?v=abc123DEF45',
    published: '2026-09-02T18:15:00+00:00',
    author: 'Wisp',
  });

  assert.equal(parseSubscriberText('5.86M subscribers'), 5_860_000);
  assert.equal(parseSubscriberText('273K subscribers'), 273_000);
  assert.equal(parseSubscriberText('1,234 subscribers'), 1234);
  assert.equal(parseSubscriberText(null), null);

  const page = parseChannelPage(
    '<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"><meta property="og:title" content="Wisp">'
    + '<meta property="og:image" content="https://yt3.example/avatar=s900"> "subscriberCountText":{"accessibility":{"label":"x"},"simpleText":"5.86M subscribers"}',
  );
  assert.deepEqual(page, { id: 'UCabcdefghijklmnopqrstuv', name: 'Wisp', avatar: 'https://yt3.example/avatar=s900', subscribers: 5_860_000 });
});

test('YouTube notification matches the requested layout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true }); // thumbnail probe
  try {
    const feed = { id: 'UCabcdefghijklmnopqrstuv', name: 'Wisp', avatar: 'https://yt3.example/a.jpg', roleId: '111111111111111111', message: null };
    const video = { id: 'abc123DEF45', title: 'Minecraft, But The World Is Underwater...', url: 'https://www.youtube.com/watch?v=abc123DEF45', published: '2026-09-02T18:15:00+00:00' };
    const payload = await runWithLocale('en', () => buildNotification(feed, video, { name: 'Wisp', avatar: feed.avatar, subscribers: 5_860_000 }));
    const embed = payload.embeds[0].toJSON();

    assert.equal(payload.content, '🔔 **Wisp** uploaded a new video! <@&111111111111111111> <https://www.youtube.com/watch?v=abc123DEF45>');
    assert.deepEqual(payload.allowedMentions, { roles: ['111111111111111111'], parse: [] });
    assert.equal(embed.color, 0xff0000);
    assert.equal(embed.author.name, 'Wisp');
    assert.equal(embed.author.icon_url, feed.avatar);
    assert.equal(embed.title, video.title);
    assert.equal(embed.url, video.url);
    assert.deepEqual(embed.fields, [{ name: 'Subscribers', value: '5,860,000' }]);
    assert.equal(embed.thumbnail.url, feed.avatar);
    assert.equal(embed.image.url, 'https://i.ytimg.com/vi/abc123DEF45/maxresdefault.jpg');
    assert.equal(embed.footer.text, 'Published');
    assert.equal(embed.timestamp, '2026-09-02T18:15:00.000Z');

    const polish = await runWithLocale('pl', () => buildNotification({ ...feed, roleId: null }, video, { name: 'Wisp', subscribers: 5_860_000 }));
    assert.equal(polish.content, '🔔 **Wisp** wrzuca nowy film! <https://www.youtube.com/watch?v=abc123DEF45>');
    assert.equal(polish.embeds[0].toJSON().footer.text, 'Opublikowano');
    assert.equal(polish.embeds[0].toJSON().fields[0].name, 'Subskrypcje');

    const custom = await runWithLocale('pl', () => buildNotification({ ...feed, message: 'Nowy film od {channel}: {title} {url}' }, video, {}));
    assert.equal(custom.content, 'Nowy film od Wisp: Minecraft, But The World Is Underwater... <https://www.youtube.com/watch?v=abc123DEF45>');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('welcome and goodbye messages follow the layout the server picked', () => {
  const guild = { id: '1', name: 'Klubik', memberCount: 321 };
  const user = { id: '42', tag: 'dav', username: 'dav', displayAvatarURL: () => 'https://cdn.example/dav.png', toString: () => '<@42>' };
  const context = { user, guild, member: { user }, invite: { inviter: { toString: () => '<@7>' }, stats: { total: 1 } } };
  const config = { welcomeMessage: 'Cześć, {user}! Zajrzyj na <#5> @everyone', welcomePing: true, leaveMessage: '{username} wyszedł z {server}.' };

  runWithLocale('pl', () => {
    // Untouched settings keep the embed with every extra, as before the layout choice existed.
    const classic = buildGreetingMessage('welcome', config, context);
    const embed = classic.embeds[0].toJSON();
    assert.equal(classic.content, '<@42>');
    assert.deepEqual(classic.allowedMentions, { parse: [], users: ['42'] });
    assert.equal(embed.title, '🎉 Witamy!');
    assert.equal(embed.description, 'Cześć, <@42>! Zajrzyj na <#5> @everyone');
    assert.equal(embed.color, 0x30d158);
    assert.deepEqual(embed.fields.map((field) => field.name), ['Użytkownik', 'Liczba członków', 'Zaprosił(a)']);
    assert.equal(embed.footer.text, 'Witaj na Klubik!');
    assert.equal(embed.thumbnail.url, 'https://cdn.example/dav.png');
    assert.ok(embed.timestamp);

    // Plain text: the message itself is the content, and only the new member can be notified.
    const text = buildGreetingMessage('welcome', { ...config, welcomeStyle: 'text' }, context);
    assert.deepEqual(text, { content: 'Cześć, <@42>! Zajrzyj na <#5> @everyone', allowedMentions: { parse: [], users: ['42'] } });
    assert.deepEqual(buildGreetingMessage('welcome', { ...config, welcomeStyle: 'text', welcomePing: false }, context).allowedMentions, { parse: [], users: [] });

    const withImage = buildGreetingMessage('welcome', { ...config, welcomeStyle: 'text', welcomeImage: 'https://cdn.example/banner.png' }, context);
    assert.deepEqual(withImage.embeds.map((entry) => entry.toJSON()), [{ image: { url: 'https://cdn.example/banner.png' } }]);

    // A bare embed: own colour, no title, none of the extras.
    const bare = buildGreetingMessage('welcome', { ...config, welcomeExtras: false, welcomePing: false, welcomeEmbed: { title: '', color: 0xff9f0a } }, context);
    assert.deepEqual(bare.embeds[0].toJSON(), { color: 0xff9f0a, description: 'Cześć, <@42>! Zajrzyj na <#5> @everyone' });
    assert.equal(bare.content, undefined);
    assert.equal(buildGreetingMessage('welcome', { ...config, welcomeEmbed: { title: 'Hej {username}' } }, context).embeds[0].toJSON().title, 'Hej dav');

    // Without the Embed Links permission the embed layout is sent as text instead of being lost.
    const noEmbeds = buildGreetingMessage('welcome', { ...config, welcomeImage: 'https://cdn.example/banner.png' }, { ...context, canEmbed: false });
    assert.deepEqual(noEmbeds, { content: 'Cześć, <@42>! Zajrzyj na <#5> @everyone', allowedMentions: { parse: [], users: ['42'] } });

    const goodbye = buildGreetingMessage('goodbye', config, context);
    assert.equal(goodbye.embeds[0].toJSON().title, '👋 Do zobaczenia');
    assert.equal(goodbye.embeds[0].toJSON().footer.text, 'Żegnamy na Klubik!');
    assert.equal(goodbye.embeds[0].toJSON().fields.length, 2);
    assert.deepEqual(buildGreetingMessage('goodbye', { ...config, goodbyeStyle: 'text' }, context), { content: 'dav wyszedł z Klubik.', allowedMentions: { parse: [], users: [] } });
  });
});

function automodConfig(overrides) {
  const rules = {
    invites: { enabled: false, action: 'delete' },
    links: { enabled: false, action: 'delete', allow: [] },
    words: { enabled: false, action: 'delete', list: [] },
    spam: { enabled: false, action: 'timeout', limit: 4, seconds: 5 },
    mentions: { enabled: false, action: 'timeout', limit: 5 },
    caps: { enabled: false, action: 'delete', percent: 75, minLength: 12 },
    duplicates: { enabled: false, action: 'delete', limit: 3 },
    emojis: { enabled: false, action: 'delete', limit: 6 },
  };
  for (const [rule, settings] of Object.entries(overrides)) rules[rule] = { ...rules[rule], enabled: true, ...settings };
  return { rules };
}

const say = (content, mentionCount = 0) => ({ content, mentionCount });

test('automod rules catch what they should and nothing else', () => {
  const invites = automodConfig({ invites: {} });
  assert.equal(checkMessage(invites, say('join discord.gg/abcDEF'), null)?.rule, 'invites');
  assert.equal(checkMessage(invites, say('https://discord.com/invite/xyz12'), null)?.rule, 'invites');
  assert.equal(checkMessage(invites, say('discord is great'), null), null);

  const links = automodConfig({ links: { allow: ['youtube.com', 'pikczu.pl'] } });
  assert.equal(checkMessage(links, say('see https://evil.example/x'), null)?.detail, 'evil.example');
  assert.equal(checkMessage(links, say('see https://www.youtube.com/watch?v=1'), null), null);
  assert.equal(checkMessage(links, say('see https://m.youtube.com/watch?v=1'), null), null);
  assert.equal(checkMessage(links, say('see https://notyoutube.com/'), null)?.rule, 'links');
  assert.equal(checkMessage(links, say('no link here'), null), null);

  const words = automodConfig({ words: { list: ['kurde', 'spam*'] } });
  assert.equal(checkMessage(words, say('no KURDE no'), null)?.detail, 'kurde');
  assert.equal(checkMessage(words, say('to jest spamerskie'), null)?.detail, 'spam*');
  assert.equal(checkMessage(words, say('okurdebalans'), null), null);
  assert.equal(findBannedWord('zażółć gęślą', ['zazolc']), 'zazolc');

  const mentions = automodConfig({ mentions: {} });
  assert.equal(checkMessage(mentions, say('hey', 5), null)?.rule, 'mentions');
  assert.equal(checkMessage(mentions, say('hey', 4), null), null);

  const caps = automodConfig({ caps: {} });
  assert.equal(checkMessage(caps, say('CO TY ROBISZ CZŁOWIEKU'), null)?.rule, 'caps');
  assert.equal(checkMessage(caps, say('OK'), null), null);
  assert.equal(checkMessage(caps, say('Normalne zdanie z jedną wielką literą'), null), null);

  const emojis = automodConfig({ emojis: {} });
  assert.equal(checkMessage(emojis, say('😀😀😀😀😀😀'), null)?.rule, 'emojis');
  assert.equal(checkMessage(emojis, say('😀 hi'), null), null);
});

test('automod spam and duplicate detection use recent history', () => {
  const spam = automodConfig({ spam: { limit: 4, seconds: 5 } });
  const history = { timestamps: [], recent: [] };
  const start = 1_000_000;
  assert.equal(checkMessage(spam, say('a'), history, start), null);
  assert.equal(checkMessage(spam, say('b'), history, start + 500), null);
  assert.equal(checkMessage(spam, say('c'), history, start + 1000), null);
  assert.equal(checkMessage(spam, say('d'), history, start + 1500)?.rule, 'spam');
  // Slow chatting is fine.
  const calm = { timestamps: [], recent: [] };
  for (let i = 0; i < 10; i += 1) assert.equal(checkMessage(spam, say(`m${i}`), calm, start + i * 3000), null);

  const duplicates = automodConfig({ duplicates: { limit: 3 } });
  const repeat = { timestamps: [], recent: [] };
  assert.equal(checkMessage(duplicates, say('kup teraz'), repeat, start), null);
  assert.equal(checkMessage(duplicates, say('Kup Teraz'), repeat, start + 2000), null);
  assert.equal(checkMessage(duplicates, say('kup teraz'), repeat, start + 4000)?.rule, 'duplicates');
});

test('invite detection compares use counts', () => {
  const before = new Map([
    ['aaa', { uses: 3, inviterId: '1', maxUses: 0 }],
    ['bbb', { uses: 0, inviterId: '2', maxUses: 1 }],
  ]);
  assert.deepEqual(findUsedInvite(before, new Map([['aaa', { uses: 4, inviterId: '1', maxUses: 0 }], ['bbb', { uses: 0, inviterId: '2', maxUses: 1 }]])), { code: 'aaa', inviterId: '1' });
  // A one-use invite vanishes when it is used.
  assert.deepEqual(findUsedInvite(before, new Map([['aaa', { uses: 3, inviterId: '1', maxUses: 0 }]])), { code: 'bbb', inviterId: '2' });
  // A brand-new invite that was used before we ever saw it.
  assert.deepEqual(findUsedInvite(before, new Map([...before, ['ccc', { uses: 1, inviterId: '3', maxUses: 0 }]])), { code: 'ccc', inviterId: '3' });
  assert.equal(findUsedInvite(before, new Map(before)), null);
  assert.equal(totalInvites({ regular: 4, bonus: 2, left: 3, fake: 1 }), 6);
  assert.equal(totalInvites({ regular: 0, bonus: -5 }), 0);
});

test('tags and auto-responders', () => {
  const responders = [
    { trigger: 'ip', mode: 'word', response: 'A' },
    { trigger: 'jak dołączyć', mode: 'contains', response: 'B' },
    { trigger: '!regulamin', mode: 'exact', response: 'C' },
  ];
  assert.equal(matchResponder(responders, 'jakie jest IP serwera?')?.response, 'A');
  assert.equal(matchResponder(responders, 'tulipan'), null);
  assert.equal(matchResponder(responders, 'ej, JAK DOŁĄCZYĆ do gry')?.response, 'B');
  assert.equal(matchResponder(responders, '!regulamin')?.response, 'C');
  assert.equal(matchResponder(responders, '!regulamin please'), null);
  assert.equal(normalizeTagName(' Zasady_1 '), 'zasady_1');
  assert.throws(() => normalizeTagName('dwa słowa'));
  assert.equal(
    renderTagText('Hej {user} na {server} ({members})', { author: { toString: () => '<@1>' }, guild: { name: 'Klubik', memberCount: 321 } }),
    'Hej <@1> na Klubik (321)',
  );
});

test('minecraft helpers', () => {
  assert.deepEqual(diffPlayers(['Ala', 'Olek'], ['Olek', 'Zenek']), { joined: ['Zenek'], left: ['Ala'] });
  assert.equal(normalizeAddress(' Play.Example.com:25565 '), 'play.example.com:25565');
  assert.equal(normalizeAddress('https://mc.example.org/'), 'mc.example.org');
  assert.throws(() => normalizeAddress('not an address!'));
});

test('command groups route to members and keep their rules', async () => {
  const calls = [];
  const builder = (name, options = [], permissions = null) => ({
    name,
    toJSON: () => ({ name, description: `${name} description`, options, ...(permissions ? { default_member_permissions: permissions } : {}) }),
  });
  const plain = { data: builder('plain', [{ type: 3, name: 'text', description: 'x' }]), execute: async () => calls.push('plain') };
  const nested = { data: builder('nested', [{ type: 1, name: 'one', description: 'x', options: [] }]), execute: async () => calls.push('nested') };
  const admin = { data: builder('admin', [], '8'), execute: async () => calls.push('admin') };

  const group = createCommandGroup({ name: 'kit', description: 'Kit', members: [plain, { command: nested, as: 'deep' }, admin] });
  const json = group.data.toJSON();
  assert.deepEqual(json.options.map((option) => [option.name, option.type]), [['plain', 1], ['deep', 2], ['admin', 1]]);

  const interaction = (subcommand, groupName = null, isAdmin = false) => ({
    user: { id: '5' },
    guildId: '9',
    member: { id: '5', guild: { ownerId: '1' }, permissions: { has: () => isAdmin }, roles: { cache: new Map() } },
    options: { getSubcommand: () => subcommand, getSubcommandGroup: () => groupName },
    reply: async () => {},
    editReply: async () => {},
    followUp: async () => {},
    id: 'i1',
    createdTimestamp: Date.now(),
  });

  await group.execute(interaction('plain'), {}, {});
  await group.execute(interaction('one', 'deep'), {}, {});
  assert.deepEqual(calls, ['plain', 'nested']);

  // A member without the permission is stopped even though Discord let the group through.
  await group.execute(interaction('admin'), {}, {});
  assert.deepEqual(calls, ['plain', 'nested']);
  await group.execute(interaction('admin', null, true), {}, {});
  assert.deepEqual(calls, ['plain', 'nested', 'admin']);
});
