#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const ARCHITECTURE_ROOT = 'docs/architecture';
const MODULE_REGISTRY =
  'docs/architecture/engineering/architecture-governance/architecture-modules.json';
const SPEC_KIND = 'peers-touch-architecture-diagram';
const SPEC_VERSION = 3;
const ANCHORS = new Set(['top', 'right', 'bottom', 'left']);
const TONES = new Set([
  'neutral',
  'primary',
  'secondary',
  'state',
  'external',
  'muted',
]);
const EDGE_STYLES = new Set([
  'primary',
  'secondary',
  'return',
  'event',
  'feedback',
]);
const FRAGMENT_KINDS = new Set(['alt', 'else', 'region']);
const LAYOUTS = new Map([
  ['context', 'system-context'],
  ['layers', 'logical-layer'],
  ['topology', 'runtime-topology'],
  ['matrix', 'authority-map'],
  ['sequence', 'dynamic-flow'],
  ['control-loop', 'control-plane'],
  ['composition', 'reuse-topology'],
]);

function repoPath(...parts) {
  return path.join(REPO_ROOT, ...parts);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function compareStrings(left, right) {
  return left.localeCompare(right, 'en');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function assertObject(value, keys, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      `${context} has unknown or missing fields: ${actual.join(', ')}`,
    );
  }
  return value;
}

function assertArray(value, context, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new Error(`${context} must be an array with at least ${minimum} items`);
  }
  return value;
}

function assertString(value, context, maximum = 80) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || Array.from(value).length > maximum
  ) {
    throw new Error(`${context} must be a trimmed string <= ${maximum} chars`);
  }
  return value;
}

function assertNullableString(value, context, maximum = 80) {
  if (value !== null) assertString(value, context, maximum);
  return value;
}

