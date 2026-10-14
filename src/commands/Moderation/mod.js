import { PermissionFlagsBits } from 'discord.js';
import { createCommandGroup } from '../../utils/commandGroup.js';
import { tempban, softban, nick, history } from './modules/modTools.js';

export default createCommandGroup({
    name: 'mod',
    description: 'More moderation tools: temporary ban, softban, nickname, member history',
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
    members: [
        tempban,
        softban,
        nick,
        { command: history, as: 'historia' },
    ],
});
