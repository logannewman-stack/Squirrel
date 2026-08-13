/**
 * Get past the welcome, for suites that are testing something else.
 *
 * Onboarding is the only screen every other end-to-end test has to walk
 * through before it can begin, which made its buttons a shared dependency that
 * nobody owned: the step count changed, and three suites failed on a selector
 * for a button that no longer existed — none of which were testing onboarding.
 *
 * So the walk lives here, once. `onboarding.e2e.mjs` deliberately does *not*
 * use it — that suite is the one asserting on each step, and a helper that
 * papered over a change there would defeat the point.
 *
 * @param {import("playwright").Page} page
 * @param {{surname?: string, coach?: boolean}} [opts]
 *   coach — leave the first-plan card up. Only `flow.e2e.mjs` wants this; it
 *   is the suite that tests the card itself.
 */
export async function skipOnboarding(page, { surname = "Newman", coach = false } = {}) {
  // 1. Identity.
  await page.getByRole("button", { name: "Mr." }).click();
  await page.getByPlaceholder("Surname").fill(surname);
  await page.getByRole("button", { name: "Continue" }).click();

  // 2. Working hours — the defaults are fine for anything downstream.
  await page.getByRole("button", { name: "Continue" }).click();

  // 3. The assistant demo. Skipped rather than played: a suite that wanted a
  //    meeting would have seeded its own, and one that did not must not start
  //    with a stray one on the calendar.
  await page.getByRole("button", { name: "Skip for now" }).click();

  // 4. The account — only where there is a backend to sign into. Builds
  //    without one finish at step 3, so this step may not exist at all.
  const notNow = page.getByRole("button", { name: /^Not now/ });
  if (await notNow.count()) await notNow.click();

  // 5. The first-plan card, which is not onboarding but is on the screen the
  //    instant onboarding ends. It carries its own textbox and its own
  //    add-shaped button, and those collide in strict mode with the ones every
  //    other suite is actually reaching for — `getByRole("textbox")` finding
  //    two elements, one of them a coach nobody asked about. Dismissed by
  //    default for the same reason the walk above lives here: a screen that is
  //    merely in the way should be one suite's problem, not everybody's.
  if (!coach) {
    const ownWay = page.getByRole("button", { name: /my own way/i });
    if (await ownWay.count()) await ownWay.click();
  }

  await page.waitForTimeout(250);
}
