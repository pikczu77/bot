import { handleInterfaceInteraction } from '../../../services/tempVoiceInterface.js';

export default {
  name: 'tempvoice',
  execute: (interaction, client, args) => handleInterfaceInteraction(interaction, client, args),
};
