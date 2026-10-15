import mongoose from "mongoose";
import { Audit, Customer, Device, Entry, Notification, Session, Shop, User } from "../models.js";

export async function deleteAccount({ userId, shopId }) {
  await mongoose.connection.transaction(async (session) => {
    await Promise.all([
      Session.deleteMany({ userId }, { session }),
      Customer.deleteMany({ shopId }, { session }),
      Entry.deleteMany({ shopId }, { session }),
      Audit.deleteMany({ shopId }, { session }),
      Notification.deleteMany({ shopId }, { session }),
      Device.deleteMany({ shopId }, { session }),
      Shop.deleteOne({ _id: shopId }, { session }),
      User.deleteOne({ _id: userId }, { session }),
    ]);
  });
}
