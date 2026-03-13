import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const giveawayStatusEnum = pgEnum("giveaway_status", ["active", "ended"]);

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

export type Giveaway = typeof giveawaysTable.$inferSelect;
export type GiveawayParticipant = typeof giveawayParticipantsTable.$inferSelect;
