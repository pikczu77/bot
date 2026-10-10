import { createCommandGroup } from '../../utils/commandGroup.js';
import deposit from './modules/deposit.js';
import withdraw from './modules/withdraw.js';

export default createCommandGroup({
    name: 'bank',
    description: 'Move money between your wallet and your bank',
    members: [
        deposit,
        withdraw,
    ],
});
