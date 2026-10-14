// Buttons of /randka (date invitation) and /slub (proposal, divorce confirmation).
// The logic lives in src/commands/Fun/modules/relationships.js.

import { handleDateButton, handleMarriageButton } from '../../../commands/Fun/modules/relationships.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

function guarded(name, handler) {
    return {
        name,
        async execute(interaction, client, args = []) {
            try {
                await handler(interaction, client, args);
            } catch (error) {
                await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
            }
        },
    };
}

export default [
    guarded('randka', handleDateButton),
    guarded('slub', handleMarriageButton),
];