function assertNumber(value, context, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${context} must be a number >= ${minimum}`);
  }
  return value;
}

function assertTone(value, context) {
  if (!TONES.has(value)) throw new Error(`${context} has unsupported tone`);
  return value;
}

function assertRect(value, context) {
  assertNumber(value.x, `${context}.x`);
  assertNumber(value.y, `${context}.y`);
  assertNumber(value.width, `${context}.width`, 1);
  assertNumber(value.height, `${context}.height`, 1);
  return value;
}

function assertCanvas(value, context) {
  assertObject(value, new Set(['width', 'height']), context);
  assertNumber(value.width, `${context}.width`, 900);
  assertNumber(value.height, `${context}.height`, 600);
  return value;
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
  );
}

function canvasBody(canvas) {
  return { x: 0, y: 76, width: canvas.width, height: canvas.height - 76 };
}

function overlaps(left, right, padding = 0) {
  return !(
    left.x + left.width + padding <= right.x
    || right.x + right.width + padding <= left.x
    || left.y + left.height + padding <= right.y
    || right.y + right.height + padding <= left.y
  );
}

function estimatedTextWidth(text, fontSize) {
  return Array.from(text).reduce(
    (width, character) =>
      width + fontSize * (character.codePointAt(0) > 0x7f ? 0.98 : 0.56),
    0,
  );
}

function assertTextFits(text, width, fontSize, context) {
  if (estimatedTextWidth(text, fontSize) > width) {
    throw new Error(`${context} does not fit its visual boundary`);
  }
}

function assertUniqueIds(items, context) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`${context} has duplicate id ${item.id}`);
    }
    seen.add(item.id);
  }
  return seen;
}

function anchorPoint(node, anchor) {
  switch (anchor) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
    default:
      throw new Error(`unsupported anchor ${anchor}`);
  }
}

function relationPathPoints(relation, nodes) {
  return [
    anchorPoint(nodes.get(relation.from), relation.fromAnchor),
    ...relation.via,
    anchorPoint(nodes.get(relation.to), relation.toAnchor),
  ];
}

function relationSegments(relation, nodes) {
  const points = relationPathPoints(relation, nodes);
  return points.slice(1).map((end, index) => ({
    start: points[index],
    end,
  }));
}

function collinearOverlap(left, right) {
  if (
    left.start.y === left.end.y
    && right.start.y === right.end.y
    && left.start.y === right.start.y
  ) {
    return (
      Math.min(
        Math.max(left.start.x, left.end.x),
        Math.max(right.start.x, right.end.x),
      )
      > Math.max(
        Math.min(left.start.x, left.end.x),
        Math.min(right.start.x, right.end.x),
      )
    );
  }
  if (
    left.start.x === left.end.x
    && right.start.x === right.end.x
    && left.start.x === right.start.x
  ) {
    return (
      Math.min(
        Math.max(left.start.y, left.end.y),
        Math.max(right.start.y, right.end.y),
      )
      > Math.max(
        Math.min(left.start.y, left.end.y),
        Math.min(right.start.y, right.end.y),
      )
    );
  }
  return false;
}

function perpendicularIntersection(left, right) {
  const horizontal = left.start.y === left.end.y
    ? left
    : right.start.y === right.end.y
      ? right
      : null;
  const vertical = left.start.x === left.end.x
    ? left
    : right.start.x === right.end.x
      ? right
      : null;
  if (horizontal === null || vertical === null) return false;
  const intersection = {
    x: vertical.start.x,
    y: horizontal.start.y,
  };
  return (
    intersection.x > Math.min(horizontal.start.x, horizontal.end.x)
    && intersection.x < Math.max(horizontal.start.x, horizontal.end.x)
    && intersection.y > Math.min(vertical.start.y, vertical.end.y)
    && intersection.y < Math.max(vertical.start.y, vertical.end.y)
  );
}

function validateDistinctRelationTracks(relations, nodes, context) {
  for (let left = 0; left < relations.length; left += 1) {
    for (let right = left + 1; right < relations.length; right += 1) {
      for (const leftSegment of relationSegments(relations[left], nodes)) {
        for (const rightSegment of relationSegments(relations[right], nodes)) {
          if (collinearOverlap(leftSegment, rightSegment)) {
            throw new Error(
              `${context} relations ${relations[left].from} -> ${relations[left].to} and ${relations[right].from} -> ${relations[right].to} share a track`,
            );
          }
          if (perpendicularIntersection(leftSegment, rightSegment)) {
            throw new Error(
              `${context} relations ${relations[left].from} -> ${relations[left].to} and ${relations[right].from} -> ${relations[right].to} cross`,
            );
          }
        }
      }
    }
  }
}

function segmentIntersectsRect(start, end, rect) {
  if (start.x === end.x) {
    return (
      start.x > rect.x
      && start.x < rect.x + rect.width
      && Math.max(start.y, end.y) > rect.y
      && Math.min(start.y, end.y) < rect.y + rect.height
    );
  }
  if (start.y === end.y) {
    return (
      start.y > rect.y
      && start.y < rect.y + rect.height
      && Math.max(start.x, end.x) > rect.x
      && Math.min(start.x, end.x) < rect.x + rect.width
    );
  }
  return true;
}

function labelPlacement(points, label) {
  let selected = null;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (selected === null || length > selected.length) {
      selected = { start, end, length };
    }
  }
  const width = Math.max(54, estimatedTextWidth(label, 13) + 18);
  return {
    x: (selected.start.x + selected.end.x) / 2 - width / 2,
    y: (selected.start.y + selected.end.y) / 2 - 15,
    width,
    height: 24,
  };
}

function guardConnectorPoints(guard, target) {
  const center = guard.x + guard.width / 2;
  const targetX = target.x + target.width / 2;
  const targetY = guard.y < target.y ? target.y : target.y + target.height;
  const guardY = guard.y < target.y ? guard.y + 30 : guard.y;
  return [
    { x: center, y: guardY },
    { x: center, y: (guardY + targetY) / 2 },
    { x: targetX, y: (guardY + targetY) / 2 },
    { x: targetX, y: targetY },
  ];
}

function parsePoint(value, context) {
  assertObject(value, new Set(['x', 'y']), context);
  assertNumber(value.x, `${context}.x`);
  assertNumber(value.y, `${context}.y`);
  return value;
}

function parseRelation(value, context) {
  assertObject(
    value,
    new Set([
      'from',
      'to',
      'fromAnchor',
      'toAnchor',
      'label',
      'style',
      'via',
    ]),
    context,
  );
  assertString(value.from, `${context}.from`);
  assertString(value.to, `${context}.to`);
  if (!ANCHORS.has(value.fromAnchor) || !ANCHORS.has(value.toAnchor)) {
    throw new Error(`${context} uses an unsupported anchor`);
  }
  assertNullableString(value.label, `${context}.label`, 28);
  if (!EDGE_STYLES.has(value.style)) {
    throw new Error(`${context} uses an unsupported edge style`);
  }
  return {
    ...value,
    via: assertArray(value.via, `${context}.via`).map((point, index) =>
      parsePoint(point, `${context}.via[${index}]`)),
  };
}

function parseVisualNode(value, context, roles) {
  assertObject(
    value,
    new Set([
      'id',
      'role',
      'x',
      'y',
      'width',
      'height',
      'title',
      'caption',
      'tone',
    ]),
    context,
  );
  assertString(value.id, `${context}.id`);
  if (!roles.has(value.role)) {
    throw new Error(`${context}.role is unsupported`);
  }
  assertRect(value, context);
  assertString(value.title, `${context}.title`, 34);
  assertNullableString(value.caption, `${context}.caption`, 42);
  assertTone(value.tone, `${context}.tone`);
  assertTextFits(value.title, value.width - 28, 18, `${context}.title`);
  if (value.caption !== null) {
    assertTextFits(value.caption, value.width - 28, 13, `${context}.caption`);
  }
  return value;
}

function validateNodeSet(nodes, canvas, context) {
  const ids = new Set();
  const bounds = canvasBody(canvas);
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`${context} has duplicate id ${node.id}`);
    ids.add(node.id);
    if (!contains(bounds, node)) {
      throw new Error(`${context}.${node.id} exceeds the canvas`);
    }
  }
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (overlaps(nodes[left], nodes[right])) {
        throw new Error(
          `${context} nodes ${nodes[left].id} and ${nodes[right].id} overlap`,
        );
      }
    }
  }
  return new Map(nodes.map((node) => [node.id, node]));
}

function validateRelations(relations, nodes, canvas, context) {
  const labels = [];
  for (const relation of relations) {
    if (!nodes.has(relation.from) || !nodes.has(relation.to)) {
      throw new Error(`${context} relation references an unknown node`);
    }
    const points = relationPathPoints(relation, nodes);
    for (const point of points) {
      if (
        point.x < 0
        || point.x > canvas.width
        || point.y < 76
        || point.y > canvas.height
      ) {
        throw new Error(
          `${context} relation ${relation.from} -> ${relation.to} leaves the canvas`,
        );
      }
    }
    for (let index = 1; index < points.length; index += 1) {
      if (
        points[index - 1].x !== points[index].x
        && points[index - 1].y !== points[index].y
      ) {
        throw new Error(
          `${context} relation ${relation.from} -> ${relation.to} is not orthogonal`,
        );
      }
      for (const [id, node] of nodes) {
        if (id === relation.from || id === relation.to) continue;
        if (segmentIntersectsRect(points[index - 1], points[index], node)) {
          throw new Error(
            `${context} relation ${relation.from} -> ${relation.to} crosses ${id}`,
          );
        }
      }
    }
    if (relation.label !== null) {
      const label = labelPlacement(points, relation.label);
      if (!contains({ x: 0, y: 76, width: canvas.width, height: canvas.height - 76 }, label)) {
        throw new Error(`${context} relation label exceeds the canvas`);
      }
      for (const [id, node] of nodes) {
        if (overlaps(label, node, 4)) {
          throw new Error(
            `${context} relation ${relation.from} -> ${relation.to} label overlaps ${id}`,
          );
        }
      }
      labels.push({
        ...label,
        relation: `${relation.from} -> ${relation.to}`,
      });
    }
  }
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      if (overlaps(labels[left], labels[right], 4)) {
        throw new Error(
          `${context} relation labels overlap: ${labels[left].relation} and ${labels[right].relation}`,
        );
      }
    }
  }
}

function parseContextScene(value, spec, context) {
  assertObject(
    value,
    new Set(['systemBoundary', 'elements', 'relations']),
    context,
  );
  assertObject(
    value.systemBoundary,
    new Set(['title', 'x', 'y', 'width', 'height']),
    `${context}.systemBoundary`,
  );
  const boundary = assertRect(value.systemBoundary, `${context}.systemBoundary`);
  assertString(value.systemBoundary.title, `${context}.systemBoundary.title`);
  if (!contains(canvasBody(spec.canvas), boundary)) {
    throw new Error(`${context}.systemBoundary exceeds the canvas`);
  }
  const elements = assertArray(value.elements, `${context}.elements`, 1).map(
    (node, index) => parseVisualNode(
      node,
      `${context}.elements[${index}]`,
      new Set(['actor', 'system', 'external']),
    ),
  );
  const nodes = validateNodeSet(elements, spec.canvas, context);
  for (const node of elements.filter((candidate) => candidate.role === 'system')) {
    if (!contains(boundary, node)) {
      throw new Error(`${context}.${node.id} must be inside systemBoundary`);
    }
  }
  const relations = assertArray(value.relations, `${context}.relations`).map(
    (relation, index) =>
      parseRelation(relation, `${context}.relations[${index}]`),
  );
  validateRelations(relations, nodes, spec.canvas, context);
  return { systemBoundary: value.systemBoundary, elements, relations };
}

function parseBand(value, context) {
  assertObject(
    value,
    new Set(['id', 'title', 'y', 'height', 'tone', 'modules']),
    context,
  );
  assertString(value.id, `${context}.id`);
  assertString(value.title, `${context}.title`, 30);
  assertNumber(value.y, `${context}.y`, 76);
  assertNumber(value.height, `${context}.height`, 60);
  assertTone(value.tone, `${context}.tone`);
  const modules = assertArray(value.modules, `${context}.modules`, 1).map(
    (node, index) => parseVisualNode(
      node,
      `${context}.modules[${index}]`,
      new Set(['module']),
    ),
  );
  return { ...value, modules };
}

function parseRail(value, context) {
  assertObject(
    value,
    new Set(['id', 'title', 'x', 'y', 'width', 'height', 'tone', 'items']),
    context,
  );
  assertString(value.id, `${context}.id`);
  assertString(value.title, `${context}.title`, 24);
  assertRect(value, context);
  assertTone(value.tone, `${context}.tone`);
  const items = assertArray(value.items, `${context}.items`, 1).map(
    (node, index) => parseVisualNode(
      node,
      `${context}.items[${index}]`,
      new Set(['rail-item']),
    ),
  );
  return { ...value, items };
}

function parseLayerScene(value, spec, context) {
  assertObject(value, new Set(['bands', 'rail', 'relations']), context);
  const bands = assertArray(value.bands, `${context}.bands`, 2).map(
    (band, index) => parseBand(band, `${context}.bands[${index}]`),
  );
  const rail = value.rail === null
    ? null
    : parseRail(value.rail, `${context}.rail`);
  const nodesArray = [
    ...bands.flatMap((band) => band.modules),
    ...(rail === null ? [] : rail.items),
  ];
  const nodes = validateNodeSet(nodesArray, spec.canvas, context);
  const bounds = canvasBody(spec.canvas);
  for (const band of bands) {
    const owner = {
      x: 44,
      y: band.y,
      width: spec.canvas.width - 88 - (rail === null ? 0 : rail.width + 24),
      height: band.height,
    };
    if (!contains(bounds, owner)) {
      throw new Error(`${context} band ${band.id} exceeds the canvas`);
    }
    for (const node of band.modules) {
      if (!contains(owner, node)) {
        throw new Error(`${context}.${node.id} exceeds band ${band.id}`);
      }
    }
  }
  if (rail !== null) {
    if (!contains(bounds, rail)) {
      throw new Error(`${context} rail ${rail.id} exceeds the canvas`);
    }
    for (const node of rail.items) {
      if (!contains(rail, node)) {
        throw new Error(`${context}.${node.id} exceeds rail ${rail.id}`);
      }
    }
  }
  const relations = assertArray(value.relations, `${context}.relations`).map(
    (relation, index) =>
      parseRelation(relation, `${context}.relations[${index}]`),
  );
  validateRelations(relations, nodes, spec.canvas, context);
  return { bands, rail, relations };
}

function parseZone(value, context) {
  assertObject(
    value,
    new Set(['id', 'title', 'x', 'y', 'width', 'height', 'tone']),
    context,
  );
  assertString(value.id, `${context}.id`);
  assertString(value.title, `${context}.title`, 30);
  assertRect(value, context);
  assertTone(value.tone, `${context}.tone`);
  return value;
}

function parseTopologyScene(value, spec, context) {
  assertObject(value, new Set(['zones', 'instances', 'relations']), context);
  const zones = assertArray(value.zones, `${context}.zones`, 1).map(
    (zone, index) => parseZone(zone, `${context}.zones[${index}]`),
  );
  for (const zone of zones) {
    if (!contains(canvasBody(spec.canvas), zone)) {
      throw new Error(`${context} zone ${zone.id} exceeds the canvas`);
    }
  }
  for (let left = 0; left < zones.length; left += 1) {
    for (let right = left + 1; right < zones.length; right += 1) {
      if (overlaps(zones[left], zones[right])) {
        throw new Error(
          `${context} zones ${zones[left].id} and ${zones[right].id} overlap`,
        );
      }
    }
  }
  const zoneMap = new Map(zones.map((zone) => [zone.id, zone]));
  const instances = assertArray(value.instances, `${context}.instances`, 1).map(
    (node, index) => {
      const parsed = parseVisualNode(
        node,
        `${context}.instances[${index}]`,
        new Set(zoneMap.keys()),
      );
      if (!contains(zoneMap.get(parsed.role), parsed)) {
        throw new Error(`${context}.${parsed.id} exceeds zone ${parsed.role}`);
      }
      return parsed;
    },
  );
  const nodes = validateNodeSet(instances, spec.canvas, context);
  const relations = assertArray(value.relations, `${context}.relations`).map(
    (relation, index) =>
      parseRelation(relation, `${context}.relations[${index}]`),
  );
  validateRelations(relations, nodes, spec.canvas, context);
  validateDistinctRelationTracks(relations, nodes, context);
  return { zones, instances, relations };
}

function parseMatrixScene(value, spec, context) {
  assertObject(value, new Set(['owners', 'concerns', 'assignments']), context);
  const owners = assertArray(value.owners, `${context}.owners`, 2).map(
    (owner, index) => {
      assertObject(owner, new Set(['id', 'title']), `${context}.owners[${index}]`);
      assertString(owner.id, `${context}.owners[${index}].id`);
      assertString(owner.title, `${context}.owners[${index}].title`, 22);
      return owner;
    },
  );
  const concerns = assertArray(value.concerns, `${context}.concerns`, 2).map(
    (concern, index) => {
      assertObject(
        concern,
        new Set(['id', 'title']),
        `${context}.concerns[${index}]`,
      );
      assertString(concern.id, `${context}.concerns[${index}].id`);
      assertString(concern.title, `${context}.concerns[${index}].title`, 28);
      return concern;
    },
  );
  const ownerIds = assertUniqueIds(owners, `${context}.owners`);
  const concernIds = assertUniqueIds(concerns, `${context}.concerns`);
  const columnWidth = (spec.canvas.width - 344) / owners.length;
  const rowHeight = (spec.canvas.height - 204) / concerns.length;
  if (columnWidth < 80 || rowHeight < 48) {
    throw new Error(`${context} matrix cells are too small`);
  }
  for (const [index, owner] of owners.entries()) {
    assertTextFits(
      owner.title,
      columnWidth - 16,
      14,
      `${context}.owners[${index}].title`,
    );
  }
  for (const [index, concern] of concerns.entries()) {
    assertTextFits(
      concern.title,
      220,
      14,
      `${context}.concerns[${index}].title`,
    );
  }
  const assignments = assertArray(
    value.assignments,
    `${context}.assignments`,
    concerns.length,
  ).map((assignment, index) => {
    assertObject(
      assignment,
      new Set(['concern', 'owner']),
      `${context}.assignments[${index}]`,
    );
    if (!concernIds.has(assignment.concern) || !ownerIds.has(assignment.owner)) {
      throw new Error(`${context}.assignments[${index}] references unknown id`);
    }
    return assignment;
  });
  if (assignments.length !== concerns.length) {
    throw new Error(`${context} must assign each concern exactly once`);
  }
  if (new Set(assignments.map((item) => item.concern)).size !== concerns.length) {
    throw new Error(`${context} must assign every concern exactly once`);
  }
  return { owners, concerns, assignments };
}

function parseSequenceScene(value, spec, context) {
  assertObject(value, new Set(['participants', 'messages', 'fragments']), context);
  const participants = assertArray(
    value.participants,
    `${context}.participants`,
    2,
  ).map((participant, index) => {
    assertObject(
      participant,
      new Set(['id', 'title', 'tone']),
      `${context}.participants[${index}]`,
    );
    assertString(participant.id, `${context}.participants[${index}].id`);
    assertString(participant.title, `${context}.participants[${index}].title`, 24);
    assertTone(participant.tone, `${context}.participants[${index}].tone`);
return participant;
    },
  );
  const participantIds = assertUniqueIds(
    participants,
    `${context}.participants`,
  );
  const left = 120;
  const right = spec.canvas.width - 120;
  const laneGap = (right - left) / (participants.length - 1);
  const headerWidth = Math.min(182, laneGap - 18);
  if (headerWidth < 100) {
    throw new Error(`${context} participant lanes are too narrow`);
  }
  for (const [index, participant] of participants.entries()) {
    assertTextFits(
      participant.title,
      headerWidth - 20,
      18,
      `${context}.participants[${index}].title`,
    );
  }
  const messages = assertArray(value.messages, `${context}.messages`, 1).map(
    (message, index) => {
      assertObject(
        message,
        new Set(['from', 'to', 'label', 'at', 'style']),
        `${context}.messages[${index}]`,
      );
      if (!participantIds.has(message.from) || !participantIds.has(message.to)) {
        throw new Error(`${context}.messages[${index}] references unknown lane`);
      }
      if (message.from === message.to) {
        throw new Error(`${context}.messages[${index}] cannot be self-directed`);
      }
      assertString(message.label, `${context}.messages[${index}].label`, 30);
      assertNumber(message.at, `${context}.messages[${index}].at`, 1);
      if (!EDGE_STYLES.has(message.style)) {
        throw new Error(`${context}.messages[${index}].style is unsupported`);
      }
      const fromIndex = participants.findIndex(
        (participant) => participant.id === message.from,
      );
      const toIndex = participants.findIndex(
        (participant) => participant.id === message.to,
      );
      assertTextFits(
        message.label,
        Math.abs(toIndex - fromIndex) * laneGap - 26,
        13,
        `${context}.messages[${index}].label`,
      );
      return message;
    },
  );
  const occupied = new Set();
  for (const message of messages) {
    if (occupied.has(message.at)) {
      throw new Error(`${context} has multiple messages at ${message.at}`);
    }
    occupied.add(message.at);
  }
  const maximumAt = Math.max(...messages.map((message) => message.at));
  if (205 + (maximumAt - 1) * 58 + 62 > spec.canvas.height) {
    throw new Error(`${context} messages exceed the canvas`);
  }
  const fragments = assertArray(value.fragments, `${context}.fragments`).map(
    (fragment, index) => {
      assertObject(
        fragment,
        new Set(['kind', 'label', 'startAt', 'endAt', 'tone']),
        `${context}.fragments[${index}]`,
      );
      if (!FRAGMENT_KINDS.has(fragment.kind)) {
        throw new Error(`${context}.fragments[${index}].kind is unsupported`);
      }
      assertString(fragment.label, `${context}.fragments[${index}].label`, 24);
      assertNumber(fragment.startAt, `${context}.fragments[${index}].startAt`, 1);
      assertNumber(fragment.endAt, `${context}.fragments[${index}].endAt`, 1);
      if (fragment.endAt < fragment.startAt) {
        throw new Error(`${context}.fragments[${index}] has reversed bounds`);
      }
      assertTone(fragment.tone, `${context}.fragments[${index}].tone`);
      assertTextFits(
        `${fragment.kind.toUpperCase()} · ${fragment.label}`,
        spec.canvas.width - 120,
        12,
        `${context}.fragments[${index}].label`,
      );
      return fragment;
    },
  );
  for (const [index, fragment] of fragments.entries()) {
    if (
      fragment.kind === 'else'
      && (
        index === 0
        || fragments[index - 1].kind !== 'alt'
        || fragments[index - 1].endAt + 1 !== fragment.startAt
      )
    ) {
      throw new Error(`${context}.fragments[${index}] is not paired with alt`);
    }
  }
  return { participants, messages, fragments };
}

function parseControlScene(value, spec, context) {
  assertObject(value, new Set(['stages', 'guards', 'relations']), context);
  const stages = assertArray(value.stages, `${context}.stages`, 2).map(
    (node, index) => parseVisualNode(
      node,
      `${context}.stages[${index}]`,
      new Set(['stage']),
    ),
  );
  const nodes = validateNodeSet(stages, spec.canvas, context);
  const guards = assertArray(value.guards, `${context}.guards`, 1).map(
    (guard, index) => {
      assertObject(
        guard,
        new Set(['title', 'target', 'x', 'y', 'width', 'tone']),
        `${context}.guards[${index}]`,
      );
      assertString(guard.title, `${context}.guards[${index}].title`, 28);
      if (!nodes.has(guard.target)) {
        throw new Error(`${context}.guards[${index}] references unknown stage`);
      }
      assertNumber(guard.x, `${context}.guards[${index}].x`);
      assertNumber(guard.y, `${context}.guards[${index}].y`, 76);
      assertNumber(guard.width, `${context}.guards[${index}].width`, 80);
      assertTone(guard.tone, `${context}.guards[${index}].tone`);
      assertTextFits(
        guard.title,
        guard.width - 20,
        13,
        `${context}.guards[${index}].title`,
      );
      return guard;
    },
  );
  const guardRects = guards.map((guard) => ({
    x: guard.x,
    y: guard.y,
    width: guard.width,
    height: 30,
    title: guard.title,
  }));
  for (const guard of guardRects) {
    if (!contains(canvasBody(spec.canvas), guard)) {
      throw new Error(`${context} guard ${guard.title} exceeds the canvas`);
    }
    for (const [id, node] of nodes) {
      if (overlaps(guard, node, 4)) {
        throw new Error(`${context} guard ${guard.title} overlaps ${id}`);
      }
    }
  }
  for (let left = 0; left < guardRects.length; left += 1) {
    for (let right = left + 1; right < guardRects.length; right += 1) {
      if (overlaps(guardRects[left], guardRects[right], 4)) {
        throw new Error(
          `${context} guards ${guardRects[left].title} and ${guardRects[right].title} overlap`,
        );
      }
    }
  }
  for (const guard of guards) {
    const points = guardConnectorPoints(guard, nodes.get(guard.target));
    for (let index = 1; index < points.length; index += 1) {
      for (const [id, node] of nodes) {
        if (id === guard.target) continue;
        if (segmentIntersectsRect(points[index - 1], points[index], node)) {
          throw new Error(`${context} guard ${guard.title} crosses ${id}`);
        }
      }
    }
  }
  const relations = assertArray(value.relations, `${context}.relations`, 1).map(
    (relation, index) =>
      parseRelation(relation, `${context}.relations[${index}]`),
  );
  validateRelations(relations, nodes, spec.canvas, context);
  return { stages, guards, relations };
}

function parseCompositionScene(value, spec, context) {
  assertObject(value, new Set(['rows', 'rail', 'relations']), context);
  const rows = assertArray(value.rows, `${context}.rows`, 2).map(
    (row, index) => parseBand(row, `${context}.rows[${index}]`),
  );
  const rail = value.rail === null
    ? null
    : parseRail(value.rail, `${context}.rail`);
  const modules = [
    ...rows.flatMap((row) => row.modules),
    ...(rail === null ? [] : rail.items),
  ];
  const nodes = validateNodeSet(modules, spec.canvas, context);
  const bounds = canvasBody(spec.canvas);
  const availableWidth =
    spec.canvas.width - 88 - (rail === null ? 0 : rail.width + 24);
  for (const row of rows) {
    const owner = {
      x: 44,
      y: row.y,
      width: availableWidth,
      height: row.height,
    };
    if (!contains(bounds, owner)) {
      throw new Error(`${context} row ${row.id} exceeds the canvas`);
    }
    for (const node of row.modules) {
      if (!contains(owner, node)) {
        throw new Error(`${context}.${node.id} exceeds row ${row.id}`);
      }
    }
  }
  if (rail !== null) {
    if (!contains(bounds, rail)) {
      throw new Error(`${context} rail ${rail.id} exceeds the canvas`);
    }
    for (const node of rail.items) {
      if (!contains(rail, node)) {
        throw new Error(`${context}.${node.id} exceeds rail ${rail.id}`);
      }
    }
  }
  const relations = assertArray(value.relations, `${context}.relations`).map(
    (relation, index) =>
      parseRelation(relation, `${context}.relations[${index}]`),
  );
  validateRelations(relations, nodes, spec.canvas, context);
  return { rows, rail, relations };
}

function moduleRegistry() {
  const registry = JSON.parse(fs.readFileSync(repoPath(MODULE_REGISTRY), 'utf8'));
  return new Map(registry.modules.map((module) => [module.id, module]));
}

function walkSpecs(absoluteRoot) {
  const specs = [];
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory()
      && ['archive', 'execution-plans', 'node_modules'].includes(entry.name)
    ) {
      continue;
    }
    const absolute = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      specs.push(...walkSpecs(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.diagram.json')) {
      specs.push(toPosix(path.relative(REPO_ROOT, absolute)));
    }
  }
  return specs.sort(compareStrings);
}

export function validateLayoutScene(
  layout,
  scene,
  canvas,
  context = 'fixture.scene',
) {
  const spec = { canvas: assertCanvas(canvas, `${context}.canvas`) };
  switch (layout) {
    case 'context':
      return parseContextScene(scene, spec, context);
    case 'layers':
      return parseLayerScene(scene, spec, context);
    case 'topology':
      return parseTopologyScene(scene, spec, context);
    case 'matrix':
      return parseMatrixScene(scene, spec, context);
    case 'sequence':
      return parseSequenceScene(scene, spec, context);
    case 'control-loop':
      return parseControlScene(scene, spec, context);
    case 'composition':
      return parseCompositionScene(scene, spec, context);
    default:
      throw new Error(`${context} has unsupported layout ${layout}`);
  }
}

function parseSpec(relative, modules) {
  const value = JSON.parse(fs.readFileSync(repoPath(relative), 'utf8'));
  assertObject(
    value,
    new Set([
      'kind',
      'schemaVersion',
      'id',
      'module',
      'viewpoint',
      'layout',
      'output',
      'title',
      'canvas',
      'edgeMeaning',
      'scene',
    ]),
    relative,
  );
  if (value.kind !== SPEC_KIND || value.schemaVersion !== SPEC_VERSION) {
    throw new Error(`${relative} has an unsupported diagram schema`);
  }
  for (const key of ['id', 'module', 'viewpoint', 'layout', 'output', 'title']) {
    assertString(value[key], `${relative}.${key}`);
  }
  if (LAYOUTS.get(value.layout) !== value.viewpoint) {
    throw new Error(`${relative} layout does not match viewpoint`);
  }
  if (
    value.output.includes('/')
    || value.output.includes('\\')
    || !value.output.endsWith('.svg')
  ) {
    throw new Error(`${relative}.output must be a sibling SVG filename`);
  }
  assertNullableString(value.edgeMeaning, `${relative}.edgeMeaning`, 60);
  const directory = path.posix.dirname(relative);
  if (value.module === 'project') {
    if (directory !== ARCHITECTURE_ROOT) {
      throw new Error(`${relative} project diagrams must live in the architecture root`);
    }
  } else {
    const module = modules.get(value.module);
    if (module === undefined || directory !== module.root) {
      throw new Error(`${relative} does not match module ${value.module}`);
    }
  }
  const spec = {
    ...value,
    source: relative,
    outputPath: `${directory}/${value.output}`,
    canvas: assertCanvas(value.canvas, `${relative}.canvas`),
  };
  const sceneContext = `${relative}.scene`;
  spec.scene = validateLayoutScene(
    value.layout,
    value.scene,
    value.canvas,
    sceneContext,
  );
  return spec;
}

export function discoverDiagramSpecs() {
  const modules = moduleRegistry();
  const specs = walkSpecs(repoPath(ARCHITECTURE_ROOT)).map((source) =>
    parseSpec(source, modules));
  const ids = new Set();
  const outputs = new Set();
  for (const spec of specs) {
    if (ids.has(spec.id)) throw new Error(`duplicate diagram id: ${spec.id}`);
    if (outputs.has(spec.outputPath)) {
      throw new Error(`duplicate diagram output: ${spec.outputPath}`);
    }
    ids.add(spec.id);
    outputs.add(spec.outputPath);
  }
  return specs.sort((left, right) => compareStrings(left.id, right.id));
}

function renderBase(spec, content) {
  const { width, height } = spec.canvas;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    `  viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"`,
    `  role="img" aria-labelledby="title-${escapeXml(spec.id)}">`,
    '<style>',
    '  .canvas { fill: #111418; }',
    '  .headerRule { stroke: #30363d; stroke-width: 1; }',
    '  .title { fill: #f4f7fa; font: 600 30px "Avenir Next","PingFang SC","Helvetica Neue",sans-serif; letter-spacing: 0; }',
    '  .viewpoint { fill: #8c98a4; font: 600 13px "SFMono-Regular","Menlo",monospace; letter-spacing: 0; }',
    '  .boundary { fill: none; stroke: #69737d; stroke-width: 1.5; stroke-dasharray: 7 6; }',
    '  .boundaryTitle { fill: #aeb7c0; font: 600 14px "SFMono-Regular","Menlo",monospace; letter-spacing: 0; }',
    '  .zone { fill: #171b20; stroke: #343b43; stroke-width: 1.4; }',
    '  .zone-primary { fill: #152019; stroke: #55d98d; }',
    '  .zone-secondary { fill: #141d25; stroke: #65b8ff; }',
    '  .zone-state { fill: #211d14; stroke: #e0b35a; }',
    '  .zone-external { fill: #191b1e; stroke: #7c8792; stroke-dasharray: 6 5; }',
    '  .zone-muted { fill: #14171b; stroke: #2c3239; }',
    '  .zoneTitle { fill: #aeb7c0; font: 600 15px "Avenir Next","PingFang SC","Helvetica Neue",sans-serif; letter-spacing: 0; }',
    '  .node { fill: #1b2026; stroke: #49525c; stroke-width: 1.4; }',
    '  .node-primary { fill: #17231b; stroke: #55d98d; stroke-width: 1.8; }',
    '  .node-secondary { fill: #16212b; stroke: #65b8ff; }',
    '  .node-state { fill: #252116; stroke: #e0b35a; }',
    '  .node-external { fill: #1a1d21; stroke: #7c8792; }',
    '  .node-muted { fill: #161a1f; stroke: #343b43; }',
    '  .nodeTitle { fill: #f0f3f6; font: 600 18px "Avenir Next","PingFang SC","Helvetica Neue",sans-serif; letter-spacing: 0; }',
    '  .nodeCaption { fill: #9da8b3; font: 400 13px "Avenir Next","PingFang SC","Helvetica Neue",sans-serif; letter-spacing: 0; }',
    '  .edge { fill: none; stroke: #55d98d; stroke-width: 2; stroke-linejoin: round; }',
    '  .edge-secondary { stroke: #65b8ff; }',
    '  .edge-return { stroke: #a6b0ba; stroke-dasharray: 6 5; }',
    '  .edge-event { stroke: #e0b35a; stroke-dasharray: 3 4; }',
    '  .edge-feedback { stroke: #d48787; stroke-dasharray: 7 5; }',
    '  .edgeLabelBox { fill: #111418; stroke: #30363d; stroke-width: 1; }',
    '  .edgeLabel { fill: #d7dde3; font: 500 13px "Avenir Next","PingFang SC","Helvetica Neue",sans-serif; letter-spacing: 0; }',
    '  .band { fill: #171b20; }',
    '  .band-primary { fill: #142019; }',
    '  .band-secondary { fill: #141d25; }',
    '  .band-state { fill: #201c14; }',
    '  .band-muted { fill: #14171b; }',
    '  .bandRule { stroke: #30363d; stroke-width: 1; }',
    '  .bandTitle { fill: #8f9aa5; font: 600 14px "SFMono-Regular","Menlo",monospace; letter-spacing: 0; }',
    '  .lifeline { stroke: #48515a; stroke-width: 1.3; stroke-dasharray: 5 6; }',
    '  .fragment { fill: #151a1f; stroke: #3b444d; stroke-width: 1; }',
    '  .fragment-primary { fill: #142019; stroke: #3d7555; }',
    '  .fragment-secondary { fill: #141d25; stroke: #416884; }',
    '  .fragmentLabel { fill: #aeb7c0; font: 600 12px "SFMono-Regular","Menlo",monospace; letter-spacing: 0; }',
    '  .matrixHead { fill: #181d22; stroke: #343b43; stroke-width: 1; }',
    '  .matrixCell { fill: #14181d; stroke: #2d343c; stroke-width: 1; }',
    '  .matrixOwner { fill: #17301f; stroke: #55d98d; stroke-width: 1.4; }',
    '  .matrixText { fill: #d8dee4; font: 500 14px "Avenir Next","PingFang SC","Helvetica Neue",sans-serif; letter-spacing: 0; }',
    '  .matrixOwnerText { fill: #7fe7a8; font: 700 13px "SFMono-Regular","Menlo",monospace; letter-spacing: 0; }',
    '  .guard { fill: #151a1f; stroke: #59636e; stroke-width: 1; }',
    '  .guard-primary { stroke: #55d98d; }',
    '  .guard-secondary { stroke: #65b8ff; }',
    '  .guard-state { stroke: #e0b35a; }',
    '  .guardLine { stroke: #59636e; stroke-width: 1; stroke-dasharray: 3 4; }',
    '  .guardText { fill: #b4bec8; font: 500 13px "Avenir Next","PingFang SC","Helvetica Neue",sans-serif; letter-spacing: 0; }',
    '</style>',
    '<defs>',
    '  <marker id="arrow-primary" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">',
    '    <path d="M 0 0 L 10 5 L 0 10 z" fill="#55d98d"/>',
    '  </marker>',
    '  <marker id="arrow-secondary" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">',
    '    <path d="M 0 0 L 10 5 L 0 10 z" fill="#65b8ff"/>',
    '  </marker>',
    '  <marker id="arrow-return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">',
    '    <path d="M 0 0 L 10 5 L 0 10 z" fill="#a6b0ba"/>',
    '  </marker>',
    '  <marker id="arrow-event" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">',
    '    <path d="M 0 0 L 10 5 L 0 10 z" fill="#e0b35a"/>',
    '  </marker>',
    '  <marker id="arrow-feedback" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">',
    '    <path d="M 0 0 L 10 5 L 0 10 z" fill="#d48787"/>',
    '  </marker>',
    '</defs>',
    `<title id="title-${escapeXml(spec.id)}">${escapeXml(spec.title)}</title>`,
    `<rect class="canvas" width="${width}" height="${height}"/>`,
    `<text class="title" x="44" y="48">${escapeXml(spec.title)}</text>`,
    `<text class="viewpoint" x="${width - 44}" y="46" text-anchor="end">${escapeXml(spec.viewpoint.toUpperCase())}</text>`,
    `<line class="headerRule" x1="44" y1="72" x2="${width - 44}" y2="72"/>`,
    content,
    '</svg>',
    '',
  ].join('\n');
}

