#!/usr/bin/env node
/**
 * Put the native code into the Xcode project, and keep it there.
 *
 * Four Swift files sat in `ios/App/App/` for months belonging to no target:
 * the widget bridge, the Siri intents, and — before this — the App Group that
 * makes them work. They compiled nowhere and shipped as nothing. Membership in
 * an Xcode target is invisible in a diff, invisible in a file listing, and
 * invisible in the editor; the only symptom is a feature that is silently
 * absent at runtime, which is exactly how they went unnoticed.
 *
 * So the wiring is a script rather than a thing somebody remembers to click.
 * It is idempotent: run it after `npx cap sync ios`, after a merge, or twice in
 * a row, and the result is the same. Anything already present is left alone.
 *
 *     node scripts/xcode-wire.mjs [--check]
 *
 * `--check` reports without writing, and exits non-zero when something is
 * missing — which is what CI should run, so a file added to the folder and
 * forgotten in the project fails a build instead of shipping as a no-op.
 *
 * ## Why not just do it in Xcode
 *
 * Because `npx cap sync` rewrites parts of the project, because a merge of two
 * branches that both touched `project.pbxproj` resolves into something no
 * human reviews line by line, and because the failure is silent. A script that
 * asserts the end state survives all three.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import xcode from "xcode";

const PROJECT = "ios/App/App.xcodeproj/project.pbxproj";
const APP_GROUP = "group.com.squirrelll.app";
const check = process.argv.includes("--check");

/**
 * Everything that belongs to the App target, and why.
 *
 * `compile` files land in the sources build phase; `resource` files are copied
 * into the bundle. The privacy manifest is a resource — a manifest that is not
 * copied is a manifest that is not there, and the upload is refused for a file
 * sitting in plain sight in the repository.
 */
const APP_FILES = [
  { path: "SquirrelBridge.swift", kind: "compile", why: "writes the widget snapshot" },
  { path: "SquirrelBridge.m", kind: "compile", why: "registers the bridge with Capacitor" },
  { path: "SquirrelIntents.swift", kind: "compile", why: "Siri, Spotlight and the Action button" },
  { path: "SquirrelStore.swift", kind: "compile", why: "In-App Purchase — required by 3.1.1" },
  { path: "SquirrelStore.m", kind: "compile", why: "registers the store with Capacitor" },
  { path: "SquirrelCalendar.swift", kind: "compile", why: "EventKit, the reason to ship native" },
  { path: "SquirrelCalendar.m", kind: "compile", why: "registers the calendar with Capacitor" },
  { path: "PrivacyInfo.xcprivacy", kind: "resource", why: "required for submission" },
];

const proj = xcode.project(PROJECT);
proj.parseSync();

const missing = [];
const added = [];

/** Is this file already in a build phase of any target? */
function alreadyBuilt(name) {
  const files = proj.pbxBuildFileSection();
  return Object.entries(files).some(
    ([key, v]) => !key.endsWith("_comment") && typeof v === "object" && v.fileRef_comment === name,
  );
}

const appGroup = proj.pbxGroupByName("App");
if (!appGroup) throw new Error("no 'App' group in the project — has it been renamed?");

/**
 * Add a file to Copy Bundle Resources, by hand.
 *
 * `addResourceFile` in the `xcode` package assumes a group literally named
 * "Resources" and dereferences it without checking; this project, like every
 * Capacitor project, does not have one, so the helper throws before it does
 * anything. The objects it would have written are four, they are simple, and
 * writing them directly is less fragile than inventing a group to satisfy a
 * lookup.
 *
 * Anything not in this phase is not in the bundle — which for a privacy
 * manifest means an upload refused over a file sitting in plain sight in the
 * repository, and that is a genuinely confusing hour.
 */
function addResource(name) {
  const objects = proj.hash.project.objects;
  const fileRef = proj.generateUuid();
  const buildFile = proj.generateUuid();
  const label = `${name} in Resources`;

  objects.PBXFileReference[fileRef] = {
    isa: "PBXFileReference",
    lastKnownFileType: "text.plist.xml",
    path: name,
    sourceTree: '"<group>"',
  };
  objects.PBXFileReference[`${fileRef}_comment`] = name;

  objects.PBXBuildFile[buildFile] = { isa: "PBXBuildFile", fileRef, fileRef_comment: name };
  objects.PBXBuildFile[`${buildFile}_comment`] = label;

  appGroup.children.push({ value: fileRef, comment: name });

  let landed = false;
  for (const [key, phase] of Object.entries(objects.PBXResourcesBuildPhase)) {
    if (key.endsWith("_comment") || !Array.isArray(phase.files)) continue;
    phase.files.push({ value: buildFile, comment: label });
    landed = true;
  }
  if (!landed) throw new Error(`no resources build phase to put ${name} in`);
}

