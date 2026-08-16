/**
 * The App Store rules, asserted rather than remembered.
 *
 * Every check here stands for a real failure this project already had, and
 * they share a shape: nothing throws, nothing looks wrong, and the symptom
 * appears weeks later in an email from App Review or not at all.
 *
 *   · four Swift files sat in `ios/App/App/` belonging to no target. They
 *     compiled nowhere and shipped as nothing. Target membership is invisible
 *     in a diff, in a file listing, and in the editor.
 *   · `Info.plist` asked for calendar access for a feature that did not exist,
 *     which is a 5.1.1 rejection for a permission with nothing behind it.
 *   · every buy button called Stripe, which inside an app bundle is 3.1.1.
 *
 * A test suite cannot run Xcode. What it can do is read the project the way a
 * reviewer reads the binary — what is declared, what is wired, what is
 * promised — and refuse to let the three drift apart.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const IOS = "ios/App/App";
const plist = read(`${IOS}/Info.plist`);
const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");

/* ------------------------------------------------ every file is in the build */
// The bug that started this file. A Swift file on disk and absent from the
// project is a feature that silently does not exist.
const native = readdirSync(IOS).filter((f) => /\.(swift|m)$/.test(f));
t(`there are native sources to check (${native.length})`, native.length >= 6, native.length);
for (const file of native) {
  t(`${file} is in the Xcode target`, pbxproj.includes(file),
    "on disk, in no target — it compiles nowhere and ships as nothing");
}
t("the privacy manifest is copied into the bundle, not merely committed",
  pbxproj.includes("PrivacyInfo.xcprivacy"),
  "a manifest outside Copy Bundle Resources is refused at upload");

/* --------------------------------------------- permissions have features */
/**
 * Each usage description, and the code that justifies it.
 *
 * Apple's rule is that you may not ask for what you do not use, and the
 * enforcement is a human reading your plist next to your binary. The mapping
 * below is the same question asked mechanically: if the key is declared, the
 * thing that uses it must exist.
 */
const PERMISSIONS = [
  { key: "NSCalendarsUsageDescription", proof: `${IOS}/SquirrelCalendar.swift`, needs: "EKEventStore" },
  { key: "NSCalendarsFullAccessUsageDescription", proof: `${IOS}/SquirrelCalendar.swift`, needs: "requestFullAccessToEvents" },
  { key: "NSMicrophoneUsageDescription", proof: "src/lib/speech.js", needs: "SpeechRecognition" },
  { key: "NSSpeechRecognitionUsageDescription", proof: "src/lib/speech.js", needs: "SpeechRecognition" },
];

for (const p of PERMISSIONS) {
  if (!plist.includes(p.key)) { t(`${p.key} is not asked for`, true); continue; }
  t(`${p.key} has a feature behind it`, read(p.proof).includes(p.needs),
    `declared in Info.plist with no ${p.needs} anywhere — a permission with nothing behind it is a 5.1.1 rejection`);
}

// And the reverse: a usage string must actually say what it is for. Apple
// rejects bare restatements of the permission name.
for (const key of PERMISSIONS.map((p) => p.key)) {
  if (!plist.includes(key)) continue;
  const said = plist.split(`<key>${key}</key>`)[1]?.split("</string>")[0]?.split("<string>")[1] ?? "";
  t(`${key} explains itself in a sentence`, said.trim().split(/\s+/).length >= 8, said.slice(0, 60));
}

/* ------------------------------------------------------------ the plist */
// The declared *value*, not the raw file: a comment explaining why armv7 was
// removed is not the same thing as still requiring armv7, and a check that
// cannot tell them apart fails on its own explanation.
t("armv7 is gone — a 32-bit leftover no current device satisfies",
  !plist.includes("<string>armv7</string>"), "UIRequiredDeviceCapabilities still requires armv7");
t("arm64 is declared instead", plist.includes("<string>arm64</string>"));
t("the export-compliance question is answered in the bundle",
  plist.includes("ITSAppUsesNonExemptEncryption"),
  "unanswered, so it is asked by hand at every single upload");
t("no key is declared twice",
  (plist.match(/<key>UIViewControllerBasedStatusBarAppearance<\/key>/g) || []).length === 1,
  "a duplicated plist key is a warning, and the second one silently wins");

/* ---------------------------------------------------- privacy manifests */
// Every bundle needs one, and an extension is a bundle. App-only passes local
// builds and is refused at upload, which is a slow way to find out.
for (const [what, path] of [
  ["the app", `${IOS}/PrivacyInfo.xcprivacy`],
  ["the widget", "ios/App/SquirrelWidget/PrivacyInfo.xcprivacy"],
]) {
  const m = read(path);
  t(`${what} has a privacy manifest`, Boolean(m), path);
  if (!m) continue;
  t(`${what} declares whether it tracks`, m.includes("NSPrivacyTracking"));
  t(`${what} declares a reason for UserDefaults`,
    m.includes("NSPrivacyAccessedAPICategoryUserDefaults") && m.includes("CA92.1"),
    "a required-reason API without its reason code fails validation at upload");
}

