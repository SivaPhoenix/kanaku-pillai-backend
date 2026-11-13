// Runs before every test file, before src/config/env.js is imported, so the app always sees a known test config.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/kanaku_pillai_test?replicaSet=rs0";
process.env.JSON_BODY_LIMIT = "1kb";