const groupKey = Object.entries(proj.hash.project.objects.PBXGroup).find(
  ([k, v]) => !k.endsWith("_comment") && v === appGroup,
)?.[0];

for (const file of APP_FILES) {
  if (!existsSync(`ios/App/App/${file.path}`)) {
    // A path in this list with no file behind it is a rename nobody finished.
    missing.push(`${file.path} — listed here but not on disk`);
    continue;
  }
  if (alreadyBuilt(file.path)) continue;

  if (check) {
    missing.push(`${file.path} — on disk, in no target (${file.why})`);
    continue;
  }

  if (file.kind === "compile") proj.addSourceFile(file.path, {}, groupKey);
  else addResource(file.path);
  added.push(file.path);
}

/**
 * The App Group, the entitlements file, and the Swift version.
 *
 * Set on every build configuration rather than just Release: a capability that
 * only exists in one of them is a feature that works for the person who
 * shipped it and for nobody testing it.
 */
const SETTINGS = {
  CODE_SIGN_ENTITLEMENTS: "App/App.entitlements",
  // The widget and the intents both read the shared container; without this on
  // the app target, every write is dropped and nothing says so.
  ENABLE_USER_SCRIPT_SANDBOXING: "NO",
};

const configs = proj.pbxXCBuildConfigurationSection();
let settingsTouched = 0;
for (const [key, config] of Object.entries(configs)) {
  if (key.endsWith("_comment") || !config.buildSettings) continue;
  if (config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER !== "com.squirrelll.app") continue;
  for (const [k, v] of Object.entries(SETTINGS)) {
    if (config.buildSettings[k] === v) continue;
    if (check) { missing.push(`build setting ${k} on ${config.name}`); continue; }
    config.buildSettings[k] = v;
    settingsTouched++;
  }
}

/**
 * The widget extension target, built here because nobody opens Xcode.
 *
 * An earlier version of this script left the target to Xcode's template on the
 * grounds that a widget extension is nine linked objects and a mistake in any
 * of them produces a project file Xcode refuses to open. That reasoning was
 * sound and the conclusion was wrong for this project: builds happen on
 * Codemagic from whatever is committed, so a step that only exists inside
 * Xcode is a step that never happens. The nine objects get written here.
 *
 * `addTarget` does most of it — the native target, its two build
 * configurations and their list, the product reference, and the
 * embed-app-extensions copy phase on the app. What it leaves is the three
 * build phases, the dependency, and a set of build settings whose defaults are
 * wrong for a widget.
 *
 * Idempotent like everything above: a project that already has the target is
 * left alone.
 */
const WIDGET = {
  name: "SquirrelWidget",
  bundleId: "com.squirrelll.app.SquirrelWidget",
  dir: "SquirrelWidget",
  sources: ["SquirrelWidget.swift"],
  resources: ["PrivacyInfo.xcprivacy"],
};

