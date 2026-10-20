export type CanvasInputMode = "finger" | "pen";
export type InputPointerType = "pen" | "touch" | "mouse" | "unknown";
type PointerRole = "edit" | "pan" | "gesture" | "blocked";
type InputPointer = { pointerId: number; pointerType: string; clientX: number; clientY: number; button: number };
type TrackedPointer = { type: InputPointerType; role: PointerRole; x: number; y: number };

export const INPUT_MODE_STORAGE_KEY = "homeruai.input-mode.v1";
export function parseInputMode(value: string | null): CanvasInputMode | null {
  return value === "finger" || value === "pen" ? value : null;
}
export function normalizePointerType(type: string): InputPointerType {
  return type === "pen" || type === "touch" || type === "mouse" ? type : "unknown";
}

/** One editing owner. Rejected contacts stay rejected until they lift. */
export class CanvasInputRouter {
  mode: CanvasInputMode | null = "pen";
  pointers = new Map<number, TrackedPointer>();
  owner: number | null = null;
  gesture = false;
  reason = "ready";
  ignoredTouches = 0;

  changeMode(mode: CanvasInputMode | null): boolean {
    if (this.mode === mode) return false;
    this.mode = mode;
    const hadOwner = this.owner !== null;
    this.owner = null;
    this.gesture = false;
    for (const pointer of this.pointers.values()) pointer.role = "blocked";
    this.reason = "mode_changed";
    return hadOwner;
  }

  down(event: InputPointer, mousePan = false) {
    const type = normalizePointerType(event.pointerType);
    const entry: TrackedPointer = { type, role: "blocked", x: event.clientX, y: event.clientY };
    const result = { action: "ignore" as "ignore" | "choose" | "edit" | "pan" | "gesture", cancel: false, penDetected: false };
    if (this.pointers.has(event.pointerId)) return result;
    this.pointers.set(event.pointerId, entry);
    const activeOwner = this.owner === null ? undefined : this.pointers.get(this.owner);
    const block = (reason: string) => {
      this.reason = reason;
      if (type === "touch") this.ignoredTouches++;
      return result;
    };
    if (type === "pen") {
      if (activeOwner?.type === "pen") return block("another_pen_active");
      result.cancel = this.owner !== null || this.gesture;
      for (const pointer of this.pointers.values()) pointer.role = "blocked";
      this.gesture = false;
      this.owner = event.pointerId;
      entry.role = "edit";
      result.action = "edit";
      result.penDetected = this.mode !== "pen";
      this.mode = "pen";
      this.reason = "pen_priority";
      return result;
    }
    if (type === "touch") {
      if (activeOwner && activeOwner.type !== "touch") return block("other_input_active");
      const touches = [...this.pointers.values()].filter(pointer => pointer.type === "touch");
      if (touches.some(pointer => pointer !== entry && pointer.role === "blocked")) return block("wait_for_all_fingers_up");
      if (this.mode === null) {
        this.reason = "choose_input_mode";
        result.action = "choose";
        return result;
      }
      if (touches.length > 2) {
        result.cancel = this.owner !== null || this.gesture;
        this.owner = null;
        this.gesture = true;
        for (const pointer of touches) pointer.role = "blocked";
        return block("too_many_touches");
      }
      if (touches.length === 2) {
        result.cancel = this.owner !== null;
        this.owner = null;
        this.gesture = true;
        for (const pointer of touches) pointer.role = "gesture";
        this.reason = "two_finger_gesture";
        result.action = "gesture";
        return result;
      }
      if (this.gesture) return block("wait_for_all_fingers_up");
      if (this.mode === "finger") {
        this.owner = event.pointerId;
        entry.role = "edit";
        result.action = "edit";
        this.reason = "finger_edit";
      } else {
        entry.role = "pan";
        result.action = "pan";
        this.reason = "finger_navigation";
      }
      return result;
    }
    if (type !== "mouse") return block("unknown_input");
    if (this.owner !== null || this.pointers.size > 1) return block("other_input_active");
    if (!mousePan && event.button !== 0) return block("unsupported_button");
    this.owner = event.pointerId;
    entry.role = mousePan ? "pan" : "edit";
    result.action = entry.role;
    this.reason = mousePan ? "mouse_navigation" : "mouse_edit";
    return result;
  }

  move(event: Pick<InputPointer, "pointerId" | "clientX" | "clientY">): PointerRole | undefined {
    const pointer = this.pointers.get(event.pointerId);
    if (pointer) { pointer.x = event.clientX; pointer.y = event.clientY; }
    return pointer?.role;
  }

  end(pointerId: number): PointerRole | undefined {
    const pointer = this.pointers.get(pointerId);
    if (!pointer) return undefined;
    const role = pointer.role;
    this.pointers.delete(pointerId);
    if (this.owner === pointerId) this.owner = null;
    if (pointer.type === "touch") {
      const touches = [...this.pointers.values()].filter(item => item.type === "touch");
      if (this.gesture) for (const item of touches) item.role = "blocked";
      if (touches.length === 0) this.gesture = false;
    }
    return role;
  }

  navigationPoints() {
    return [...this.pointers.values()].filter(pointer => pointer.role === "gesture" || pointer.role === "pan");
  }

  reset() {
    this.pointers.clear();
    this.owner = null;
    this.gesture = false;
    this.reason = "input_interrupted";
  }
}
