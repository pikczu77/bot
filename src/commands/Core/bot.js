import { createCommandGroup } from '../../utils/commandGroup.js';
import stats from './modules/stats.js';

export default createCommandGroup({
    name: 'bot',
    description: 'Bot statistics',
    members: [
        stats,
    ],
});
