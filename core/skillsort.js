// Which group a skill goes in on the resume, decided the same way every time, without an AI:
//   "Software & Systems": a name from O*NET's software list (vendor/onet/software.json.gz) or one that says
//                         it's software ("... app", "... CRM");
//   "Equipment & Tools":  a thing you operate ("Pallet jack", "Vinyl cutter", "Bucket truck");
//   "soft":               a trait or general skill recruiters skip ("Teamwork"): kept off the page;
//   "Skills":             everything else ("Customer onboarding", "Truck driving").
import fs from "node:fs";
import zlib from "node:zlib";

let SW = null;
const software = () => (SW ||= new Set(JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("../vendor/onet/software.json.gz", import.meta.url))).toString("utf8")).names));
const norm = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();

export const SOFT = /^(driving|customer service|communication|communication skills|teamwork|team work|team player|leadership|time management|problem solving|work ethic|punctual\w*|reliab\w*|hard work\w*|reading work orders|multitasking|multi-tasking|organization|organizational skills|attention to detail|detail oriented|interpersonal skills|people skills|fast learner|quick learner|positive attitude|dependab\w*|flexib\w*|adaptab\w*|motivated|self[- ]motivated)$/i;
// The thing named last is what the item is: "Pallet jack" is equipment, "Forklift operation" is a skill.
const EQUIPMENT = /\b(forklifts?|flatbeds?|straps?|chains?|pallet jacks?|jacks?|hand trucks?|dollies|dolly|cash registers?|registers?|tills?|scanners?|printers?|cutters?|trucks?|trailers?|lifts?|winch(es)?|drills?|saws?|chainsaws?|welders?|lathes?|compressors?|generators?|excavators?|backhoes?|skid steers?|loaders?|cranes?|hoists?|washers?|buffers?|vacuums?|extractors?|machines?|ovens?|fryers?|grills?|mixers?|slicers?|steamers?|multimeters?|meters?|gauges?|calipers?|micrometers?|ladders?|radios?|tools?|wrench(es)?|torches?|pumps?|mowers?|trimmers?|blowers?|sanders?|grinders?|presses?|routers?|scales?|carts?|equipment|vans?|buses|bus|tractors?|bulldozers?|dishwashers?|espresso machines?|registers?)$/i;
const SAYS_SOFTWARE = /\b(software|app|apps|crm|erp|platform|pos system|point of sale|online|database|spreadsheets?)\b/i;

export function skillGroup(item) {
  const raw = String(item || "").trim(), n = norm(raw);
  if (!n) return "Skills";
  if (SOFT.test(raw)) return "soft";
  const list = software();
  if (list.has(n) || list.has(n.replace(/ (software|app|apps|platform|system)$/, "")) || SAYS_SOFTWARE.test(raw)) return "Software & Systems";
  if (EQUIPMENT.test(n)) return "Equipment & Tools";
  return "Skills";
}
