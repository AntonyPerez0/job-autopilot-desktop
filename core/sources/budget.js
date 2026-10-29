// How many searches a source may make in one discovery cycle, and whose turn it is: the person's titles
// times their places can be many, so each cycle takes the next few and the rest wait their turn (the same
// rotation google.js uses). The position is kept in settings.rotate[source].
import { getSettings, saveSettings } from "../store.js";

export const PER_CYCLE = 30; // typical setups need about 10; the clamped preferences allow about 1,000

export function thisCycle(runs, source, perCycle = PER_CYCLE) {
  if (runs.length <= perCycle) return runs;
  const rot = getSettings().rotate || {};
  const start = (Number(rot[source]) || 0) % runs.length;
  const ordered = [...runs.slice(start), ...runs.slice(0, start)];
  saveSettings({ rotate: { ...rot, [source]: (start + perCycle) % runs.length } });
  return ordered.slice(0, perCycle);
}
