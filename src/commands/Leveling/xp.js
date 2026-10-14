import { PermissionFlagsBits } from 'discord.js';
import { createCommandGroup } from '../../utils/commandGroup.js';
import leveladd from './modules/leveladd.js';
import levelremove from './modules/levelremove.js';
import levelset from './modules/levelset.js';

export default createCommandGroup({
    name: 'xp',
    description: 'Add, remove or set levels for a member',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    members: [
        { command: leveladd, as: 'dodaj' },
        { command: levelremove, as: 'usun' },
        { command: levelset, as: 'set' },
    ],
});
