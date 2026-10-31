/** The project setting: working days after an action's day before a discipline that has not answered is escalated. */
export const ESCALATE_AFTER_KEY = "ESCALATE_AFTER_DAYS";
/** Unless the project says otherwise (the backend's ActionNotices.DefaultEscalateAfter). */
export const DEFAULT_ESCALATE_AFTER = 3;
/** The project setting: the hour of the project's day (0–23) the day's notices go out (backend ActionNotices.NotifyAtKey). */
export const NOTIFY_AT_KEY = "NOTIFY_AT";
/** Unless the project says otherwise (the backend's ActionNotices.DefaultNotifyAt): 09:00. */
export const DEFAULT_NOTIFY_AT = 9;
/** The title the answer reads under, the same on every page that asks it. */
export const NOTIFY_AT_TITLE = "The day's notices (at risk, notified again, a review step due) go out at";
