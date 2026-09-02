// Every browser suite enters a level its own way — page.click, page.tap,
// locator().first().click(), a click inside page.evaluate, and two suites that
// join the flow half-way with their own assertions in between. There is no one
// entry sequence to extract, so this helper covers only the part they all share
// now that a level opens HELD: start the run and open the caravan's hatch.
//
// Both calls are no-ops on a level that is already running with an open hatch, so
// a suite may call this whether or not the level it entered musters.
export async function beginRun(page) {
  await page.waitForFunction(() => window.__smallhands?.begin, { timeout: 8000 });
  await page.evaluate(() => {
    window.__smallhands.begin();
    window.__smallhands.setShipping(true);
  });
}