function renderNode(node) {
  const caption = node.caption === null
    ? ''
    : `<text class="nodeCaption" x="${node.x + 14}" y="${node.y + node.height - 17}">${escapeXml(node.caption)}</text>`;
  return [
    `<rect class="node node-${node.tone}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6"/>`,
    `<text class="nodeTitle" x="${node.x + 14}" y="${node.y + 31}">${escapeXml(node.title)}</text>`,
    caption,
  ].filter(Boolean).join('\n');
}

function renderRelation(relation, nodes) {
  const points = [
    anchorPoint(nodes.get(relation.from), relation.fromAnchor),
    ...relation.via,
    anchorPoint(nodes.get(relation.to), relation.toAnchor),
  ];
  const pathData = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const output = [
    `<path class="edge edge-${relation.style}" d="${pathData}" marker-end="url(#arrow-${relation.style})"/>`,
  ];
  if (relation.label !== null) {
    const box = labelPlacement(points, relation.label);
    output.push(
      `<rect class="edgeLabelBox" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4"/>`,
      `<text class="edgeLabel" x="${box.x + box.width / 2}" y="${box.y + 17}" text-anchor="middle">${escapeXml(relation.label)}</text>`,
    );
  }
  return output.join('\n');
}

function renderContext(spec) {
  const { systemBoundary, elements, relations } = spec.scene;
  const nodes = new Map(elements.map((node) => [node.id, node]));
  return renderBase(spec, [
    `<rect class="boundary" x="${systemBoundary.x}" y="${systemBoundary.y}" width="${systemBoundary.width}" height="${systemBoundary.height}" rx="8"/>`,
    `<text class="boundaryTitle" x="${systemBoundary.x + 14}" y="${systemBoundary.y + 24}">${escapeXml(systemBoundary.title)}</text>`,
    ...relations.map((relation) => renderRelation(relation, nodes)),
    ...elements.map(renderNode),
  ].join('\n'));
}

