import { test } from "node:test";
import assert from "node:assert/strict";
import { CanvasInputRouter, parseInputMode } from "../src/utils/canvasInput.ts";
import { commitStrokeAction, undoLastStrokeAction } from "../src/utils/strokeHistory.ts";

const pointer = (id, type = "touch", x = 10, y = 10, button = 0) => ({ pointerId: id, pointerType: type, clientX: x, clientY: y, button });
const fingerRouter = () => { const router = new CanvasInputRouter(); router.changeMode("finger"); return router; };

test("unselected touch asks for a mode, but mouse works without choosing", () => {
  const router = new CanvasInputRouter();
  router.changeMode(null);
  assert.equal(router.down(pointer(1)).action, "choose");
  router.end(1);
  assert.equal(router.down(pointer(2, "mouse")).action, "edit");
});
test("a finger edit belongs to one pointer and commits only once", () => {
  const router = fingerRouter();
  assert.equal(router.down(pointer(1)).action, "edit");
  assert.equal(router.move(pointer(1)), "edit");
  assert.equal(router.end(1), "edit");
  assert.equal(router.end(1), undefined);
});
test("second finger cancels editing; neither remaining finger nor a new contact resumes it", () => {
  const router = fingerRouter();
  router.down(pointer(1));
  const second = router.down(pointer(2));
  assert.equal(second.action, "gesture");
  assert.equal(second.cancel, true);
  assert.equal(router.owner, null);
  assert.equal(router.end(2), "gesture");
  assert.equal(router.move(pointer(1)), "blocked");
  assert.equal(router.down(pointer(3)).action, "ignore");
  router.end(1); router.end(3);
  assert.equal(router.down(pointer(4)).action, "edit");
});
test("three fingers stop navigation until all lift", () => {
  const router = fingerRouter();
  router.down(pointer(1)); router.down(pointer(2));
  assert.equal(router.down(pointer(3)).action, "ignore");
  assert.equal(router.navigationPoints().length, 0);
  router.end(3); router.end(2);
  assert.equal(router.move(pointer(1)), "blocked");
  router.end(1);
  assert.equal(router.down(pointer(4)).action, "edit");
});
test("pen preempts finger and keeps palm blocked after pen-up", () => {
  const router = fingerRouter();
  router.down(pointer(1));
  const pen = router.down(pointer(2, "pen"));
  assert.equal(pen.cancel, true);
  assert.equal(pen.penDetected, true);
  assert.equal(router.mode, "pen");
  assert.equal(router.move(pointer(1)), "blocked");
  assert.equal(router.down(pointer(3)).action, "ignore");
  router.end(2);
  assert.equal(router.move(pointer(1)), "blocked");
  assert.equal(router.down(pointer(4)).action, "ignore");
  router.end(1); router.end(3); router.end(4);
  assert.equal(router.down(pointer(5)).action, "pan");
});
test("palm ending cannot terminate a pen or a pen selection", () => {
  const router = new CanvasInputRouter();
  router.down(pointer(1, "pen"));
  assert.equal(router.down(pointer(2)).action, "ignore");
  assert.equal(router.end(2), "blocked");
  assert.equal(router.owner, 1);
  assert.equal(router.move(pointer(1, "pen")), "edit");
});
test("pen interrupts navigation without accepting already-held fingers", () => {
  const router = new CanvasInputRouter();
  assert.equal(router.down(pointer(1)).action, "pan");
  router.down(pointer(2));
  assert.equal(router.down(pointer(3, "pen")).cancel, true);
  assert.equal(router.navigationPoints().length, 0);
  router.end(3);
  assert.equal(router.move(pointer(1)), "blocked");
});
test("mouse remains usable in pen mode and supports explicit pan", () => {
  const router = new CanvasInputRouter();
  assert.equal(router.down(pointer(1, "mouse")).action, "edit");
  router.end(1);
  assert.equal(router.down(pointer(2, "mouse", 0, 0, 2), true).action, "pan");
  router.end(2);
  assert.equal(router.down(pointer(3, "mouse", 0, 0, 2)).action, "ignore");
});
test("mouse/touch cannot steal pen; unknown devices fail closed", () => {
  const router = new CanvasInputRouter();
  router.down(pointer(1, "pen"));
  assert.equal(router.down(pointer(2, "mouse")).action, "ignore");
  assert.equal(router.down(pointer(3, "")).action, "ignore");
  assert.equal(router.owner, 1);
});
test("explicit mode change does not reuse a contact already on screen", () => {
  const router = new CanvasInputRouter();
  router.down(pointer(1));
  router.changeMode("finger");
  assert.equal(router.move(pointer(1)), "blocked");
  router.end(1);
  assert.equal(router.down(pointer(2)).action, "edit");
});
test("reset recovers from interrupted input without forgetting mode", () => {
  const router = fingerRouter();
  router.down(pointer(1)); router.reset();
  assert.equal(router.pointers.size, 0);
  assert.equal(router.owner, null);
  assert.equal(router.mode, "finger");
  assert.equal(router.down(pointer(2)).action, "edit");
});
test("settings reject corrupt/unrecognized values", () => {
  for (const value of [null, "", "auto", "{}", '"finger"']) assert.equal(parseInputMode(value), null);
  assert.equal(parseInputMode("finger"), "finger");
  assert.equal(parseInputMode("pen"), "pen");
});

const original = { strokeId: "original", type: "draw", startTime: 1, endTime: 2, points: [{ x: 1, y: 1, p: 0.5, t: 0 }] };
test("object erase is atomic and undo restores the original", () => {
  const pending = { ...original, strokeId: "eraser", type: "erase", startTime: 3, targetStrokeIds: ["original"], inputType: "touch", inputMode: "finger" };
  const before = [original];
  // A cancelled gesture never calls commit, so even its target remains unchanged.
  assert.equal(before[0].isErased, undefined);
  const after = commitStrokeAction(before, pending, 4);
  assert.equal(before[0].isErased, undefined);
  assert.equal(after[0].isErased, true);
  assert.equal(after[1].endTime, 4);
  assert.equal(after[1].inputType, "touch");
  const undone = undoLastStrokeAction(after, 5);
  assert.equal(undone[0].isErased, false);
  assert.equal(undone[1].isErased, true);
});
test("pixel erase retains its event without logically deleting whole strokes", () => {
  const after = commitStrokeAction([original], { ...original, strokeId: "pixel", type: "pixel-erase", startTime: 3, targetStrokeIds: ["original"] }, 4);
  assert.equal(after[0].isErased, undefined);
  assert.equal(after[1].type, "pixel-erase");
});
test("committed erasure keeps its actual contact time for replay", () => {
  const eraser = { ...original, strokeId: "erase", type: "erase", startTime: 3, targetStrokeIds: ["original"] };
  const after = commitStrokeAction([original], eraser, 10, new Map([["original", 4]]));
  assert.equal(after[0].erasedAt, 4);
  assert.equal(after[1].endTime, 10);
});
test("older strokes remain compatible and draw metadata survives", () => {
  const after = commitStrokeAction([original], { ...original, strokeId: "new", inputType: "pen", inputMode: "pen" }, 4);
  assert.deepEqual(after[0], original);
  assert.equal(after[1].inputType, "pen");
});
