import * as C from "cesium";
import { geometrySpecs, type Config } from "../../shared/scenario";
export function renderGeometries(
  viewer: C.Viewer,
  config: Config,
  seconds: (t: C.JulianDate) => number,
) {
  for (const g of geometrySpecs(config)) {
    const p = C.Cartesian3.fromDegrees(g.lon, g.lat);
    const color = g.kind === "Radar" ? C.Color.CYAN : C.Color.ORANGE;
    const e = viewer.entities.add({
      id: g.id,
      name: g.id,
      position: p,
      properties: { kind: g.kind, radius: g.radius },
      label: {
        text: g.id,
        font: "11px sans-serif",
        fillColor: color,
        pixelOffset: new C.Cartesian2(0, 18),
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 4e6),
      },
    });
    const material = color.withAlpha(0.09);
    if (g.kind === "Radar" || g.kind === "Ellipse") {
      e.ellipse = new C.EllipseGraphics({
        semiMajorAxis: g.radius,
        semiMinorAxis: g.kind === "Radar" ? g.radius : g.radius * 0.5,
        material,
        outline: true,
        outlineColor: color.withAlpha(0.5),
      });
      if (g.kind === "Radar")
        e.polyline = new C.PolylineGraphics({
          width: 1.5,
          material: color.withAlpha(0.7),
          positions: new C.CallbackProperty((t) => {
            const angle = (seconds(t!) * Math.PI) / 15;
            return [
              p,
              C.Cartesian3.fromDegrees(
                g.lon + (Math.cos(angle) * g.radius) / 95000,
                g.lat + (Math.sin(angle) * g.radius) / 111320,
                100,
              ),
            ];
          }, false),
        });
    } else if (g.kind.includes("polygon") || g.kind === "Restricted airspace") {
      e.polygon = new C.PolygonGraphics({
        hierarchy: new C.CallbackProperty((t) => {
          const shift =
            g.kind === "Dynamic polygon"
              ? 0.15 * Math.sin(seconds(t!) / 120)
              : 0;
          return new C.PolygonHierarchy(
            C.Cartesian3.fromDegreesArray([
              g.lon - 0.5 + shift,
              g.lat - 0.4,
              g.lon + 0.6 + shift,
              g.lat - 0.2,
              g.lon + 0.3 + shift,
              g.lat + 0.5,
              g.lon - 0.3 + shift,
              g.lat + 0.6,
            ]),
          );
        }, false),
        height: 1000,
        extrudedHeight: 9000,
        material,
        outline: true,
        outlineColor: color,
      });
    } else if (g.kind === "Sphere") {
      e.position = new C.ConstantPositionProperty(
        C.Cartesian3.fromDegrees(g.lon, g.lat, 25000),
      );
      e.ellipsoid = new C.EllipsoidGraphics({
        radii: new C.Cartesian3(20000, 20000, 20000),
        material,
      });
    } else if (g.kind === "Cylinder") {
      e.position = new C.ConstantPositionProperty(
        C.Cartesian3.fromDegrees(g.lon, g.lat, 12000),
      );
      e.cylinder = new C.CylinderGraphics({
        length: 24000,
        topRadius: 22000,
        bottomRadius: 22000,
        material: new C.ColorMaterialProperty(
          new C.CallbackProperty(
            (t) =>
              color.withAlpha(0.08 + 0.07 * (1 + Math.sin(seconds(t!) / 90))),
            false,
          ),
        ),
      });
    } else if (g.kind === "Rectangle") {
      e.rectangle = new C.RectangleGraphics({
        coordinates: C.Rectangle.fromDegrees(
          g.lon - 0.4,
          g.lat - 0.3,
          g.lon + 0.4,
          g.lat + 0.3,
        ),
        material,
        outline: true,
      });
    } else {
      e.polyline = new C.PolylineGraphics({
        positions: C.Cartesian3.fromDegreesArrayHeights([
          g.lon,
          g.lat,
          10000,
          g.lon + 2,
          g.lat + 1,
          10000,
        ]),
        width: 2,
        material: C.Color.ORANGE,
      });
    }
  }
}