function renderBand(band, availableWidth) {
  return [
    `<rect class="band band-${band.tone}" x="44" y="${band.y}" width="${availableWidth}" height="${band.height}"/>`,
    `<line class="bandRule" x1="44" y1="${band.y}" x2="${44 + availableWidth}" y2="${band.y}"/>`,
    `<text class="bandTitle" x="62" y="${band.y + 28}">${escapeXml(band.title)}</text>`,
    ...band.modules.map(renderNode),
  ].join('\n');
}

function renderLayers(spec) {
  const { bands, rail, relations } = spec.scene;
  const nodesArray = [
    ...bands.flatMap((band) => band.modules),
    ...(rail === null ? [] : rail.items),
  ];
  const nodes = new Map(nodesArray.map((node) => [node.id, node]));
  const availableWidth = spec.canvas.width - 88 - (rail === null ? 0 : rail.width + 24);
  const railOutput = rail === null ? [] : [
    `<rect class="zone zone-${rail.tone}" x="${rail.x}" y="${rail.y}" width="${rail.width}" height="${rail.height}" rx="6"/>`,
    `<text class="zoneTitle" x="${rail.x + 14}" y="${rail.y + 28}">${escapeXml(rail.title)}</text>`,
    ...rail.items.map(renderNode),
  ];
  return renderBase(spec, [
    ...bands.map((band) => renderBand(band, availableWidth)),
    ...railOutput,
    ...relations.map((relation) => renderRelation(relation, nodes)),
  ].join('\n'));
}

