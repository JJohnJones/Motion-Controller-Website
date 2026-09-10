/* Browser right-handed device-to-reference quaternion, intrinsic Z-X'-Y''.
   Screen correction and Unity conversion deliberately live on the Unity side. */
(function (root) {
  function multiply(a, b) {
    return {
      x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
      y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
      z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
      w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
    };
  }
  function orientationQuaternion(alpha, beta, gamma) {
    const half = Math.PI / 360;
    const z = { x: 0, y: 0, z: Math.sin(alpha*half), w: Math.cos(alpha*half) };
    const x = { x: Math.sin(beta*half), y: 0, z: 0, w: Math.cos(beta*half) };
    const y = { x: 0, y: Math.sin(gamma*half), z: 0, w: Math.cos(gamma*half) };
    return multiply(multiply(z, x), y);
  }
  function validVector(v) {
    return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  }
  const api = { multiply, orientationQuaternion, validVector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MotionMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
