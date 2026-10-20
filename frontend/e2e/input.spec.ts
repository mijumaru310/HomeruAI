import { test, expect, type Page } from "@playwright/test";
import type { Stroke } from "../src/types/canvas";

const key = "homeruai.input-mode.v1";
const canvas = (page: Page) => page.locator("#homeruai-canvas");
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page)!.push(error.message));
  // Tests never write research telemetry or call a paid AI provider.
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("dashboard") ? null : {} }));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function open(page: Page, mode?: "finger" | "pen", url = "/") {
  if (mode) await page.addInitScript(({ key, mode }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, mode);
  }, { key, mode });
  await page.goto(url);
  await expect(canvas(page)).toBeVisible();
  if (mode && url === "/") await expect(page.getByRole("button", { name: mode === "finger" ? "指で書く" : "ペン専用", exact: true })).toHaveAttribute("aria-pressed", "true");
}

async function input(page: Page, type: string, id: number, phase: "down" | "move" | "up" | "cancel", x = 100, y = 150) {
  const box = (await canvas(page).boundingBox())!;
  await canvas(page).dispatchEvent(`pointer${phase}`, {
    pointerId: id, pointerType: type, button: 0, buttons: phase === "up" || phase === "cancel" ? 0 : 1,
    clientX: box.x + x, clientY: box.y + y, pressure: type === "pen" ? 0.65 : 0.5,
    isPrimary: id === 1,
  });
}
async function draw(page: Page, type = "touch", id = 1) {
  await input(page, type, id, "down");
  await input(page, type, id, "move", 150, 170);
  await input(page, type, id, "up", 150, 170);
}

async function workspace(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("homeruai-notebook", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ sections: { pages: { id: string; strokes: Stroke[]; texts: { x: number; y: number }[] }[] }[]; activePageId: string; pageTransforms: Record<string, { pan: { x: number; y: number }; zoom: number }> } | undefined>((resolve, reject) => {
        const request = db.transaction("workspace", "readonly").objectStore("workspace").get("current");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}
async function strokes(page: Page) {
  const saved = await workspace(page);
  return saved?.sections.flatMap(section => section.pages).find(note => note.id === saved.activePageId)?.strokes ?? [];
}
async function count(page: Page, n: number) { await expect.poll(async () => (await strokes(page)).length).toBe(n); }

test("mouse draws without choosing a touch mode and works in pen mode", async ({ page }) => {
  await open(page);
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 150);
  await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 170, { steps: 4 }); await page.mouse.up();
  await count(page, 1);
  expect((await strokes(page))[0].inputType).toBe("mouse");
  await page.getByRole("button", { name: "ペン専用", exact: true }).click();
  await draw(page, "mouse", 2);
  await count(page, 2);
});

test("first touch prompts for a mode and never creates a stroke", async ({ page }) => {
  await open(page);
  await input(page, "touch", 1, "down");
  await expect(page.getByText("指で書くか、ペンで書くかを選んでください。", { exact: true })).toBeVisible();
  await input(page, "touch", 1, "up");
  await page.getByRole("button", { name: "指で書く", exact: true }).click();
  await draw(page);
  await count(page, 1);
  expect((await strokes(page))[0].inputType).toBe("touch");
  expect((await strokes(page))[0].inputMode).toBe("finger");
  await page.reload();
  await expect(page.getByRole("button", { name: "指で書く", exact: true })).toHaveAttribute("aria-pressed", "true");
  await count(page, 1);
});

test("two fingers cancel provisional drawing and do not resume with one left", async ({ page }) => {
  await open(page, "finger");
  await draw(page);
  await count(page, 1);
  await input(page, "touch", 2, "down");
  await input(page, "touch", 2, "move", 120, 165);
  await input(page, "touch", 3, "down", 210, 190);
  await input(page, "touch", 3, "move", 230, 210);
  await input(page, "touch", 3, "up", 230, 210);
  await input(page, "touch", 2, "move", 180, 175);
  await input(page, "touch", 2, "up", 180, 175);
  await draw(page, "touch", 4);
  await count(page, 2);
  expect((await strokes(page)).map(stroke => stroke.type)).toEqual(["draw", "draw"]);
  const saved = await workspace(page);
  expect(saved?.pageTransforms[saved.activePageId]?.zoom).not.toBe(1);
});

test("two fingers cancel object erasing without modifying deletion history", async ({ page }) => {
  await open(page, "finger"); await draw(page); await count(page, 1);
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await input(page, "touch", 2, "down");
  await input(page, "touch", 3, "down", 210, 190);
  await input(page, "touch", 3, "up", 210, 190);
  await input(page, "touch", 2, "up");
  await page.getByRole("button", { name: "ペン", exact: true }).click();
  await draw(page, "touch", 4); await count(page, 2);
  expect((await strokes(page))[0].isErased).not.toBe(true);
  expect((await strokes(page)).every(stroke => stroke.type === "draw")).toBe(true);
});

