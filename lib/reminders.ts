import { redis } from "./redis";
import type { Reminder } from "@/types/reminder";

export async function saveReminder(reminder: Reminder): Promise<void> {
  await Promise.all([
    redis.set(`reminder:${reminder.id}`, reminder),
    redis.sadd("reminders:active", reminder.id),
  ]);
}

export async function getReminder(id: string): Promise<Reminder | null> {
  return redis.get<Reminder>(`reminder:${id}`);
}

export async function getActiveReminderIds(): Promise<string[]> {
  return redis.smembers("reminders:active");
}

export async function completeReminder(id: string): Promise<void> {
  const reminder = await getReminder(id);
  if (!reminder) return;

  const updated: Reminder = {
    ...reminder,
    status: "completed",
    completed_at: new Date().toISOString(),
  };

  await Promise.all([
    redis.set(`reminder:${id}`, updated),
    redis.srem("reminders:active", id),
  ]);
}
