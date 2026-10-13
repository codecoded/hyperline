"""Procedurally models every HYPERLINE asset in Blender and exports GLBs.

Run:  blender --background --python tools/build_assets.py -- public/models [preview_dir]

Blender is Z-up with the ship nose pointing down -Y; the glTF exporter converts
that to Y-up with the nose along +Z, which is what three.js `lookAt` expects.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0] if argv else "public/models")
PREVIEW_DIR = os.path.abspath(argv[1]) if len(argv) > 1 else None
os.makedirs(OUT_DIR, exist_ok=True)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, rough=0.5, emit=None, strength=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def interp(keys, t):
    """Catmull-Rom interpolation through rows of (t, v0, v1, ...)."""
    if t <= keys[0][0]:
        return keys[0][1:]
    if t >= keys[-1][0]:
        return keys[-1][1:]
    i = max(j for j in range(len(keys) - 1) if keys[j][0] <= t)
    k0, k1 = keys[i], keys[i + 1]
    km, kp = keys[max(i - 1, 0)], keys[min(i + 2, len(keys) - 1)]
    u = (t - k0[0]) / (k1[0] - k0[0])
    out = []
    for c in range(1, len(k0)):
        p0, p1, p2, p3 = km[c], k0[c], k1[c], kp[c]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u
                          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return out


def sgn_pow(v, e):
    return math.copysign(abs(v) ** e, v)


class Builder:
    """Accumulates geometry for one object into a single bmesh."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat_index(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _paint(self, faces, mat):
        """mat is a material or a callable(face_center, face_normal) -> material."""
        self.bm.normal_update()
        for f in faces:
            m = mat(f.calc_center_median(), f.normal) if callable(mat) else mat
            f.material_index = self.mat_index(m)
            f.smooth = True

    def loft(self, rings, mat, cap_start=True, cap_end=True):
        bm = self.bm
        vr = [[bm.verts.new(p) for p in ring] for ring in rings]
        faces = []
        n = len(vr[0])
        for a, b in zip(vr, vr[1:]):
            for i in range(n):
                j = (i + 1) % n
                faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        if cap_start:
            faces.append(bm.faces.new(vr[0]))
        if cap_end:
            faces.append(bm.faces.new(list(reversed(vr[-1]))))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._paint(faces, mat)
        return faces

    def body(self, keys, mat, xc=0.0, n=28, stations=34, e=2.5, **kw):
        """Superellipse loft along Y. keys rows: (y, half_w, h_top, h_bot, z_center)."""
        y0, y1 = keys[0][0], keys[-1][0]
        rings = []
        for s in range(stations):
            # cosine spacing packs stations toward both tips
            u = 0.5 - 0.5 * math.cos(math.pi * s / (stations - 1))
            y = y0 + (y1 - y0) * u
            w, ht, hb, zc = interp(keys, y)
            w, ht, hb = max(w, 0.004), max(ht, 0.004), max(hb, 0.004)
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n
                c, sn = math.cos(a), math.sin(a)
                ring.append(Vector((xc + w * sgn_pow(c, 2 / e), y,
                                    zc + (ht if sn >= 0 else hb) * sgn_pow(sn, 2 / e))))
            rings.append(ring)
        return self.loft(rings, mat, **kw)

    def prism(self, outline, z0, z1, mat, xform=None):
        """Extrude a planform outline [(x, y), ...] between z0 and z1."""
        rings = [[Vector((x, y, z)) for x, y in outline] for z in (z0, z1)]
        if xform:
            rings = [[xform @ p for p in r] for r in rings]
        return self.loft(rings, mat)

    def beam(self, p0, p1, width, height, mat, up=Vector((0, 0, 1))):
        """Box running from p0 to p1; `width` across, `height` along `up`."""
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0).normalized()
        side = d.cross(up)
        if side.length < 1e-5:
            side = d.cross(Vector((1, 0, 0)))
        side.normalize()
        u = side.cross(d).normalized()
        ring = lambda p: [p + side * sx * width / 2 + u * sz * height / 2
                          for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        return self.loft([ring(p0), ring(p1)], mat)

    def box(self, center, size, mat):
        c, s = Vector(center), Vector(size) / 2
        return self.beam(c - Vector((0, s.y, 0)), c + Vector((0, s.y, 0)), s.x * 2, s.z * 2, mat)

    def disc(self, center, radius, mat, n=20, normal_y=1.0):
        c = Vector(center)
        vs = [self.bm.verts.new(c + Vector((math.cos(2 * math.pi * i / n) * radius, 0,
                                             math.sin(2 * math.pi * i / n) * radius)))
              for i in range(n)]
        f = self.bm.faces.new(vs)
        f.normal_update()
        if f.normal.y * normal_y < 0:
            f.normal_flip()
        self._paint([f], mat)
        f.smooth = False

    def finish(self, sharp_angle=38.0, flat=False, location=(0, 0, 0)):
        bm = self.bm
        bm.normal_update()
        limit = math.radians(sharp_angle)
        for edge in bm.edges:
            if len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) > limit:
                edge.smooth = False
        if flat:
            for f in bm.faces:
                f.smooth = False
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = location
        bpy.context.scene.collection.objects.link(obj)
        return obj


