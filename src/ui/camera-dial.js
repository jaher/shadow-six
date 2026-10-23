/**
 * Camera dial: a camera-orientation control in the top bar's icon row, seated
 * immediately LEFT of the eye icon (the eye stays the rightmost icon).
 *
 * The face follows the Blender view gizmo / 3ds Max ViewCube principle: a miniature
 * 3D projection, not a flat gauge. The ground plane is a disc flattened by the game's
 * OWN projection — vertical radius r*sin(pitch) — so the disc's fatness IS the pitch
 * readout (25 deg: thin sliver, 60 deg: near-round). Ground-fixed ticks + a brass north
 * arrow rotate with the camera yaw inside the disc and foreshorten with it; a fixed
 * centre mast (world vertical projects to screen vertical at any yaw/pitch) rises from
 * the disc centre so the tilt reads at a glance. The disc's far half is shaded.
 *
 * Interactions:
 *  - drag horizontally: yaw follows the drag (CameraRig.setYaw)
 *  - drag vertically: pitch follows (CameraRig.setPitch, 25-60, detent snap at the 40 home)
 *  - double-click: back to the defaults (CONFIG.camera yaw / pitch)
 * While the dial is dragged the rig's edge scroll is suspended, so grabbing the dial in the
 * corner never pans the map out from under the pointer; the settle also reports through
 * rig.onUserYaw, keeping the Options CAMERA ANGLE truthful like the hold-rotate keys do.
 * @module ui/camera-dial
 */
import { el } from './dom.js';
import { CONFIG } from '../config.js';

const PITCH_MIN = 25, PITCH_MAX = 60;
const DETENT = 1.2; // deg: pitch snaps to the home angle inside this window
const YAW_PER_PX = 0.4, PITCH_PER_PX = 0.22;
const wrap360 = (d) => ((d % 360) + 360) % 360;

// Ground-fixed ticks every 30 deg (cardinals longer) + a brass north arrow, drawn around
// the disc's own origin: the group rotates with yaw while the parent squash group flattens
// it by sin(pitch), so the ground markings sweep and foreshorten exactly like the terrain.
function groundSVG() {
  let s = '';
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180, long = a % 90 === 0;
    const r1 = long ? 12.8 : 14.6, r2 = 16.6;
    s += `<line x1="${(r1 * Math.sin(rad)).toFixed(1)}" y1="${(-r1 * Math.cos(rad)).toFixed(1)}" x2="${(r2 * Math.sin(rad)).toFixed(1)}" y2="${(-r2 * Math.cos(rad)).toFixed(1)}" stroke="#cfc7a8" stroke-width="${long ? 1.1 : 0.7}"/>`;
  }
  s += `<path d="M0 -16.6 L2.9 -11.8 L0 -13.4 L-2.9 -11.8 Z" fill="#ffcf6e"/>`;
  return s;
}

const GIZMO_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <circle cx="24" cy="24" r="22.5" fill="#241d14" stroke="#8a6d3b" stroke-width="1.5"/>
  <g class="camdial-squash" transform="translate(24 24) scale(1 0.643)">
    <circle cx="0" cy="0" r="17" fill="#4c4a2e" stroke="#c9a24a" stroke-width="1"/>
    <g class="camdial-rose"></g>
    <path d="M-17 0 A17 17 0 0 1 17 0 Z" fill="#000" opacity="0.22"/>
    <circle cx="0" cy="0" r="1.4" fill="#241d14"/>
  </g>
  <path d="M24 25 V14.5" stroke="#b9bcb4" stroke-width="1.6"/>
  <circle cx="24" cy="12.8" r="1.9" fill="#e8b34b" stroke="#000" stroke-width="0.4"/>
  <path d="M24 0.8 l3 4.2 h-6 z" fill="#e8b34b"/>
