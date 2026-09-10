const { test } = require('node:test');
const assert = require('node:assert/strict');
const { orientationQuaternion, validVector } = require('../motion-math.js');
function rotate(q, v) {
  const t = [2*(q.y*v[2]-q.z*v[1]), 2*(q.z*v[0]-q.x*v[2]), 2*(q.x*v[1]-q.y*v[0])];
  return [v[0]+q.w*t[0]+q.y*t[2]-q.z*t[1], v[1]+q.w*t[1]+q.z*t[0]-q.x*t[2], v[2]+q.w*t[2]+q.x*t[1]-q.y*t[0]];
}
test('quaternion matches the W3C intrinsic Z-X-Y rotation matrix across mixed angles', () => {
  for (const [alpha, beta, gamma] of [[0,0,0],[90,0,0],[0,90,0],[0,0,90],[37,-81,62],[359,179,-89]]) {
    const [a,b,g] = [alpha,beta,gamma].map(n => n*Math.PI/180);
    const [ca,sa,cb,sb,cg,sg] = [Math.cos(a),Math.sin(a),Math.cos(b),Math.sin(b),Math.cos(g),Math.sin(g)];
    const columns = [[ca*cg-sa*sb*sg, sa*cg+ca*sb*sg, -cb*sg], [-cb*sa, ca*cb, sb], [ca*sg+cg*sa*sb, sa*sg-ca*cg*sb, cb*cg]];
    const q = orientationQuaternion(alpha,beta,gamma);
    assert.ok(Math.abs(Math.hypot(q.x,q.y,q.z,q.w)-1)<1e-12);
    [[1,0,0],[0,1,0],[0,0,1]].forEach((v,i) => rotate(q,v).forEach((n,j) => assert.ok(Math.abs(n-columns[i][j])<1e-12)));
  }
});
test('missing sensor axes are unavailable instead of fabricated zeroes', () => {
  assert.equal(validVector(null), false);
  assert.equal(validVector({x:null,y:0,z:0}), false);
  assert.equal(validVector({x:NaN,y:0,z:0}), false);
  assert.equal(validVector({x:0,y:0,z:0}), true);
});
