// Operate the visible select interface in both native and Radix-backed fixtures.
export async function chooseSelect(page, selector, value) {
  const trigger = await page.waitForSelector(selector, { visible: true });
  if (await trigger.evaluate(element => element.tagName === 'SELECT')) return page.select(selector, value);
  await trigger.scrollIntoView();
  const activate = async element => {
    if (page.viewport()?.hasTouch) {
      const bounds = await element.boundingBox();
      await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    } else await element.click();
  };
  await activate(trigger);
  await page.waitForSelector('[role="listbox"]', { visible: true });
  const options = await page.$$('[role="option"]');
  for (const option of options) {
    if (await option.evaluate((element, value) => element.getAttribute('data-option-value') === value, value)) {
      await option.scrollIntoView();
      await activate(option);
      await page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
      return;
    }
  }
  throw Error(`Missing select option: ${value}`);
}
