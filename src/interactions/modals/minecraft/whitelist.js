import { WHITELIST_MODAL, submitWhitelistSetup } from '../../../commands/Minecraft/modules/whitelist.js';

export default {
  name: WHITELIST_MODAL,
  execute: (interaction, client, args) => submitWhitelistSetup(interaction, args),
};
