import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  discoverDiagramSpecs,
  renderAllDiagrams,
  renderDiagram,
  validateLayoutScene,
} from './diagram-render.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

test('architecture diagrams use stable ids and viewpoint-specific layouts', () => {
  const specs = discoverDiagramSpecs();

  assert.deepEqual(
    specs.map((spec) => spec.id),
    [
      'cross-client-runtime.reuse-topology',
      'project.authority-map',
      'project.engineering-control-plane',
      'project.journey.cross-station',
      'project.journey.route-convergence',
      'project.journey.same-station',
      'project.logical-layered-architecture',
      'project.runtime-topology',
      'project.system-context',
    ],
  );
  assert.deepEqual(
    new Set(specs.map((spec) => spec.layout)),
    new Set([
      'composition',
      'matrix',
      'control-loop',
      'sequence',
      'layers',
      'topology',
      'context',
    ]),
  );
  assert.equal(new Set(specs.map((spec) => spec.outputPath)).size, specs.length);
});

test('legacy universal card scene is rejected by every committed spec', () => {
  for (const spec of discoverDiagramSpecs()) {
    const source = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, spec.source), 'utf8'),
    );
    assert.equal(source.schemaVersion, 3, spec.source);
    for (const field of [
      'subtitle',
      'badge',
      'boundary',
      'groups',
      'nodes',
      'edges',
      'notes',
    ]) {
      assert.equal(field in source, false, `${spec.source}:${field}`);
    }
  }
});

test('logical architecture renders bands, a contract rail, and one request path', () => {
  const spec = discoverDiagramSpecs().find(
    (candidate) => candidate.id === 'project.logical-layered-architecture',
  );
  const svg = renderDiagram(spec);

  assert.match(svg, /L1  PRODUCT FORMS/);
  assert.match(svg, /L5  STATION APP DOMAIN OWNERS/);
  assert.match(svg, /CONTRACT SUBSTRATE/);
  assert.match(svg, /class="band band-primary"/);
  assert.match(svg, /marker-end="url\(#arrow-primary\)"/);
});

test('authority and dynamic views use matrix and sequence grammar', () => {
  const specs = discoverDiagramSpecs();
  const matrix = renderDiagram(
    specs.find((candidate) => candidate.id === 'project.authority-map'),
  );
  const sequence = renderDiagram(
    specs.find((candidate) => candidate.id === 'project.journey.same-station'),
  );

  assert.match(matrix, /class="matrixOwner"/);
  assert.match(matrix, />OWNER</);
  assert.doesNotMatch(matrix, /marker-end=/);
  assert.match(sequence, /class="lifeline"/);
  assert.match(sequence, /atomic commit/);
  assert.match(sequence, /confirmed projection/);
});

test('route alternatives render explicit alt and else branches', () => {
  const spec = discoverDiagramSpecs().find(
    (candidate) => candidate.id === 'project.journey.route-convergence',
  );
  const svg = renderDiagram(spec);

  assert.match(svg, /ALT · DIRECT/);
  assert.match(svg, /ELSE · RELAY/);
});

test('diagram scenes preserve runtime and authority invariants', () => {
  const specs = new Map(
    discoverDiagramSpecs().map((spec) => [spec.id, spec]),
  );
  const runtime = specs.get('project.runtime-topology');
  const authority = specs.get('project.authority-map');
  const logical = specs.get('project.logical-layered-architecture');
  const sameStation = specs.get('project.journey.same-station');
  const crossStation = specs.get('project.journey.cross-station');
  const context = specs.get('project.system-context');
  const reuse = specs.get('cross-client-runtime.reuse-topology');

  assert.equal(runtime.edgeMeaning, '箭头仅表示真实网络流');
  assert.deepEqual(
    runtime.scene.instances
      .filter((instance) => instance.title === 'Station Transport')
      .map((instance) => instance.role)
      .sort(),
    ['desktop', 'mobile'],
  );
  assert.ok(runtime.scene.zones.some((zone) => zone.id === 'relay'));
  assert.equal(
    runtime.scene.relations.some((relation) =>
      ['home-relational', 'home-object', 'remote-state'].includes(relation.to)),
    false,
  );

  assert.deepEqual(
    authority.scene.assignments.find((item) => item.concern === 'session'),
    { concern: 'session', owner: 'identity-access' },
  );
  assert.equal(
    logical.scene.bands
      .flatMap((band) => band.modules)
      .find((module) => module.id === 'frame-runtime')
      .caption,
    'router · events · node transport',
  );
  assert.equal(
    logical.scene.bands
      .flatMap((band) => band.modules)
      .find((module) => module.id === 'identity-access')
      .caption,
    'Access Gate · Session authority',
  );
  assert.ok(sameStation.scene.messages.some(
    (message) => message.from === 'domain' && message.to === 'frame',
  ));
  assert.equal(sameStation.scene.messages.some(
    (message) => message.from === 'domain' && message.to === 'runtime',
  ), false);
  assert.deepEqual(crossStation.scene.messages.at(-1), {
    from: 'client-b',
    to: 'receiver-ui',
    label: 'receiver-visible result',
    at: 14,
    style: 'primary',
  });
  assert.ok(context.scene.relations.some(
    (relation) => relation.from === 'station' && relation.to === 'livekit',
  ));
  assert.equal(
    context.scene.relations.find(
      (relation) => relation.from === 'clients' && relation.to === 'livekit',
    ).label,
    'Desktop media',
  );
  assert.ok(context.scene.relations.some(
    (relation) => relation.from === 'livekit' && relation.to === 'station',
  ));
  assert.equal(reuse.scene.rail.id, 'model-contracts');
  assert.deepEqual(
    reuse.scene.rail.items.map((item) => item.id),
    ['typescript-bindings', 'rust-bindings'],
  );
  assert.deepEqual(
    reuse.scene.relations.map((relation) => [
      relation.from,
      relation.to,
    ]),
    [
      ['desktop-form', 'headless-typescript'],
      ['mobile-form', 'headless-typescript'],
      ['desktop-runtime', 'portable-cores'],
      ['mobile-runtime', 'portable-cores'],
      ['headless-typescript', 'typescript-bindings'],
      ['portable-cores', 'rust-bindings'],
    ],
  );
});

