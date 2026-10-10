import { createCommandGroup } from '../../utils/commandGroup.js';
import userinfo from './modules/userinfo.js';
import serverinfo from './modules/serverinfo.js';
import avatar from './modules/avatar.js';

export default createCommandGroup({
    name: 'info',
    description: 'Information about a member or the server',
    members: [
        { command: userinfo, as: 'user' },
        { command: serverinfo, as: 'server' },
        avatar,
    ],
});
