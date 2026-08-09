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
 * @param {{surname?: string}} [opts]
 */
export async function skipOnboarding(page, { surname = "Newman" } = {}) {
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

  await page.waitForTimeout(250);
}