function renderTopology(spec) {
  const { zones, instances, relations } = spec.scene;
  const nodes = new Map(instances.map((node) => [node.id, node]));
  return renderBase(spec, [
    ...zones.flatMap((zone) => [
      `<rect class="zone zone-${zone.tone}" x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" rx="7"/>`,
      `<text class="zoneTitle" x="${zone.x + 14}" y="${zone.y + 27}">${escapeXml(zone.title)}</text>`,
    ]),
    ...relations.map((relation) => renderRelation(relation, nodes)),
    ...instances.map(renderNode),
  ].join('\n'));
}

function renderMatrix(spec) {
  const { owners, concerns, assignments } = spec.scene;
  const left = 300;
  const top = 160;
  const right = spec.canvas.width - 44;
  const bottom = spec.canvas.height - 44;
  const columnWidth = (right - left) / owners.length;
  const rowHeight = (bottom - top) / concerns.length;
  const assignmentMap = new Map(
    assignments.map((assignment) => [assignment.concern, assignment.owner]),
  );
  const output = [
    `<rect class="matrixHead" x="44" y="96" width="${left - 44}" height="${top - 96}"/>`,
    `<text class="matrixText" x="62" y="134">STATE / DECISION</text>`,
  ];
  owners.forEach((owner, index) => {
    const x = left + index * columnWidth;
    output.push(
      `<rect class="matrixHead" x="${x}" y="96" width="${columnWidth}" height="${top - 96}"/>`,
      `<text class="matrixText" x="${x + columnWidth / 2}" y="134" text-anchor="middle">${escapeXml(owner.title)}</text>`,
    );
  });
  concerns.forEach((concern, rowIndex) => {
    const y = top + rowIndex * rowHeight;
    output.push(
      `<rect class="matrixHead" x="44" y="${y}" width="${left - 44}" height="${rowHeight}"/>`,
      `<text class="matrixText" x="62" y="${y + rowHeight / 2 + 5}">${escapeXml(concern.title)}</text>`,
    );
    owners.forEach((owner, columnIndex) => {
      const x = left + columnIndex * columnWidth;
      const assigned = assignmentMap.get(concern.id) === owner.id;
      output.push(
        `<rect class="${assigned ? 'matrixOwner' : 'matrixCell'}" x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}"/>`,
      );
      if (assigned) {
        output.push(
          `<circle cx="${x + columnWidth / 2}" cy="${y + rowHeight / 2 - 7}" r="6" fill="#55d98d"/>`,
          `<text class="matrixOwnerText" x="${x + columnWidth / 2}" y="${y + rowHeight / 2 + 18}" text-anchor="middle">OWNER</text>`,
        );
      }
    });
  });
  return renderBase(spec, output.join('\n'));
}

