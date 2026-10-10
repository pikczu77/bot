import { Events } from 'discord.js';
import { onInviteCreate } from '../services/inviteService.js';

export default {
  name: Events.InviteCreate,
  async execute(invite) {
    onInviteCreate(invite);
  },
};