</svg>`;

export class CameraDial {
  /** @param {object} hud the Hud (hud.game.cameraRig is the rig) @param {HTMLElement} parent the top bar icon row */
  constructor(hud, parent) {
    this.hud = hud;
    this.rig = hud.game?.cameraRig || null;
    this.wrap = el('div', 'hud-camdial-wrap', parent);
    this.read = el('div', 'camdial-read', this.wrap);
    this.readYaw = el('div', null, this.read, 'Y 015°');
    this.readPitch = el('div', null, this.read, 'P 40°');
    this.face = el('div', 'hud-camdial', this.wrap);
    this.face.title = 'CAMERA — drag sideways: yaw · drag up/down: pitch · double-click: reset';
    this.face.innerHTML = GIZMO_SVG;
    this.rose = this.face.querySelector('.camdial-rose');
    this.rose.innerHTML = groundSVG();
    this.squash = this.face.querySelector('.camdial-squash');
    this._yi = null;
    this._pi = null;
    this._drag = null;
    this._wire();
    this.update();
  }

  _wire() {
    const face = this.face;
    face.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rig = this.rig || this.hud.game?.cameraRig;
      if (!rig) return;
      this.rig = rig;
      e.preventDefault();
      e.stopPropagation();
      face.setPointerCapture?.(e.pointerId);
      this._drag = { x: e.clientX, y: e.clientY, yaw: wrap360(rig.yawDeg), pitch: rig.pitchDeg };
      this._edgeWas = rig.edgeScroll;
      rig.edgeScroll = false; // the dial owns the pointer: no edge-pan while it is dragged
    });
    face.addEventListener('pointermove', (e) => {
      const d = this._drag;
      if (!d || !this.rig) return;
      const yaw = wrap360(d.yaw + (e.clientX - d.x) * YAW_PER_PX);
      let pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, d.pitch - (e.clientY - d.y) * PITCH_PER_PX));
      if (Math.abs(pitch - CONFIG.camera.pitchDeg) <= DETENT) pitch = CONFIG.camera.pitchDeg; // the 40 home detent
      this.rig.setYaw(yaw);
      this.rig.setPitch(pitch);
    });
    const end = () => {
      if (!this._drag) return;
      this._drag = null;
      if (this.rig) {
        if (this._edgeWas !== undefined) this.rig.edgeScroll = this._edgeWas;
        this.rig.onUserYaw?.(Math.round(wrap360(this.rig.yawDeg))); // keep Options CAMERA ANGLE truthful
      }
    };
    face.addEventListener('pointerup', end);
    face.addEventListener('pointercancel', end);
    face.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const rig = this.rig || this.hud.game?.cameraRig;
      if (!rig) return;
      this.rig = rig;
      rig.setYaw(CONFIG.camera.yawDeg);
      rig.setPitch(CONFIG.camera.pitchDeg);
      rig.onUserYaw?.(Math.round(CONFIG.camera.yawDeg));
    });
    face.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Refresh the ground disc / readout from the rig (called from Hud.update). */
  update() {
    const rig = this.rig || this.hud.game?.cameraRig;
    if (!rig) return;
    this.rig = rig;
    const yaw = wrap360(rig.yawDeg), pitch = rig.pitchDeg;
    const yi = Math.round(yaw), pi = Math.round(pitch);
    if (yi !== this._yi) {
      this._yi = yi;
      this.rose.setAttribute('transform', `rotate(${yaw.toFixed(1)} 0 0)`);
      this.readYaw.textContent = `Y ${String(yi).padStart(3, '0')}°`;
    }
    if (pi !== this._pi) {
      this._pi = pi;
      if (this.squash) {
        // The disc IS the pitch readout: vertical radius = r*sin(pitch), the game's projection.
        const s = Math.sin((pitch * Math.PI) / 180).toFixed(3);
        this.squash.setAttribute('transform', `translate(24 24) scale(1 ${s})`);
      }
      this.readPitch.textContent = `P ${pi}°`;
    }
  }
}