function renderSequence(spec) {
  const { participants, messages, fragments } = spec.scene;
  const left = 120;
  const right = spec.canvas.width - 120;
  const headerY = 104;
  const laneGap = (right - left) / (participants.length - 1);
  const headerWidth = Math.min(182, laneGap - 18);
  const laneX = new Map(
    participants.map((participant, index) => [
      participant.id,
      left + index * laneGap,
    ]),
  );
  const messageY = (at) => 205 + (at - 1) * 58;
  const maximumAt = Math.max(...messages.map((message) => message.at));
  const lifelineEnd = Math.min(spec.canvas.height - 42, messageY(maximumAt) + 62);
  const output = [];
  for (const fragment of fragments) {
    const y = messageY(fragment.startAt) - 28;
    const height = messageY(fragment.endAt) - y + 32;
    output.push(
      `<rect class="fragment fragment-${fragment.tone}" x="44" y="${y}" width="${spec.canvas.width - 88}" height="${height}" rx="4"/>`,
      `<text class="fragmentLabel" x="56" y="${y + 19}">${escapeXml(`${fragment.kind.toUpperCase()} · ${fragment.label}`)}</text>`,
    );
  }
  participants.forEach((participant) => {
    const x = laneX.get(participant.id);
    output.push(
      `<rect class="node node-${participant.tone}" x="${x - headerWidth / 2}" y="${headerY}" width="${headerWidth}" height="52" rx="5"/>`,
      `<text class="nodeTitle" x="${x}" y="${headerY + 32}" text-anchor="middle">${escapeXml(participant.title)}</text>`,
      `<line class="lifeline" x1="${x}" y1="${headerY + 52}" x2="${x}" y2="${lifelineEnd}"/>`,
    );
  });
  [...messages]
    .sort((leftMessage, rightMessage) => leftMessage.at - rightMessage.at)
    .forEach((message) => {
      const fromX = laneX.get(message.from);
      const toX = laneX.get(message.to);
      const y = messageY(message.at);
      const direction = toX > fromX ? 1 : -1;
      const start = fromX + direction * 7;
      const end = toX - direction * 9;
      const labelWidth = Math.max(
        70,
        estimatedTextWidth(message.label, 13) + 18,
      );
      const labelX = (fromX + toX) / 2 - labelWidth / 2;
      output.push(
        `<path class="edge edge-${message.style}" d="M ${start} ${y} L ${end} ${y}" marker-end="url(#arrow-${message.style})"/>`,
        `<rect class="edgeLabelBox" x="${labelX}" y="${y - 27}" width="${labelWidth}" height="22" rx="4"/>`,
        `<text class="edgeLabel" x="${(fromX + toX) / 2}" y="${y - 11}" text-anchor="middle">${escapeXml(message.label)}</text>`,
      );
    });
  return renderBase(spec, output.join('\n'));
}

