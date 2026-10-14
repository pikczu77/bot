import { PermissionFlagsBits } from 'discord.js';
import { createCommandGroup } from '../../utils/commandGroup.js';
import lock from './modules/lock.js';
import unlock from './modules/unlock.js';
import { slowmode, sticky, unsticky, nuke, lockdown } from './modules/channelTools.js';

export default createCommandGroup({
    name: 'channel',
    description: 'Channel moderation: lock, slowmode, sticky message, wipe, server lockdown',
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
    members: [
        { command: lock, as: 'zablokuj' },
        { command: unlock, as: 'odblokuj' },
        { command: slowmode, as: 'wolny-tryb' },
        { command: sticky, as: 'przypnij' },
        { command: unsticky, as: 'odepnij' },
        nuke,
        lockdown,
    ],
});
