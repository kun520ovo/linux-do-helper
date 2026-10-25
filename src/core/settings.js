import { Storage } from "./storage.js";

const defaults = {
  smartLikeEnabled: false,
  smartLikeSpeed: "normal",
  cleanModeEnabled: false,
  grayscaleModeEnabled: false,
  readUnreadEnabled: false,
  randomOrderEnabled: false,
  skipReadEnabled: true,
  fullTopicReadEnabled: false,
  topicLimitCount: 100,
  restTimeMinutes: 10,
  topicCreatedTimeVisible: true,
  topicAgeColorEnabled: true,
  stopAfterReadEnabled: false,
  stopAfterReadCount: 10,
  stopOnLikeLimitEnabled: false,
  cfBypassEnabled: true,
};

export function loadSettings(storage = Storage) {
  const settings = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, storage.get(key, value)]),
  );
  settings.smartLikeEnabled = settings.smartLikeEnabled === true;
  if (!["slow", "normal", "fast"].includes(settings.smartLikeSpeed)) settings.smartLikeSpeed = "normal";
  return settings;
}