function renderControl(spec) {
  const { stages, guards, relations } = spec.scene;
  const nodes = new Map(stages.map((node) => [node.id, node]));
  const output = [
    ...relations.map((relation) => renderRelation(relation, nodes)),
    ...stages.map(renderNode),
  ];
  for (const guard of guards) {
    const target = nodes.get(guard.target);
    const points = guardConnectorPoints(guard, target);
    const center = guard.x + guard.width / 2;
    const pathData = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
    output.push(
      `<path class="guardLine" d="${pathData}"/>`,
      `<rect class="guard guard-${guard.tone}" x="${guard.x}" y="${guard.y}" width="${guard.width}" height="30" rx="4"/>`,
      `<text class="guardText" x="${center}" y="${guard.y + 20}" text-anchor="middle">${escapeXml(guard.title)}</text>`,
    );
  }
  return renderBase(spec, output.join('\n'));
}

function renderComposition(spec) {
  const { rows, rail, relations } = spec.scene;
  const modules = [
    ...rows.flatMap((row) => row.modules),
    ...(rail === null ? [] : rail.items),
  ];
  const nodes = new Map(modules.map((node) => [node.id, node]));
  const availableWidth =
    spec.canvas.width - 88 - (rail === null ? 0 : rail.width + 24);
  const railOutput = rail === null ? [] : [
    `<rect class="zone zone-${rail.tone}" x="${rail.x}" y="${rail.y}" width="${rail.width}" height="${rail.height}" rx="6"/>`,
    `<text class="zoneTitle" x="${rail.x + 14}" y="${rail.y + 28}">${escapeXml(rail.title)}</text>`,
    ...rail.items.map(renderNode),
  ];
  return renderBase(spec, [
    ...rows.map((row) => renderBand(row, availableWidth)),
    ...railOutput,
    ...relations.map((relation) => renderRelation(relation, nodes)),
  ].join('\n'));
}

