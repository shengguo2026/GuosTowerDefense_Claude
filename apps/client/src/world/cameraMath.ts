export interface CameraState {
  /** Point on the ground the camera looks at. */
  x: number;
  z: number;
  /** Angle around the vertical axis; 0 looks towards -z from the +z side. */
  yaw: number;
  /** Angle above the horizon. */
  pitch: number;
  distance: number;
}

export interface CameraLimits {
  minPitch: number;
  maxPitch: number;
  minDistance: number;
  maxDistance: number;
  /** The look-at point stays within ±bounds on both axes. */
  bounds: number;
}

export const DEFAULT_LIMITS: Omit<CameraLimits, 'bounds'> = {
  minPitch: (28 * Math.PI) / 180,
  maxPitch: (72 * Math.PI) / 180,
  minDistance: 22,
  maxDistance: 150,
};

/** Keeps the strategic camera within useful angles and on the map (spec §15). */
export function clampCamera(state: CameraState, limits: CameraLimits): CameraState {
  return {
    x: clamp(state.x, -limits.bounds, limits.bounds),
    z: clamp(state.z, -limits.bounds, limits.bounds),
    yaw: wrapAngle(state.yaw),
    pitch: clamp(state.pitch, limits.minPitch, limits.maxPitch),
    distance: clamp(state.distance, limits.minDistance, limits.maxDistance),
  };
}

/** Camera position for a state. */
export function cameraPosition(state: CameraState, groundHeight = 0): { x: number; y: number; z: number } {
  const horizontal = Math.cos(state.pitch) * state.distance;
  return {
    x: state.x + Math.sin(state.yaw) * horizontal,
    y: groundHeight + Math.sin(state.pitch) * state.distance,
    z: state.z + Math.cos(state.yaw) * horizontal,
  };
}

/**
 * Moves the look-at point for a screen drag so the ground follows the pointer: dragging right moves the view left.
 * `dx`/`dy` are in pixels, `viewHeight` the canvas height in pixels.
 */
export function panByScreen(
  state: CameraState,
  dx: number,
  dy: number,
  viewHeight: number,
  fovRadians: number,
): CameraState {
  const worldPerPixel = (2 * state.distance * Math.tan(fovRadians / 2)) / viewHeight;
  const right = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };
  const forward = { x: -Math.sin(state.yaw), z: -Math.cos(state.yaw) };
  // Dragging up should move further away; the ground is foreshortened by the pitch.
  const forwardScale = worldPerPixel / Math.max(0.35, Math.sin(state.pitch));
  return {
    ...state,
    x: state.x - right.x * dx * worldPerPixel + forward.x * dy * forwardScale,
    z: state.z - right.z * dx * worldPerPixel + forward.z * dy * forwardScale,
  };
}

/** Moves the look-at point by world units along the camera's right/forward axes (edge pan, keys). */
export function panByWorld(state: CameraState, right: number, forward: number): CameraState {
  return {
    ...state,
    x: state.x + Math.cos(state.yaw) * right - Math.sin(state.yaw) * forward,
    z: state.z - Math.sin(state.yaw) * right - Math.cos(state.yaw) * forward,
  };
}

/** Eases one state towards another; `t` in [0, 1]. Yaw takes the short way round. */
export function blendCamera(from: CameraState, to: CameraState, t: number): CameraState {
  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
    yaw: from.yaw + wrapAngle(to.yaw - from.yaw) * t,
    pitch: from.pitch + (to.pitch - from.pitch) * t,
    distance: from.distance + (to.distance - from.distance) * t,
  };
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