function hasTarget(name) {
  return Object.entries(proj.pbxNativeTargetSection()).some(
    ([k, v]) => !k.endsWith("_comment") && String(v.name).replace(/"/g, "") === name,
  );
}

function addWidgetTarget() {
  const target = proj.addTarget(WIDGET.name, "app_extension", WIDGET.dir, WIDGET.bundleId);

  // The three phases every compiled target needs. Frameworks stays empty:
  // WidgetKit and SwiftUI are system frameworks and link implicitly, and the
  // widget deliberately depends on no Capacitor package — it reads a summary
  // out of the shared container and draws it, nothing more.
  proj.addBuildPhase(WIDGET.sources.map((f) => `${WIDGET.dir}/${f}`),
    "PBXSourcesBuildPhase", "Sources", target.uuid);
  proj.addBuildPhase(WIDGET.resources.map((f) => `${WIDGET.dir}/${f}`),
    "PBXResourcesBuildPhase", "Resources", target.uuid);
  proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

  // The library types an unrecognised extension as `lastKnownFileType =
  // unknown` and writes a literal `explicitFileType = undefined`, which Xcode
  // reads as a real explicit type and honours over the guess. Harmless on most
  // files; this one is the privacy manifest, whose absence from the bundle is
  // an upload rejection, so it is named properly rather than left to luck.
  for (const [key, ref] of Object.entries(proj.pbxFileReferenceSection())) {
    if (key.endsWith("_comment")) continue;
    if (!String(ref.path).includes(`${WIDGET.dir}/PrivacyInfo.xcprivacy`)) continue;
    ref.lastKnownFileType = "text.plist.xml";
    delete ref.explicitFileType;
  }

  /**
   * The app must build the extension before embedding it. Without the
   * dependency the copy phase can run against a missing `.appex`, which fails
   * on a clean CI checkout and nowhere else — the one machine that matters
   * here, since nothing is built locally.
   *
   * The two empty sections are created first because `addTargetDependency`
   * checks for them and, finding neither, returns successfully having done
   * nothing at all:
   *
   *     if (pbxContainerItemProxySection && pbxTargetDependencySection) { … }
   *
   * A project that has never had a second target has neither section, which is
   * every single-target Capacitor app. It cost one silent no-op to find, and
   * the assertion after this call is there so it cannot cost a second.
   */
  const objects = proj.hash.project.objects;
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};
  proj.addTargetDependency(proj.getFirstTarget().uuid, [target.uuid]);

  if (!proj.getFirstTarget().firstTarget.dependencies.length) {
    throw new Error("the app target did not take a dependency on the widget");
  }

  /**
   * The settings `addTarget` cannot know.
   *
   * INFOPLIST_FILE is the one that bites: the library writes
   * `SquirrelWidget/SquirrelWidget-Info.plist`, following an older Xcode
   * naming convention, and the file in this repository is `Info.plist`. A
   * missing plist does not fail the build — Xcode generates an empty one — and
   * the extension ships without `NSExtensionPointIdentifier`, which means iOS
   * never recognises it as a widget and it simply never appears.
   */
  const settings = {
    INFOPLIST_FILE: `${WIDGET.dir}/Info.plist`,
    CODE_SIGN_ENTITLEMENTS: `${WIDGET.dir}/SquirrelWidget.entitlements`,
    PRODUCT_BUNDLE_IDENTIFIER: WIDGET.bundleId,
    // WidgetKit's containerBackground is 17.0, same floor as the app.
    IPHONEOS_DEPLOYMENT_TARGET: "17.0",
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: '"1,2"',
    // Must match the app exactly or the upload is refused for a version
    // mismatch between a bundle and its extension. Both read the same
    // settings, so they cannot drift.
    MARKETING_VERSION: "$(MARKETING_VERSION)",
    CURRENT_PROJECT_VERSION: "$(CURRENT_PROJECT_VERSION)",
    // The plist in the repository is the plist that ships. Left on, Xcode
    // synthesises its own and silently wins.
    GENERATE_INFOPLIST_FILE: "NO",
    SKIP_INSTALL: "YES",
    ALWAYS_SEARCH_USER_PATHS: "NO",
    CLANG_ENABLE_MODULES: "YES",
    ENABLE_USER_SCRIPT_SANDBOXING: "NO",
  };

  const list = proj.pbxXCBuildConfigurationSection();
  for (const [key, config] of Object.entries(list)) {
    if (key.endsWith("_comment") || !config.buildSettings) continue;
    if (config.buildSettings.PRODUCT_NAME !== `"${WIDGET.name}"`) continue;
    Object.assign(config.buildSettings, settings);
  }

  return target;
}

if (!hasTarget(WIDGET.name)) {
  if (check) {
    missing.push(`the ${WIDGET.name} extension target`);
  } else {
    addWidgetTarget();
    added.push(`${WIDGET.name} extension target (+ embed phase on the app)`);
  }
}

if (check) {
  if (missing.length) {
    console.error("Xcode project is missing:");
    for (const m of missing) console.error(`  ✗  ${m}`);
    process.exit(1);
  }
  console.log("Xcode project: everything wired");
  process.exit(0);
}

if (added.length || settingsTouched) {
  writeFileSync(PROJECT, proj.writeSync());
  for (const a of added) console.log(`  +  ${a}`);
  if (settingsTouched) console.log(`  +  ${settingsTouched} build settings (entitlements, App Group)`);
} else {
  console.log("Xcode project: already wired, nothing to do");
}

// A corrupt pbxproj does not announce itself until somebody opens Xcode, which
// may be days later and on another machine. Re-parsing what was just written
// is the cheapest possible proof that it is still a project file.
try {
  const reread = xcode.project(PROJECT);
  reread.parseSync();
  if (!reread.pbxGroupByName("App")) throw new Error("group lost");
  console.log(`Xcode project: verified (App Group ${APP_GROUP})`);
} catch (e) {
  console.error(`\nThe project file did not survive the edit: ${e.message}`);
  console.error("Restore it with: git checkout -- " + PROJECT);
  process.exit(1);
}

void execFileSync;
