import { PermissionFlagsBits } from 'discord.js';
import { createCommandGroup } from '../../utils/commandGroup.js';
import gcreate from './modules/gcreate.js';
import gdelete from './modules/gdelete.js';
import greroll from './modules/greroll.js';
import glist from './modules/glist.js';

export default createCommandGroup({
    name: 'konkurs',
    description: 'Giveaways with entry requirements, bonus entries and rerolls',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    members: [
        { command: gcreate, as: 'utworz' },
        { command: gdelete, as: 'usun' },
        { command: greroll, as: 'losuj-ponownie' },
        { command: glist, as: 'list' },
    ],
});
