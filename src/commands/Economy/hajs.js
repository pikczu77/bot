import { SlashCommandBuilder } from 'discord.js';
import balans from './balance.js';

// /hajs works exactly like /balans (the user asked for both names).
export default {
    ...balans,
    data: new SlashCommandBuilder()
        .setName('hajs')
        .setDescription("Check your or someone else's balance")
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to check balance for')
                .setRequired(false)
        ),
};
