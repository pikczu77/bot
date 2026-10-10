import { PermissionFlagsBits } from 'discord.js';
import { createCommandGroup } from '../../utils/commandGroup.js';
import gcreate from './modules/gcreate.js';
import gend from './modules/gend.js';
import gdelete from './modules/gdelete.js';
import greroll from './modules/greroll.js';
import glist from './modules/glist.js';

export default createCommandGroup({
    name: 'giveaway',
    description: 'Giveaways with entry requirements, bonus entries and rerolls',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    members: [
        { command: gcreate, as: 'create' },
        { command: gend, as: 'end' },
        { command: gdelete, as: 'delete' },
        { command: greroll, as: 'reroll' },
        { command: glist, as: 'list' },
    ],
});