test('layout validation rejects clipped sequence headers', () => {
  assert.throws(
    () =>
      validateLayoutScene(
        'sequence',
        {
          participants: [
            {
              id: 'source',
              title: 'Very Long Participant',
              tone: 'neutral',
            },
            {
              id: 'target',
              title: 'Target',
              tone: 'primary',
            },
          ],
          messages: [
            {
              from: 'source',
              to: 'target',
              label: 'call',
              at: 1,
              style: 'primary',
            },
          ],
          fragments: [],
        },
        { width: 900, height: 600 },
      ),
    /does not fit its visual boundary/,
  );
});

test('layout validation rejects overlapping control guards', () => {
  assert.throws(
    () =>
      validateLayoutScene(
        'control-loop',
        {
          stages: [
            {
              id: 'source',
              role: 'stage',
              x: 70,
              y: 320,
              width: 180,
              height: 80,
              title: 'Source',
              caption: null,
              tone: 'secondary',
            },
            {
              id: 'target',
              role: 'stage',
              x: 650,
              y: 320,
              width: 180,
              height: 80,
              title: 'Target',
              caption: null,
              tone: 'primary',
            },
          ],
          guards: [
            {
              title: 'First guard',
              target: 'source',
              x: 180,
              y: 170,
              width: 220,
              tone: 'secondary',
            },
            {
              title: 'Second guard',
              target: 'target',
              x: 360,
              y: 170,
              width: 220,
              tone: 'primary',
            },
          ],
          relations: [
            {
              from: 'source',
              to: 'target',
              fromAnchor: 'right',
              toAnchor: 'left',
              label: null,
              style: 'primary',
              via: [],
            },
          ],
        },
        { width: 900, height: 600 },
      ),
    /guards First guard and Second guard overlap/,
  );
});

test('layout validation rejects duplicate authority assignments', () => {
  assert.throws(
    () =>
      validateLayoutScene(
        'matrix',
        {
          owners: [
            { id: 'left', title: 'Left' },
            { id: 'right', title: 'Right' },
          ],
          concerns: [
            { id: 'first', title: 'First concern' },
            { id: 'second', title: 'Second concern' },
          ],
          assignments: [
            { concern: 'first', owner: 'left' },
            { concern: 'first', owner: 'right' },
            { concern: 'second', owner: 'right' },
          ],
        },
        { width: 900, height: 600 },
      ),
    /assign each concern exactly once/,
  );
});

test('layout validation rejects routes outside the canvas', () => {
  assert.throws(
    () =>
      validateLayoutScene(
        'context',
        {
          systemBoundary: {
            title: 'SYSTEM',
            x: 400,
            y: 100,
            width: 450,
            height: 400,
          },
          elements: [
            {
              id: 'source',
              role: 'actor',
              x: 50,
              y: 180,
              width: 150,
              height: 70,
              title: 'Source',
              caption: null,
              tone: 'neutral',
            },
            {
              id: 'target',
              role: 'system',
              x: 500,
              y: 180,
              width: 150,
              height: 70,
              title: 'Target',
              caption: null,
              tone: 'primary',
            },
          ],
          relations: [
            {
              from: 'source',
              to: 'target',
              fromAnchor: 'right',
              toAnchor: 'left',
              label: null,
              style: 'primary',
              via: [{ x: 950, y: 215 }],
            },
          ],
        },
        { width: 900, height: 600 },
      ),
    /leaves the canvas/,
  );
});

