import { Events } from 'discord.js';
import { onInviteDelete } from '../services/inviteService.js';

export default {
  name: Events.InviteDelete,
  async execute(invite) {
    onInviteDelete(invite);
  },
};
