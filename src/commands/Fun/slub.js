import { SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getSpouseId } from '../../services/marriageService.js';
import { buildDivorceConfirm, buildMarriageInfo, buildProposal } from './modules/relationships.js';
import { t } from '../../i18n/index.js';

// Marriage. Spouses share one bank with two accounts (see src/services/marriageService.js).
export default {
    data: new SlashCommandBuilder()
        .setName('slub')
        .setDescription('Marriage: propose, see your marriage, divorce')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('oswiadcz')
                .setDescription('Propose to someone')
                .addUserOption((option) => option.setName('osoba').setDescription('Who you want to marry').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('info')
                .setDescription('Show a marriage and the joint bank')
                .addUserOption((option) => option.setName('osoba').setDescription('Whose marriage (defaults to you)')),
        )
        .addSubcommand((sub) => sub.setName('rozwod').setDescription('Get divorced (the joint bank is split in half)')),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();
        const { guildId, user } = interaction;

        if (subcommand === 'info') {
            const target = interaction.options.getUser('osoba') ?? user;
            await InteractionHelper.universalReply(interaction, await buildMarriageInfo({ client, guildId, userId: target.id, viewerId: user.id }));
            return;
        }

        if (subcommand === 'rozwod') {
            if (!(await getSpouseId(guildId, user.id))) {
                throw new TitanBotError('Not married', ErrorTypes.VALIDATION, t('You are not married.'));
            }
            await InteractionHelper.universalReply(interaction, await buildDivorceConfirm({ client, guildId, userId: user.id }));
            return;
        }

        const target = interaction.options.getUser('osoba');
        if (!target) {
            throw new TitanBotError('Missing proposal target', ErrorTypes.USER_INPUT, t('Pick who you want to marry.'), { subtype: 'invalid_user' });
        }
        if (target.id === user.id) {
            throw new TitanBotError('Proposal to self', ErrorTypes.VALIDATION, t('You cannot marry yourself.'));
        }
        if (target.bot) {
            throw new TitanBotError('Proposal to a bot', ErrorTypes.VALIDATION, t('Bots do not get married.'));
        }

        const ownSpouse = await getSpouseId(guildId, user.id);
        if (ownSpouse === target.id) {
            throw new TitanBotError('Already married to them', ErrorTypes.VALIDATION, t`You are already married to <@${target.id}>.`);
        }
        if (ownSpouse) {
            throw new TitanBotError('Already married', ErrorTypes.VALIDATION, t`You are already married to <@${ownSpouse}>. Divorce first with \`/slub rozwod\`.`);
        }
        const targetSpouse = await getSpouseId(guildId, target.id);
        if (targetSpouse) {
            throw new TitanBotError('Target already married', ErrorTypes.VALIDATION, t`<@${target.id}> is already married to <@${targetSpouse}>.`);
        }

        await InteractionHelper.universalReply(interaction, await buildProposal({ guildId, proposerId: user.id, targetId: target.id }));
    },
};
