import { User } from "../models/user.model.js";

// Marks first-time setup done exactly once: returns the updated user, or null when it was already complete.
export function markSetupComplete(userId, { currencyCode, locale, tzid }, { session } = {}) {
  return User.findOneAndUpdate(
    { _id: userId, setupComplete: false },
    {
      $set: {
        "settings.currencyCode": currencyCode,
        "settings.locale": locale,
        "settings.tzid": tzid,
        setupComplete: true,
      },
    },
    { returnDocument: "after", session },
  ).lean();
}
