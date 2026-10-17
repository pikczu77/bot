// The "do it again" button under /work, /fish and /nagraj (2026-10-16, owner: "jak masz dalej użycia,
// to po użyciu jednym daj guzik pracuj ponownie"). Shown while uses in a row are left, or when an
// Energy Drink / Extra Work Shift could skip the break. Handler: interactions/buttons/economy/again.js
//   ponownie:<work|fish|nagraj>:<ownerId>

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { t } from '../../../i18n/index.js';

const KINDS = {
  work: { emoji: '💼', label: () => t('Work again'), skipItem: 'extra_work', skipEmoji: '⏱️' },
  fish: { emoji: '🎣', label: () => t('Fish again'), skipItem: 'energy_drink', skipEmoji: '🥤' },
  nagraj: { emoji: '🎬', label: () => t('Record again'), skipItem: 'energy_drink', skipEmoji: '🥤' },
};

/** `[row]` with the button, or `[]` when nothing is left to use right now. */
export function againComponents(kind, ownerId, inARowLeft, userData) {
  const spec = KINDS[kind];
  if (!spec || !ownerId) return [];
  const skips = userData?.inventory?.[spec.skipItem] || 0;
  if (inARowLeft <= 0 && skips <= 0) return [];
  const label = inARowLeft > 0 ? `${spec.label()} (${inARowLeft})` : `${spec.label()} (${spec.skipEmoji} ${skips})`;
  return [new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`ponownie:${kind}:${ownerId}`)
    .setLabel(label.slice(0, 80))
    .setEmoji(spec.emoji)
    .setStyle(ButtonStyle.Success))];
}