test("finger erase commits and undo restores the note", async ({ page }) => {
  await open(page, "finger"); await draw(page); await count(page, 1);
  await page.getByRole("button", { name: "消しゴム", exact: true }).click();
  await input(page, "touch", 2, "down"); await input(page, "touch", 2, "up");
  await count(page, 2);
  expect((await strokes(page))[0].isErased).toBe(true);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect.poll(async () => (await strokes(page))[0]?.isErased).toBe(false);
});

test("pen takes priority, blocks a palm, and never auto-unlocks finger drawing", async ({ page }) => {
  await open(page, "finger");
  await input(page, "touch", 1, "down");
  await input(page, "pen", 2, "down");
  await expect(page.getByRole("button", { name: "ペン専用", exact: true })).toHaveAttribute("aria-pressed", "true");
  await input(page, "touch", 3, "down", 200, 200);
  await input(page, "touch", 3, "up", 200, 200);
  await input(page, "pen", 2, "move", 150, 170);
  await input(page, "pen", 2, "up", 150, 170);
  await input(page, "touch", 1, "move", 200, 200);
  await input(page, "touch", 1, "up", 200, 200);
  await draw(page, "pen", 4); await count(page, 2);
  expect((await strokes(page)).every(stroke => stroke.inputType === "pen")).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "ペン専用", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("touch cancellation drops provisional ink; the next stroke works", async ({ page }) => {
  await open(page, "finger");
  await input(page, "touch", 1, "down"); await input(page, "touch", 1, "cancel");
  await draw(page, "touch", 2); await count(page, 1);
});

test("browser-generated touch taps draw without duplicate mouse strokes", async ({ page }) => {
  await open(page, "finger");
  const box = (await canvas(page).boundingBox())!;
  await page.touchscreen.tap(box.x + 100, box.y + 150);
  await count(page, 1);
  expect((await strokes(page))[0].inputType).toBe("touch");
});

test("explicit mode switch never reuses a finger already touching the canvas", async ({ page }) => {
  await open(page, "pen");
  await input(page, "touch", 1, "down");
  await page.getByRole("button", { name: "指で書く", exact: true }).click();
  await input(page, "touch", 1, "move", 150, 170);
  await input(page, "touch", 1, "up", 150, 170);
  await draw(page, "touch", 2); await count(page, 1);
});

test("pen cancellation saves the partial stroke once and allows the next stroke", async ({ page }) => {
  await open(page, "pen");
  await input(page, "pen", 1, "down");
  await input(page, "pen", 1, "move", 150, 170);
  await input(page, "pen", 1, "cancel", 150, 170);
  await input(page, "pen", 1, "up", 150, 170);
  await draw(page, "pen", 2); await count(page, 2);
});

test("input-mode storage failure is explained without blocking finger drawing", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "homeruai.input-mode.v1") throw new DOMException("Test storage denied", "SecurityError");
      originalSet.call(this, key, value);
    };
  });
  await open(page);
  await page.getByRole("button", { name: "指で書く", exact: true }).click();
  await expect(page.getByText("設定を保存できないため、この画面でのみ適用します。", { exact: true })).toBeVisible();
  await draw(page); await count(page, 1);
});

test("unrelated pointer-up cannot commit a selection drag", async ({ page }) => {
  await open(page, "pen"); await draw(page, "pen"); await count(page, 1);
  // Select the preset problem text and drag it with the pen.
  await page.getByRole("button", { name: "選択", exact: true }).click();
  await input(page, "pen", 2, "down", 80, 50);
  await input(page, "pen", 2, "move", 120, 80);
  await input(page, "touch", 3, "down"); await input(page, "touch", 3, "up");
  await input(page, "pen", 2, "move", 150, 100);
  await input(page, "pen", 2, "up", 150, 100);
  await expect.poll(async () => {
    const saved = await workspace(page);
    return saved?.sections.flatMap(section => section.pages).find(note => note.id === saved.activePageId)?.texts[0];
  }).toMatchObject({ x: 130, y: 90 });
  await page.getByRole("button", { name: "ペン", exact: true }).click();
  await draw(page, "pen", 4); await count(page, 2);
});

test("mobile controls stay visible and the canvas remains usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const button = page.getByRole("button", { name: "指で書く", exact: true });
  await expect(button).toBeInViewport();
  await button.click();
  const box = (await canvas(page).boundingBox())!;
  expect(box.height).toBeGreaterThan(100);
  expect(box.width).toBeGreaterThan(150);
  await draw(page); await count(page, 1);
  await page.screenshot({ path: testInfo.outputPath("input-mode-mobile.png") });
});

test("experiment keeps pen-only behavior without a new input-mode choice", async ({ page }) => {
  await open(page, "finger", "/?experiment=1&participant=TEST_INPUT&studySet=easy&studyFeedback=praise");
  await expect(page.getByRole("region", { name: "ノートの入力方法" })).toHaveCount(0);
  await input(page, "touch", 1, "down"); await input(page, "touch", 1, "up");
  await expect(page.getByText("0本の一歩を記録中", { exact: true })).toHaveCount(0);
  await draw(page, "pen", 2);
  await expect(page.getByText("1本の一歩を記録中", { exact: true })).toBeVisible();
});
