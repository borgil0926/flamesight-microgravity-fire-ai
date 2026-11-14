// Shared cabin environment, so a scenario set on one page carries to the others.
import { HABITATS } from './data.js';

const listeners = new Set();
const iss = HABITATS[0];
export const env = { habitat: iss.id, o2: iss.o2, pressure: iss.pressure, gravity: iss.gravity, flow: iss.flow };

export function setEnv(patch) {
  Object.assign(env, patch);
  for (const fn of listeners) fn(env);
}
export function onEnv(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
