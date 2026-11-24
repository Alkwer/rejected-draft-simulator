// First lines and defeat prefixes from the full Steam renderer locales, build 26823208.
// Rewards can add lines to a victory. The number in a defeat message is a cooldown.
const hyenaVictory = new Set([
  "Hyena Hulk defeated!", "Pokonano Hyena Hulk!", "¡Hyena Hulk derrotado!", "鬣狗浩克 已被击败！",
  "Hyena Hulk besiegt!", "Hyena Hulk vaincu!", "Hyena Hulk sconfitto!", "Hyena Hulk deriu!",
  "Hyena Hulk побежден!", "Hyena Hulk を倒した！", "هزم Hyena Hulk!", "Hyena Hulk verslagen!",
  "Hyena Hulk înfrânt!", "Hyena Hulk 처치 완료!", "Sırtlan Hulk yenildi!",
]);
const hyenaDefeat = [
  "Defeated by Hyena Hulk!", "Pokonane przez Hyena Hulk!", "¡Derrotado por Hyena Hulk!",
  "被 鬣狗浩克 击败了！", "Besiegt durch Hyena Hulk!", "Vaincu par Hyena Hulk !", "Respinto da Hyena Hulk!",
  "Derrotado por Hyena Hulk!", "Поражение от Hyena Hulk!", "Hyena Hulkに倒された！",
  "هزم من قبل Hyena Hulk!", "Verslagen door Hyena Hulk!", "Înfrânt de Hyena Hulk!",
  "Hyena Hulk에게 패배했습니다!", "Sırtlan Hulk seni yendi!",
];

function hyenaOutcome(notice) {
  const line = typeof notice?.message === "string" && notice.message.split(/\r?\n/, 1)[0].trim();
  if (!line) return null;
  if (notice.type === "VICTORY" && hyenaVictory.has(line)) return "win";
  if (notice.type === "DEFEAT" && hyenaDefeat.some((prefix) => line.startsWith(prefix))) return "loss";
  return null;
}

export function hyenaNotificationsEnabled({ state }) {
  const settings = state.notificationSettings;
  return state.combatLogUnlocked !== false && settings?.VICTORY?.inGame !== false && settings?.DEFEAT?.inGame !== false;
}

export function inspectHyenaHistory(save, { since, until = Infinity, checkedThrough = since }) {
  const history = save.state.notificationHistory;
  const savedAt = save.meta?.savedAt;
  if (!Number.isSafeInteger(savedAt)) return { status: "unavailable" };
  if (savedAt < since || savedAt < checkedThrough) return { status: "waiting" };
  if (!Array.isArray(history)) return { status: hyenaNotificationsEnabled(save) ? "unavailable" : "settings" };
  const chronological = history.filter((entry) => Number.isSafeInteger(entry?.timestamp) && entry.timestamp <= savedAt)
    .sort((a, b) => a.timestamp - b.timestamp);
  // The docked history holds ten entries and the basic style holds up to five.
  // A later rematch cannot fill a gap between the last inspected save and this window.
  const capacity = save.state.notificationStyle === "basic" ? 5 : 10;
  if (history.length >= capacity && !chronological.some((entry) => entry.timestamp <= checkedThrough)) {
    return { status: "history-gap" };
  }
  for (const notice of chronological) {
    const outcome = hyenaOutcome(notice);
    if (!outcome || notice.timestamp < since || notice.timestamp >= until) continue;
    const action = notice.action;
    if (action?.kind !== "combat-log" || !Number.isSafeInteger(action.startTime) || action.startTime <= 0 ||
        action.startTime > notice.timestamp || typeof action.encounterId !== "string" || !action.encounterId.trim()) {
      return { status: "missing-timing" };
    }
    if (action.startTime < since) continue;
    return {
      status: "imported", outcome,
      elapsedSeconds: (notice.timestamp - action.startTime) / 1000,
      evidence: { source: "steam-notification", encounterId: action.encounterId,
        startedAt: action.startTime, notifiedAt: notice.timestamp },
    };
  }
  if (savedAt >= until) return { status: "superseded" };
  if (!hyenaNotificationsEnabled(save)) return { status: "settings" };
  return { status: "waiting", checkedThrough: savedAt };
}
