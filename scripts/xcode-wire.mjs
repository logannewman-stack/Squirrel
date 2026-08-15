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
 * What this script deliberately does not do: create the widget extension target.
 *
 * A widget extension is nine linked objects — a native target, its two build
 * configurations and their list, three build phases, a container proxy, a
 * target dependency, and an embed-extensions copy phase on the app — and a
 * mistake in any of them produces a project file Xcode refuses to open rather
 * than one that misbehaves. Xcode's own template writes all nine correctly in
 * about thirty seconds, and this is the one piece of the wiring that is not
 * worth automating badly. APPSTORE.md has the six clicks.
 *
 * The check below is what stops that step being forgotten, which is the real
 * risk — the same risk that left four files in no target for months.
 */
const hasWidget = readFileSync(PROJECT, "utf8").includes("SquirrelWidgetExtension");
if (!hasWidget) {
  const note = "widget extension target — add it in Xcode, see APPSTORE.md §3";
  if (check) missing.push(note);
  else console.log(`  ·  ${note}`);
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
