// discordSink.js — last-line translation of everything the bot sends.
//
// Most text is translated where it is written (t`...`). This module catches the rest:
// constants defined at module scope, config defaults, and anything built before a
// language context existed. It hooks the single place discord.js builds an outgoing
// message body, plus modals and collectors.

import { MessagePayload, ModalBuilder, Collector } from 'discord.js';
import { tr, runWithLocale, currentLocale, getCachedGuildLocale, DEFAULT_LOCALE, localeFromDiscord } from './index.js';

const TEXT_DISPLAY = 10;

function localizeEmbed(embed) {
  if (!embed || typeof embed !== 'object') return;
  if (embed.title) embed.title = tr(embed.title);
  if (embed.description) embed.description = tr(embed.description);
  if (embed.footer?.text) embed.footer.text = tr(embed.footer.text);
  if (embed.author?.name) embed.author.name = tr(embed.author.name);
  if (Array.isArray(embed.fields)) {
    for (const field of embed.fields) {
      if (field?.name) field.name = tr(field.name);
      if (field?.value) field.value = tr(field.value);
    }
  }
}

function localizeComponent(component) {
  if (!component || typeof component !== 'object') return;
  if (typeof component.label === 'string') component.label = tr(component.label);
  if (typeof component.placeholder === 'string') component.placeholder = tr(component.placeholder);
  if (typeof component.title === 'string') component.title = tr(component.title);
  if (component.type === TEXT_DISPLAY && typeof component.content === 'string') {
    component.content = tr(component.content);
  }
  if (typeof component.description === 'string') component.description = tr(component.description);
  if (Array.isArray(component.options)) {
    for (const option of component.options) {
      if (typeof option?.label === 'string') option.label = tr(option.label);
      if (typeof option?.description === 'string') option.description = tr(option.description);
    }
  }
  if (Array.isArray(component.components)) component.components.forEach(localizeComponent);
  if (component.accessory) localizeComponent(component.accessory);
  if (component.component) localizeComponent(component.component);
}

export function localizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  if (typeof body.content === 'string') body.content = tr(body.content);
  if (Array.isArray(body.embeds)) body.embeds.forEach(localizeEmbed);
  if (Array.isArray(body.components)) body.components.forEach(localizeComponent);
  return body;
}

function guildIdOf(source) {
  return source?.guildId ?? source?.guild?.id ?? source?.message?.guildId ?? source?.message?.guild?.id ?? null;
}

/** Best language for something that happened in/for a guild, channel, message or interaction. */
export function localeFor(source) {
  const guildId = guildIdOf(source);
  if (guildId) return getCachedGuildLocale(guildId) ?? DEFAULT_LOCALE;
  return localeFromDiscord(source?.locale) ?? DEFAULT_LOCALE;
}

let installed = false;

export function installDiscordSink() {
  if (installed) return;
  installed = true;

  const originalResolveBody = MessagePayload.prototype.resolveBody;
  MessagePayload.prototype.resolveBody = function resolveLocalizedBody() {
    const hadBody = Boolean(this.body);
    const result = originalResolveBody.call(this);
    if (!hadBody && this.body) {
      if (currentLocale()) {
        localizeBody(this.body);
      } else {
        // Sent from outside any language context (timer, third-party event): use the
        // language of the guild the message is going to.
        runWithLocale(localeFor(this.target), () => localizeBody(this.body));
      }
    }
    return result;
  };

  const originalModalToJSON = ModalBuilder.prototype.toJSON;
  ModalBuilder.prototype.toJSON = function localizedModalToJSON() {
    const json = originalModalToJSON.call(this);
    localizeComponent(json);
    return json;
  };

  // Collector callbacks run from discord.js' own listeners, which have no language
  // context. Re-enter the guild's language before they fire.
  const originalHandleCollect = Collector.prototype.handleCollect;
  Collector.prototype.handleCollect = function handleCollectLocalized(...args) {
    if (currentLocale()) return originalHandleCollect.apply(this, args);
    return runWithLocale(localeFor(args[0]), () => originalHandleCollect.apply(this, args));
  };
}