def empty(name, location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = location
    e.empty_display_size = 0.2
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e


def export(filename, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    print(f"[assets] wrote {path} ({os.path.getsize(path) / 1024:.1f} KB)")


def render_preview(name, cam_pos, target, lens=50):
    if not PREVIEW_DIR:
        return
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
    cam.data.lens = lens
    cam.location = cam_pos
    cam.rotation_euler = (Vector(target) - Vector(cam_pos)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    for loc, energy, col in (((6, -8, 9), 5.0, (1.0, 0.95, 0.9)), ((-8, 4, 3), 2.0, (0.5, 0.7, 1.0))):
        light = bpy.data.objects.new("PreviewSun", bpy.data.lights.new("PreviewSun", "SUN"))
        light.data.energy = energy
        light.data.color = col
        light.rotation_euler = (-Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(light)
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.13, 0.2, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
    scene.world = world
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.filepath = os.path.join(PREVIEW_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------------------- #
# ship
# --------------------------------------------------------------------------- #
def build_ship():
    reset()
    paint = material("Paint", (0.02, 0.35, 0.9), metallic=0.65, rough=0.28)
    alt = material("PaintAlt", (0.9, 0.92, 0.95), metallic=0.4, rough=0.32)
    carbon = material("Carbon", (0.025, 0.027, 0.035), metallic=0.5, rough=0.45)
    glass = material("Glass", (0.01, 0.02, 0.05), metallic=1.0, rough=0.04)
    glow = material("Glow", (0, 0, 0), rough=0.4, emit=(0.1, 0.9, 1.0), strength=6.0)
    nozzle = material("Nozzle", (0.05, 0.05, 0.06), metallic=1.0, rough=0.3)
    thruster = material("Thruster", (0, 0, 0), emit=(1.0, 0.55, 0.2), strength=10.0)

    b = Builder("hull")
    POD_X = 1.3

    # central fuselage: needle nose swelling into the cockpit section
    def fuselage_mat(c, n):
        if n.z < -0.55:
            return carbon
        if c.y < -2.15 or (0.95 < c.y < 1.25):
            return alt
        return paint

    b.body([(-3.2, 0.01, 0.01, 0.01, 0.04),
            (-2.7, 0.11, 0.05, 0.05, 0.05),
            (-1.8, 0.29, 0.13, 0.10, 0.09),
            (-0.8, 0.48, 0.25, 0.16, 0.15),
            (0.2, 0.58, 0.35, 0.20, 0.20),
            (1.2, 0.52, 0.33, 0.20, 0.22),
            (2.0, 0.36, 0.23, 0.15, 0.24),
            (2.2, 0.27, 0.17, 0.11, 0.24)], fuselage_mat, e=2.7)

    # canopy
    b.body([(-1.25, 0.01, 0.01, 0.01, 0.24),
            (-0.8, 0.19, 0.13, 0.05, 0.32),
            (-0.1, 0.31, 0.24, 0.05, 0.43),
            (0.5, 0.29, 0.21, 0.05, 0.48),
            (1.05, 0.03, 0.02, 0.02, 0.50)], glass, n=20, stations=22, e=2.2)

    for side in (-1, 1):
        x = POD_X * side

        def pod_mat(c, n):
            if n.z < -0.6:
                return carbon
            if c.y < -1.15 or (1.5 < c.y < 1.7):
                return alt
            return paint

        # engine pod: forward prong + nacelle
        b.body([(-2.45, 0.01, 0.01, 0.01, 0.00),
                (-1.7, 0.11, 0.08, 0.07, 0.00),
                (-0.5, 0.25, 0.19, 0.15, 0.02),
                (0.8, 0.35, 0.29, 0.22, 0.05),
                (1.9, 0.36, 0.30, 0.24, 0.06),
                (2.4, 0.31, 0.27, 0.21, 0.06)], pod_mat, xc=x, n=24, stations=28)
        # nozzle shroud + hot core
        ring = lambda y, r: [Vector((x + math.cos(2 * math.pi * i / 20) * r, y,
                                     0.06 + math.sin(2 * math.pi * i / 20) * r * 0.85)) for i in range(20)]
        b.loft([ring(2.38, 0.30), ring(2.62, 0.25), ring(2.62, 0.21), ring(2.40, 0.2)],
               nozzle, cap_start=False, cap_end=False)
        b.disc((x, 2.42, 0.06), 0.2, thruster)

        # main wing: swept slab between fuselage and pod
        wing_mat = lambda c, n: paint if n.z > 0.5 else carbon
        b.prism([(0.30 * side, -1.15), (x, 0.0), (x, 2.05), (0.30 * side, 1.75)], 0.03, 0.13, wing_mat)
        # dark inlay panel on the wing
        b.prism([(0.50 * side, -0.45), (x - 0.38 * side, 0.45), (x - 0.38 * side, 1.25), (0.50 * side, 1.15)],
                0.128, 0.138, carbon)

        # outer winglet with anhedral
        hinge = Matrix.Translation((x, 0, 0.08)) @ Matrix.Rotation(math.radians(14 * side), 4, "Y") \
            @ Matrix.Translation((-x, 0, -0.08))
        b.prism([(x + 0.3 * side, 0.75), (x + 1.05 * side, 1.85), (x + 1.05 * side, 2.3), (x + 0.3 * side, 2.2)],
                0.05, 0.11, lambda c, n: alt if abs(n.z) > 0.5 else carbon, xform=hinge)
        tip0 = hinge @ Vector((x + 1.06 * side, 1.85, 0.08))
        tip1 = hinge @ Vector((x + 1.06 * side, 2.3, 0.08))
        b.beam(tip0, tip1, 0.04, 0.09, glow)

        # canted tail fin
        cant = Matrix.Translation((x, 0, 0.3)) @ Matrix.Rotation(math.radians(20 * side), 4, "Y")
        fin = [Vector((0, 1.25, 0)), Vector((0, 2.15, 0.82)), Vector((0, 2.55, 0.82)), Vector((0, 2.4, 0))]
        b.loft([[cant @ (p + Vector((dx, 0, 0))) for p in fin] for dx in (-0.03, 0.03)],
               lambda c, n: paint if c.z > 0.75 else alt)
        b.beam(cant @ Vector((0, 2.17, 0.84)), cant @ Vector((0, 2.55, 0.84)), 0.07, 0.035, glow)

        # light strips: pod flank + wing leading edge
        b.beam((x + 0.355 * side, 0.55, 0.06), (x + 0.365 * side, 1.95, 0.07), 0.05, 0.035, glow,
               up=Vector((side, 0, 0)))
        b.beam((0.36 * side, -1.06, 0.135), (x - 0.06 * side, -0.02, 0.135), 0.035, 0.02, glow)

    # centre engine
    ring = lambda y, r: [Vector((math.cos(2 * math.pi * i / 16) * r * 1.5, y,
                                 0.24 + math.sin(2 * math.pi * i / 16) * r)) for i in range(16)]
    b.loft([ring(2.18, 0.17), ring(2.36, 0.14), ring(2.36, 0.11), ring(2.2, 0.1)],
           nozzle, cap_start=False, cap_end=False)
    b.disc((0, 2.22, 0.24), 0.1, thruster, n=16)
    # spine light
    b.beam((0, 1.15, 0.555), (0, 1.95, 0.47), 0.05, 0.02, glow)

    hull = b.finish()

    # airbrake flaps hinge at their leading edge so the game can pop them open
    parts = [hull]
    for name, side in (("airbrake_L", 1), ("airbrake_R", -1)):  # Blender +X is the ship's left
        fb = Builder(name)
        fb.prism([(-0.32, 0), (0.32, 0), (0.32, 0.42), (-0.32, 0.42)], 0.0, 0.025,
                 lambda c, n: alt if n.z > 0.5 else carbon)
        flap = fb.finish(location=(0.8 * side, 1.5, 0.132))
        flap.parent = hull
        parts.append(flap)

    for name, loc in (("engine_L", (POD_X, 2.62, 0.06)), ("engine_R", (-POD_X, 2.62, 0.06)),
                      ("engine_C", (0, 2.36, 0.24))):
        parts.append(empty(name, loc, hull))

    export("ship.glb", parts)
    render_preview("ship", (5.2, -6.0, 3.2), (0, 0, 0.1), lens=55)
    render_preview("ship_rear", (-3.5, 6.5, 2.4), (0, 0.4, 0.1), lens=55)


# --------------------------------------------------------------------------- #
# track gates
# --------------------------------------------------------------------------- #
def build_gates():
    reset()
    body = material("GateBody", (0.03, 0.033, 0.045), metallic=0.8, rough=0.4)
    trim = material("GateTrim", (0.35, 0.37, 0.42), metallic=0.9, rough=0.3)
    glow = material("GateGlow", (0, 0, 0), emit=(0.1, 0.9, 1.0), strength=8.0)
    up = Vector((0, 1, 0))  # beams are "wide" along the track direction

    def arch(name, heavy):
        b = Builder(name)
        depth = 3.2 if heavy else 2.0
        path = [(-20.5, -5.0), (-20.5, 6.5), (-14.0, 14.0), (14.0, 14.0), (20.5, 6.5), (20.5, -5.0)]
        inner = [(-19.6, -1.5), (-19.6, 6.2), (-13.6, 13.1), (13.6, 13.1), (19.6, 6.2), (19.6, -1.5)]
        for (x0, z0), (x1, z1) in zip(path, path[1:]):
            b.beam((x0, 0, z0), (x1, 0, z1), depth, 1.5, body, up=up)
        for (x0, z0), (x1, z1) in zip(inner, inner[1:]):
            for y in ((-depth / 2 + 0.25, depth / 2 - 0.25) if heavy else (0.0,)):
                b.beam((x0, y, z0), (x1, y, z1), 0.3, 0.22, glow, up=up)
        # elbow joints and feet
        for x, z in path[1:-1]:
            b.box((x, 0, z), (2.3, depth + 0.5, 2.3), trim)
        for side in (-1, 1):
            b.box((20.5 * side, 0, -4.2), (3.2, depth + 1.2, 2.2), trim)
        if heavy:
            # start gantry: light bar housings + frame for the holo banner
            b.beam((-13.0, 0, 15.3), (13.0, 0, 15.3), depth * 0.7, 1.1, trim, up=up)
            for i in range(5):
                x = (i - 2) * 4.2
                b.box((x, -depth / 2 - 0.2, 12.2), (2.4, 0.5, 1.5), body)
            for x in (-12.6, 12.6):
                b.beam((x, 0, 8.6), (x, 0, 13.2), 0.5, 0.5, trim, up=up)
        return b.finish(sharp_angle=20, flat=True)

    gate, start = arch("gate", False), arch("gate_start", True)
    export("gates.glb", [gate, start])
    render_preview("gate", (30, -55, 14), (0, 0, 6), lens=40)


# --------------------------------------------------------------------------- #
# skyline towers (unit footprint, unit height; scaled per-instance in game)
# --------------------------------------------------------------------------- #
def build_towers():
    reset()
    wall = material("Tower", (0.05, 0.05, 0.07), metallic=0.3, rough=0.6)

    def tiers(name, spec, extras=()):
        b = Builder(name)
        for (cx, cy, w, d, z0, z1) in spec:
            b.prism([(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2),
                     (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)], z0, z1, wall)
        for fn in extras:
            fn(b)
        return b.finish(flat=True)

    def taper(z0, z1, w0, w1, sides=4, twist=0.0):
        def fn(b):
            ring = lambda z, w, t: [Vector((math.cos(t + 2 * math.pi * i / sides + math.pi / 4) * w * 0.707,
                                            math.sin(t + 2 * math.pi * i / sides + math.pi / 4) * w * 0.707, z))
                                    for i in range(sides)]
            b.loft([ring(z0, w0, 0.0), ring(z1, w1, twist)], wall)
        return fn

    a = tiers("tower_A", [(0, 0, 1.0, 1.0, 0, 0.72), (0, 0, 0.74, 0.74, 0.72, 0.9)],
              [taper(0.9, 0.94, 0.5, 0.3), taper(0.94, 1.0, 0.04, 0.02)])
    bt = tiers("tower_B", [(0, 0, 1.0, 1.0, 0, 0.38), (0.08, 0.05, 0.78, 0.8, 0.38, 0.66),
                           (0.14, 0.1, 0.52, 0.56, 0.66, 0.88), (0.16, 0.12, 0.3, 0.32, 0.88, 1.0)])
    c = tiers("tower_C", [(-0.3, 0, 0.4, 0.9, 0, 1.0), (0.3, 0, 0.4, 0.9, 0, 0.82),
                          (0, 0, 0.3, 0.5, 0.52, 0.6), (0, 0, 0.3, 0.5, 0.3, 0.36)])
    d = tiers("tower_D", [], [taper(0.0, 0.55, 1.0, 0.8, sides=6), taper(0.55, 0.92, 0.8, 0.34, sides=6),
                              taper(0.92, 1.0, 0.05, 0.02, sides=6)])
    export("towers.glb", [a, bt, c, d])


build_ship()
build_gates()
build_towers()
print("[assets] done")
