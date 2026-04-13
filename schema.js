import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const giveawayStatusEnum = pgEnum("giveaway_status", ["active", "ended"]);
export const mediaDispatchModeEnum = pgEnum("media_dispatch_mode", ["time", "reactions"]);
export const mediaDispatchStatusEnum = pgEnum("media_dispatch_status", ["pending", "sent", "cancelled"]);

export const giveawaysTable = pgTable("giveaways", {
  id: serial("id").primaryKey(),
  prize: text("prize").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  winnersCount: integer("winners_count").notNull().default(1),
  conditions: text("conditions").notNull().default(""),
  status: giveawayStatusEnum("status").notNull().default("active"),
  winners: text("winners").array().notNull().default([]),
  endsAt: timestamp("ends_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  channelId: text("channel_id"),
  guildId: text("guild_id"),
  messageId: text("message_id"),
});

export const giveawayParticipantsTable = pgTable("giveaway_participants", {
  id: serial("id").primaryKey(),
  giveawayId: integer("giveaway_id").notNull().references(() => giveawaysTable.id),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  enteredAt: timestamp("entered_at").defaultNow().notNull(),
});

export const mediaDispatchesTable = pgTable("media_dispatches", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  sourceChannelId: text("source_channel_id").notNull(),
  sourceMessageId: text("source_message_id").notNull(),
  targetChannelId: text("target_channel_id").notNull(),
  createdById: text("created_by_id").notNull(),
  mode: mediaDispatchModeEnum("mode").notNull(),
  status: mediaDispatchStatusEnum("status").notNull().default("pending"),
  content: text("content").notNull().default(""),
  attachmentUrls: text("attachment_urls").array().notNull().default([]),
  reactionTarget: integer("reaction_target"),
  lastReactionCount: integer("last_reaction_count").notNull().default(0),
  scheduledFor: timestamp("scheduled_for"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
});