export function renderDiagram(spec) {
  switch (spec.layout) {
    case 'context':
      return renderContext(spec);
    case 'layers':
      return renderLayers(spec);
    case 'topology':
      return renderTopology(spec);
    case 'matrix':
      return renderMatrix(spec);
    case 'sequence':
      return renderSequence(spec);
    case 'control-loop':
      return renderControl(spec);
    case 'composition':
      return renderComposition(spec);
    default:
      throw new Error(`unsupported diagram layout ${spec.layout}`);
  }
}

export function renderAllDiagrams() {
  return discoverDiagramSpecs().map((spec) => ({
    spec,
    svg: renderDiagram(spec),
  }));
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const unexpected = args.filter((argument) => argument !== '--check');
  if (unexpected.length > 0) {
    throw new Error(`unsupported arguments: ${unexpected.join(', ')}`);
  }
  const rendered = renderAllDiagrams();
  const stale = [];
  for (const item of rendered) {
    const absolute = repoPath(item.spec.outputPath);
    if (check) {
      if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== item.svg) {
        stale.push(item.spec.outputPath);
      }
    } else {
      fs.writeFileSync(absolute, item.svg, 'utf8');
      process.stdout.write(`${item.spec.outputPath}\n`);
    }
  }
  if (stale.length > 0) {
    throw new Error(`architecture SVG output is stale: ${stale.join(', ')}`);
  }
  if (check) process.stdout.write('architecture SVG output is current\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
