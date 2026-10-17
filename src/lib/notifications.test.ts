import { expect, it } from "vitest";
import { recentNotifications, type AppNotification } from "./notifications";

it("limits the feed, orders equal timestamps deterministically, and leaves input unchanged", () => {
  const items: AppNotification[] = Array.from({ length: 60 }, (_, index) => ({ id: `status:${String(index).padStart(2, "0")}`, ticketId: "TRX-2026-12345678", kind: "STATUS", message: "Status diperbarui", createdAt: "2026-10-14T00:00:00Z", read: false }));
  const result = recentNotifications(items);
  expect(result).toHaveLength(50);
  expect(result[0]!.id).toBe("status:59");
  expect(result.at(-1)?.id).toBe("status:10");
  expect(items[0]!.id).toBe("status:00");
});

it("keeps breached deadlines visible even when recent replies fill the feed", () => {
  const updates: AppNotification[] = Array.from({ length: 60 }, (_, index) => ({ id: `reply:${index}`, ticketId: "TRX-2026-12345678", kind: "REPLY", message: "Balasan baru", createdAt: "2026-10-14T00:00:00Z", read: false }));
  const overdue: AppNotification = { ...updates[0]!, id: "deadline:old", kind: "OVERDUE", createdAt: "2026-10-01T00:00:00Z" };
  const feed = recentNotifications([...updates, overdue]);
  expect(feed).toHaveLength(50);
  expect(feed[0]?.id).toBe("deadline:old");
  expect(feed.filter((item) => item.kind === "REPLY")).toHaveLength(49);
});
