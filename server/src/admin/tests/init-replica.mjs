import mongoose from "mongoose";
try {
  await mongoose.connect(
    "mongodb://127.0.0.1:27028/admin?directConnection=true",
    { serverSelectionTimeoutMS: 5000 },
  );
  try {
    await mongoose.connection.db
      .admin()
      .command({
        replSetInitiate: {
          _id: "dkAdminTest",
          members: [{ _id: 0, host: "127.0.0.1:27028" }],
        },
      });
  } catch (error) {
    if (error.codeName !== "AlreadyInitialized") throw error;
  }
  console.log("Isolated test replica set initialized.");
} finally {
  await mongoose.disconnect();
}
