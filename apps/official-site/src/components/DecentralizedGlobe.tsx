// @ts-nocheck
import { useEffect, useRef } from 'react';

// ── Peers: major countries/regions, strictly inland coordinates ──
const PEERS = [
  // China
  { lat: 34.26, lng: 108.94, icon: 'home' },     // Xi'an
  { lat: 30.57, lng: 104.07, icon: 'person' },   // Chengdu
  { lat: 43.80, lng: 87.60, icon: 'home' },      // Urumqi
  // Japan (interior Honshu)
  { lat: 36.65, lng: 138.18, icon: 'person' },   // Nagano
  // Korea
  { lat: 36.35, lng: 127.38, icon: 'home' },     // Daejeon
  // India
  { lat: 12.97, lng: 77.59, icon: 'person' },    // Bangalore
  { lat: 26.85, lng: 80.91, icon: 'home' },      // Lucknow
  // Southeast Asia (Thailand interior)
  { lat: 18.79, lng: 98.98, icon: 'person' },    // Chiang Mai
  // Russia
  { lat: 55.76, lng: 37.62, icon: 'home' },      // Moscow
  { lat: 54.99, lng: 73.37, icon: 'person' },    // Omsk
  // Europe
  { lat: 52.48, lng: -1.90, icon: 'home' },      // Birmingham UK
  { lat: 45.76, lng: 4.83, icon: 'person' },     // Lyon France
  { lat: 48.14, lng: 11.58, icon: 'home' },      // Munich Germany
  { lat: 40.42, lng: -3.70, icon: 'person' },    // Madrid Spain
  { lat: 50.08, lng: 14.44, icon: 'home' },      // Prague Czech
  { lat: 52.23, lng: 21.01, icon: 'person' },    // Warsaw Poland
  { lat: 47.50, lng: 19.04, icon: 'home' },      // Budapest Hungary
  // Middle East
  { lat: 24.71, lng: 46.68, icon: 'person' },    // Riyadh
  { lat: 35.69, lng: 51.39, icon: 'home' },      // Tehran
  // Africa
  { lat: 9.06, lng: 7.49, icon: 'person' },      // Abuja Nigeria
  { lat: 9.02, lng: 38.75, icon: 'home' },       // Addis Ababa
  { lat: -26.20, lng: 28.05, icon: 'person' },   // Johannesburg
  // North America
  { lat: 39.74, lng: -104.99, icon: 'home' },    // Denver
  { lat: 33.75, lng: -84.39, icon: 'person' },   // Atlanta
  { lat: 44.98, lng: -93.27, icon: 'home' },     // Minneapolis
  { lat: 45.42, lng: -75.70, icon: 'person' },   // Ottawa
  { lat: 19.43, lng: -99.13, icon: 'home' },     // Mexico City
  // South America
  { lat: -15.79, lng: -47.88, icon: 'person' },  // Brasilia
  { lat: 4.71, lng: -74.07, icon: 'home' },      // Bogota
  { lat: -31.42, lng: -64.18, icon: 'person' },  // Cordoba Argentina
  // Oceania (deep inland Australia)
  { lat: -23.70, lng: 133.88, icon: 'home' },    // Alice Springs
];

function makeArc(a, b) {
  return {
    startLat: PEERS[a].lat, startLng: PEERS[a].lng,
    endLat: PEERS[b].lat, endLng: PEERS[b].lng,
  };
}

const ARCS = [
  makeArc(0, 1), makeArc(1, 2), makeArc(0, 3), makeArc(3, 4),
  makeArc(0, 4), makeArc(1, 7), makeArc(5, 6), makeArc(6, 7),
  makeArc(2, 9), makeArc(8, 9),
  makeArc(10, 11), makeArc(11, 12), makeArc(12, 14), makeArc(13, 11),
  makeArc(14, 15), makeArc(15, 16), makeArc(16, 8),
  makeArc(16, 18), makeArc(18, 17),
  makeArc(17, 20), makeArc(19, 20), makeArc(20, 21), makeArc(18, 5),
  makeArc(22, 23), makeArc(22, 24), makeArc(24, 25), makeArc(23, 26),
  makeArc(27, 28), makeArc(28, 29),
  makeArc(25, 10), makeArc(26, 27), makeArc(0, 22),
  makeArc(3, 30), makeArc(21, 30), makeArc(29, 21),
  makeArc(13, 19), makeArc(7, 30), makeArc(4, 24),
];