test('runtime topology rejects shared connector tracks', () => {
  assert.throws(
    () =>
      validateLayoutScene(
        'topology',
        {
          zones: [
            {
              id: 'runtime',
              title: 'RUNTIME',
              x: 40,
              y: 100,
              width: 720,
              height: 420,
              tone: 'neutral',
            },
          ],
          instances: [
            {
              id: 'source-a',
              role: 'runtime',
              x: 70,
              y: 150,
              width: 120,
              height: 60,
              title: 'Source A',
              caption: null,
              tone: 'neutral',
            },
            {
              id: 'source-b',
              role: 'runtime',
              x: 70,
              y: 300,
              width: 120,
              height: 60,
              title: 'Source B',
              caption: null,
              tone: 'neutral',
            },
            {
              id: 'target',
              role: 'runtime',
              x: 550,
              y: 205,
              width: 150,
              height: 60,
              title: 'Target',
              caption: null,
              tone: 'primary',
            },
          ],
          relations: [
            {
              from: 'source-a',
              to: 'target',
              fromAnchor: 'right',
              toAnchor: 'left',
              label: null,
              style: 'primary',
              via: [
                { x: 300, y: 180 },
                { x: 300, y: 235 },
              ],
            },
            {
              from: 'source-b',
              to: 'target',
              fromAnchor: 'right',
              toAnchor: 'left',
              label: null,
              style: 'secondary',
              via: [
                { x: 300, y: 330 },
                { x: 300, y: 235 },
              ],
            },
          ],
        },
        { width: 900, height: 600 },
      ),
    /share a track/,
  );
});

test('runtime topology rejects perpendicular connector crossings', () => {
  assert.throws(
    () =>
      validateLayoutScene(
        'topology',
        {
          zones: [
            {
              id: 'runtime',
              title: 'RUNTIME',
              x: 40,
              y: 90,
              width: 720,
              height: 440,
              tone: 'neutral',
            },
          ],
          instances: [
            {
              id: 'left',
              role: 'runtime',
              x: 70,
              y: 200,
              width: 120,
              height: 60,
              title: 'Left',
              caption: null,
              tone: 'neutral',
            },
            {
              id: 'right',
              role: 'runtime',
              x: 600,
              y: 200,
              width: 120,
              height: 60,
              title: 'Right',
              caption: null,
              tone: 'primary',
            },
            {
              id: 'top',
              role: 'runtime',
              x: 340,
              y: 110,
              width: 120,
              height: 60,
              title: 'Top',
              caption: null,
              tone: 'neutral',
            },
            {
              id: 'bottom',
              role: 'runtime',
              x: 340,
              y: 350,
              width: 120,
              height: 60,
              title: 'Bottom',
              caption: null,
              tone: 'primary',
            },
          ],
          relations: [
            {
              from: 'left',
              to: 'right',
              fromAnchor: 'right',
              toAnchor: 'left',
              label: null,
              style: 'primary',
              via: [],
            },
            {
              from: 'top',
              to: 'bottom',
              fromAnchor: 'bottom',
              toAnchor: 'top',
              label: null,
              style: 'secondary',
              via: [],
            },
          ],
        },
        { width: 900, height: 600 },
      ),
    /relations left -> right and top -> bottom cross/,
  );
});

test('layout validation rejects relation labels over nodes', () => {
  assert.throws(
    () =>
      validateLayoutScene(
        'context',
        {
          systemBoundary: {
            title: 'SYSTEM',
            x: 300,
            y: 100,
            width: 500,
            height: 400,
          },
          elements: [
            {
              id: 'source',
              role: 'actor',
              x: 50,
              y: 180,
              width: 200,
              height: 70,
              title: 'Source',
              caption: null,
              tone: 'neutral',
            },
            {
              id: 'target',
              role: 'system',
              x: 300,
              y: 180,
              width: 200,
              height: 70,
              title: 'Target',
              caption: null,
              tone: 'primary',
            },
          ],
          relations: [
            {
              from: 'source',
              to: 'target',
              fromAnchor: 'right',
              toAnchor: 'left',
              label: 'long relation label',
              style: 'primary',
              via: [],
            },
          ],
        },
        { width: 900, height: 600 },
      ),
    /relation source -> target label overlaps source/,
  );
});

test('rendered diagrams contain no source paths or paragraph-like text', () => {
  for (const { spec, svg } of renderAllDiagrams()) {
    assert.doesNotMatch(svg, /apps\/|packages\/|model\/|tooling\/|docs\//, spec.id);
    assert.doesNotMatch(svg, /<foreignObject|<tspan|linearGradient/, spec.id);

    const textValues = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)]
      .map((match) => match[1]);
    assert.ok(
      textValues.every((value) => Array.from(value).length <= 42),
      `${spec.id} contains long explanatory text`,
    );
  }
});

test('committed SVG assets match their diagram specs', () => {
  for (const item of renderAllDiagrams()) {
    assert.equal(
      fs.readFileSync(path.join(REPO_ROOT, item.spec.outputPath), 'utf8'),
      item.svg,
      item.spec.outputPath,
    );
  }
});
