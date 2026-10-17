export type NotificationKind = "STATUS" | "REPLY" | "SUBMITTED" | "OVERDUE";
export interface AppNotification {
  id: string;
  ticketId: string;
  kind: NotificationKind;
  message: string;
  createdAt: string;
  read: boolean;
}
export const NOTIFICATION_LIMIT = 50;

/** Only metadata belongs here: never reporter identity, subject, or message body. */
export function recentNotifications(items: AppNotification[]): AppNotification[] {
  const newest = (a: AppNotification, b: AppNotification) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);
  // Reserve space for the ten oldest breached deadlines, so a busy conversation
  // cannot push urgent tickets out of the feed or consume every update slot.
  const overdue = items.filter((item) => item.kind === "OVERDUE").sort((a, b) => -newest(a, b)).slice(0, 10);
  const updates = items.filter((item) => item.kind !== "OVERDUE").sort(newest).slice(0, NOTIFICATION_LIMIT - overdue.length);
  return [...overdue, ...updates];
}
