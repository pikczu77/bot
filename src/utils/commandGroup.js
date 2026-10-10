// commandGroup.js — combine several command modules into one slash command.
//
// Discord allows 100 global commands. Related commands are therefore grouped:
// each member becomes a subcommand (or a subcommand group when it already has
// subcommands of its own) and keeps its own execute(), permissions and cooldowns.

import { enforceDefaultCommandPermissions } from './permissionGuard.js';
import { enforceAbuseProtection, formatCooldownDuration } from './abuseProtection.js';
import { createError, ErrorTypes } from './errorHandler.js';
import { t } from '../i18n/index.js';

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

/**
 * @param {object} definition
 * @param {string} definition.name          Slash command name, e.g. "tools"
 * @param {string} definition.description   English description
 * @param {Array<object|{command: object, as?: string, description?: string}>} definition.members
 * @param {bigint} [definition.defaultMemberPermissions] Permission needed to see the command
 * @param {object} [definition.extra]       Extra properties copied onto the group (slashOnly, ...)
 */
export function createCommandGroup({ name, description, members, defaultMemberPermissions = null, extra = {} }) {
  const byName = new Map();
  const options = [];

  for (const entry of members) {
    const member = entry.command ?? entry;
    const memberJson = member.data.toJSON();
    const memberName = entry.as ?? memberJson.name;
    const memberOptions = memberJson.options ?? [];

    if (memberOptions.some((option) => option.type === SUBCOMMAND_GROUP)) {
      throw new Error(`Command "${memberJson.name}" has subcommand groups and cannot be nested in "${name}"`);
    }
    if (byName.has(memberName)) {
      throw new Error(`Duplicate member "${memberName}" in command group "${name}"`);
    }

    const hasSubcommands = memberOptions.some((option) => option.type === SUBCOMMAND);
    options.push({
      type: hasSubcommands ? SUBCOMMAND_GROUP : SUBCOMMAND,
      name: memberName,
      description: entry.description ?? memberJson.description,
      options: memberOptions,
    });

    member.groupName = name;
    member.groupMemberName = memberName;
    byName.set(memberName, member);
  }

  const json = { name, description, type: 1, options };
  if (defaultMemberPermissions !== null) {
    // Hides the command from members without the permission; each member is still checked at run time.
    json.default_member_permissions = String(defaultMemberPermissions);
  }
  const data = {
    name,
    description,
    options,
    toJSON: () => structuredClone(json),
  };

  const resolveMember = (interaction) => {
    const key = interaction.options.getSubcommandGroup(false) ?? interaction.options.getSubcommand(false);
    return { key, member: byName.get(key) };
  };

  return {
    ...extra,
    data,
    members: byName,
    isCommandGroup: true,

    async execute(interaction, guildConfig, client) {
      const { key, member } = resolveMember(interaction);
      if (!member) {
        throw createError(
          `Unknown member "${key}" in command group "${name}"`,
          ErrorTypes.USER_INPUT,
          t`Pick one of: ${[...byName.keys()].map((n) => `\`${n}\``).join(', ')}`,
          { expected: true },
        );
      }

      if (interaction._isPrefixCommand && member.slashOnly === true) {
        throw createError(
          `Slash-only member ${key} invoked by prefix`,
          ErrorTypes.USER_INPUT,
          t`This command is only available as a slash command. Use \`/${name} ${key}\` instead.`,
          { expected: true },
        );
      }

      // Discord only gates the top-level command; each member keeps its own rules.
      member.category ??= this.category;
      const allowed = await enforceDefaultCommandPermissions(interaction, member, {
        source: 'commandGroup',
        guildConfig,
      });
      if (!allowed) return;

      const protection = await enforceAbuseProtection(interaction, member, member.data.name);
      if (!protection.allowed) {
        throw createError(
          `Risky command cooldown active for ${name} ${key}`,
          ErrorTypes.RATE_LIMIT,
          t`This command is on cooldown. Please wait ${formatCooldownDuration(protection.remainingMs)} before trying again.`,
          { subtype: 'command_cooldown', expected: true },
        );
      }

      const run = interaction._isPrefixCommand && member.prefixExecute ? member.prefixExecute : member.execute;
      return run.call(member, interaction, guildConfig, client);
    },

    async autocomplete(interaction, client) {
      const { member } = resolveMember(interaction);
      if (member?.autocomplete) {
        return member.autocomplete(interaction, client);
      }
      return interaction.respond([]);
    },
  };
}
