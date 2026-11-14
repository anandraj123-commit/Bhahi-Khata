export type { RichDoc as RichNode } from "../shared/notificationContent";
import type { RichDoc as RichNode } from "../shared/notificationContent";
export type InboxNotice = {
  id: string;
  aliases?: string[];
  title: string;
  body: string;
  read: boolean;
  date: string;
  category?: string;
  shortDescription?: RichNode;
  description?: RichNode;
};
