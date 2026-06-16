// Map a DeviceOrientation beta angle (front/back tilt, degrees) to a gesture.
// The phone is held to the forehead in landscape; tilting the top away from the
// face (beta strongly positive) = "down"/pass, toward = "up"/correct. A wide
// dead-zone in the middle avoids accidental triggers.
export const TILT_UP_THRESHOLD = -45; // beta below this => up (correct)
export const TILT_DOWN_THRESHOLD = 45; // beta above this => down (pass)

export function tiltDirection(beta: number): "up" | "down" | null {
  if (beta <= TILT_UP_THRESHOLD) return "up";
  if (beta >= TILT_DOWN_THRESHOLD) return "down";
  return null;
}
