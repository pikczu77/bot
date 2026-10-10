import { createCommandGroup } from '../../utils/commandGroup.js';
import calculate from './modules/calculate.js';
import countdown from './modules/countdown.js';

export default createCommandGroup({
    name: 'tools',
    description: 'Handy utilities: calculator and countdown timer',
    members: [
        calculate,
        countdown,
    ],
});