/* --------------------------------------------------------- the App Group */
// Set on one target and not the other, the app writes into a container the
// widget cannot see: no error, no log, a placeholder widget for ever.
const GROUP = "group.com.squirrelll.app";
for (const [what, path] of [
  ["the app", `${IOS}/App.entitlements`],
  ["the widget", "ios/App/SquirrelWidget/SquirrelWidget.entitlements"],
  ["the bridge that writes it", `${IOS}/SquirrelBridge.swift`],
]) {
  t(`${what} names the same App Group`, read(path).includes(GROUP), `${path} disagrees or is missing`);
}
t("the app target points at its entitlements file",
  pbxproj.includes("CODE_SIGN_ENTITLEMENTS"),
  "the file exists and nothing reads it, which is the same as not having one");

/* ------------------------------------------------- iOS 3.1.1: buy in-app */
/**
 * No screen may reach Stripe checkout directly.
 *
 * `upgrade()` is the fork — In-App Purchase inside the app, Stripe on the web
 * — and it only works if every buy button goes through it. A component that
 * imports `startCheckout` compiles, works perfectly in a browser, and is a
 * rejection on a phone.
 */
/**
 * The one legitimate exception, named rather than tolerated.
 *
 * Seats are a quantity-based subscription — one company, one invoice, twelve
 * people — and In-App Purchase cannot express that: a StoreKit subscription
 * belongs to the Apple ID that bought it, and there is no buying twelve of
 * them on other people's behalf. So the seat flow cannot move to IAP, and the
 * only compliant answer is that the app does not sell it at all.
 *
 * Written down so the exception stays a decision somebody made once, for a
 * reason, instead of a doorway the next component quietly walks through.
 */
const WEB_ONLY = {
  "Company.jsx": "seats are quantity-based; StoreKit cannot express them, so the app does not sell them",
};

const components = readdirSync("src/components").filter((f) => f.endsWith(".jsx"));
const reaching = components.filter((f) => /\bstartCheckout\b/.test(read(`src/components/${f}`)));
const unlisted = reaching.filter((f) => !(f in WEB_ONLY));
t("no component reaches Stripe checkout directly",
  unlisted.length === 0,
  `${unlisted.join(", ")} — must call upgrade(), which picks IAP inside the app`);

// And the listed one has to actually check. An exception that forgets its own
// condition sells through Stripe on a phone, which is precisely the rejection
// the rule exists to prevent.
for (const f of Object.keys(WEB_ONLY)) {
  if (!reaching.includes(f)) continue;
  t(`${f} sells on the web only, and checks which it is on`,
    /\binNativeApp\b/.test(read(`src/components/${f}`)),
    `allowed to reach Stripe because ${WEB_ONLY[f]} — but it must hide the purchase inside the app`);
}

t("the upgrade fork exists and names the rule",
  /export async function upgrade/.test(read("src/lib/billing.js")));

// Required by 3.1.1 wherever a subscription is sold in-app, and the first
// thing review looks for. Somebody on a new phone is otherwise shown a
// paywall for a subscription Apple is already charging them for.
const restoreOffered = components.some((f) => /Restore purchases/i.test(read(`src/components/${f}`)));
t("restore purchases is offered in the UI", restoreOffered,
  "without it a reinstall means paying twice, and review rejects on sight");

t("the App Store flow verifies on the server before it finishes a transaction",
  /await verify\(tx\)[\s\S]{0,200}finish/.test(read("src/lib/appstore.js")),
  "finishing first loses any purchase whose grant failed, permanently");

/* --------------------------------------------------- account deletion (5.1.1v) */
t("an account can be deleted from inside the app",
  existsSync("src/components/DeleteAccount.jsx") && existsSync("api/account/delete.js"),
  "an app that creates accounts must let them be deleted in-app");

/* ------------------------------------------------------- reachable policies */
// App Store Connect needs a URL, and a policy only reachable behind a login is
// a policy the reviewer cannot open.
const app = read("src/App.jsx");
t("the privacy policy and terms are reachable without an account",
  app.includes('"/privacy"') && app.includes('"/terms"'),
  "they must be routable before sign-in, or Connect's URL fields point at a wall");

/* ------------------------------------------------ the build actually happens */
/**
 * Everything here is invisible on a laptop and fatal on the build machine.
 * Squirrel is compiled on a rented Mac from a clean checkout, so anything that
 * lives only in somebody's Xcode does not exist.
 */
t("the widget extension target is in the project",
  pbxproj.includes("SquirrelWidget"),
  "no target means no widget in the bundle, however good the Swift is");

t("the app embeds the extension it builds",
  pbxproj.includes("PBXCopyFilesBuildPhase") && pbxproj.includes("PBXTargetDependency"),
  "without the dependency and the embed phase the .appex never reaches PlugIns/");

t("the scheme is shared, not per-developer",
  existsSync("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme"),
  "schemes live in gitignored xcuserdata; a clean checkout would have none to build");

const ci = read("codemagic.yaml");
t("there is a build pipeline at all", Boolean(ci), "codemagic.yaml");
t("the pipeline re-wires the project after cap sync",
  /cap sync ios[\s\S]{0,600}ios:wire/.test(ci),
  "cap sync rewrites the project, so the wiring has to run after it");
t("the pipeline refuses to ship an unconfigured bundle",
  ci.includes("VITE_API_URL") && ci.includes("VITE_SUPABASE_ANON_KEY"),
  "these are baked in at build time; missing, the app installs and nobody can sign in");
t("the pipeline signs the widget as well as the app",
  ci.includes("WIDGET_BUNDLE_ID"),
  "a missing extension profile fails at the archive, the slowest place to find out");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
