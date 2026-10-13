import { handleSelfRoleButton } from '../../../services/selfRoleService.js';

export default {
  name: 'selfrole',
  execute: (interaction, client, args) => handleSelfRoleButton(interaction, client, args),
};
