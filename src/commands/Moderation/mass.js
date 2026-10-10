import { PermissionFlagsBits } from 'discord.js';
import { createCommandGroup } from '../../utils/commandGroup.js';
import massban from './modules/massban.js';
import masskick from './modules/masskick.js';

export default createCommandGroup({
    name: 'mass',
    description: 'Bulk moderation: ban or kick many members at once',
    defaultMemberPermissions: PermissionFlagsBits.KickMembers,
    members: [
        { command: massban, as: 'ban' },
        { command: masskick, as: 'kick' },
    ],
});