const HOME_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="rgba(42,95,158,0.15)" stroke="#2a5f9e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';

const PERSON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="rgba(80,144,200,0.15)" stroke="#5090c8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

const COLORS = {
  globeFill: '#f0f5fc',
  atmosphere: '#a8c8e8',
  hexFill: 'rgba(120, 170, 220, 0.5)',
  arc: 'rgba(90, 154, 212, 0.55)',
};

export default function DecentralizedGlobe() {
  const containerRef = useRef(null);
  const globeRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    async function init() {
      const Globe = (await import('globe.gl')).default;
      const topojson = await import('topojson-client');
      if (disposed || !containerRef.current) return;

      const world = Globe()
        .backgroundColor('rgba(255,255,255,0)')
        .showAtmosphere(true)
        .atmosphereColor(COLORS.atmosphere)
        .atmosphereAltitude(0.12)
        .showGraticules(false)
        .htmlElementsData(PEERS)
        .htmlLat('lat')
        .htmlLng('lng')
        .htmlAltitude(0.012)
        .htmlElement((d) => {
          const el = document.createElement('div');
          el.innerHTML = d.icon === 'home' ? HOME_SVG : PERSON_SVG;
          el.style.pointerEvents = 'none';
          el.style.filter = 'drop-shadow(0 1px 2px rgba(42,95,158,0.25))';
          return el;
        })
        .arcsData(ARCS)
        .arcStartLat('startLat')
        .arcStartLng('startLng')
        .arcEndLat('endLat')
        .arcEndLng('endLng')
        .arcColor(() => COLORS.arc)
        .arcAltitudeAutoScale(0.25)
        .arcStroke(0.3)
        .arcDashLength(0.5)
        .arcDashGap(0.3)
        .arcDashAnimateTime(() => Math.random() * 4000 + 2500)
        (containerRef.current);

      if (disposed) return;
      globeRef.current = world;

      const globeMaterial = world.globeMaterial();
      globeMaterial.color.set(COLORS.globeFill);
      globeMaterial.emissive.set('#e0eaf8');
      globeMaterial.emissiveIntensity = 0.15;
      globeMaterial.shininess = 8;

      // Fetch countries-50m, split MultiPolygons, filter antimeridian-crossers
      fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json')
        .then((res) => res.json())
        .then((worldData) => {
          if (disposed) return;
          const countries = topojson.feature(worldData, worldData.objects.countries);
          const rawPolygons = [];
          for (const feat of countries.features) {
            if (feat.id === '010' || feat.properties.name === 'Antarctica') continue;
            if (feat.geometry.type === 'Polygon') {
              rawPolygons.push(feat);
            } else if (feat.geometry.type === 'MultiPolygon') {
              for (const coords of feat.geometry.coordinates) {
                rawPolygons.push({
                  type: 'Feature',
                  geometry: { type: 'Polygon', coordinates: coords },
                  properties: feat.properties,
                });
              }
            }
          }
          // Filter: remove antimeridian-crossing (lng span > 300) and tiny polygons
          const polygons = rawPolygons.filter((f) => {
            const ring = f.geometry.coordinates[0];
            if (!ring || ring.length < 4) return false;
            let minLng = 180, maxLng = -180;
            for (const [lng] of ring) {
              if (lng < minLng) minLng = lng;
              if (lng > maxLng) maxLng = lng;
            }
            if (maxLng - minLng > 300) return false;
            const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
            if (avgLat < -60) return false;
            return true;
          });
          world
            .hexPolygonsData(polygons)
            .hexPolygonResolution(3)
            .hexPolygonMargin(0.35)
            .hexPolygonAltitude(0.004)
            .hexPolygonColor(() => COLORS.hexFill);
        });

      const controls = world.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.4;
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      world.pointOfView({ lat: 25, lng: 80, altitude: 2.0 });
    }

    init();

    const handleResize = () => {
      if (globeRef.current && containerRef.current) {
        globeRef.current.width(containerRef.current.clientWidth);
        globeRef.current.height(containerRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      if (globeRef.current) {
        globeRef.current._destructor?.();
        globeRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
