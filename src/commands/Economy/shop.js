import { createCommandGroup } from '../../utils/commandGroup.js';
import shopBrowse from './modules/shop_main.js';
import buy from './modules/buy.js';
import inventory from './modules/inventory.js';
import shopConfig from './modules/shop_config.js';

export default createCommandGroup({
    name: 'sklep',
    description: 'Browse the shop, buy items and manage your inventory',
    members: [
        { command: shopBrowse, as: 'przegladaj' },
        buy,
        { command: inventory, as: 'ekwipunek' },
        { command: shopConfig, as: 'ustawienia' },
    ],
});
