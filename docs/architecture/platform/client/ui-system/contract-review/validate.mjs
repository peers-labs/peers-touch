import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {evaluateCalibration,evaluateConstraint,validateExpression} from './evaluate.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const json=n=>JSON.parse(read(n));
const sha=x=>`sha256:${createHash('sha256').update(x).digest('hex')}`;
const equalSets=(a,b)=>assert.deepEqual([...new Set(a)].sort(),[...new Set(b)].sort());
const unique=(list,name)=>assert.equal(new Set(list).size,list.length,`duplicate ${name}`);
const checks=[];
const check=(id,fn)=>{checks.push({id,status:'PASS',details:fn()});};
const registry=json('typed-registry.json');
const source=json('source-basis.json');
const audit=json('audit.json');
const original=json('../component-spec-index.json');
const catalog=json('../component-catalog.json');
const protocol=json('usefulness-protocol.json');
const proposal=json('execution-proposal.json');
check('standard-json-schema',()=>{
  const report=json('schema-validation.json');
  assert.equal(report.status,'PASS');
  assert.equal(report.schemaDigest,sha(read('registry.schema.json')));
  assert.equal(report.registryDigest,sha(read('typed-registry.json')));
  assert.equal(report.validatorSourceDigest,sha(read('validate-schema.py')));
  assert.ok(report.rejectedMutations>=4);
  return {standard:report.standard,rejectedMutations:report.rejectedMutations,scope:'shape only'};
});
check('source-fence',()=>{
  assert.equal(registry.sourceBasisDigest,sha(read('source-basis.json')));
  for(const s of source.sources) assert.equal(sha(read(s.snapshotRef)),s.digest,s.id);
  unique(source.sources.map(s=>s.id),'source');
  return {frozenSourceFiles:source.sources.length,canonicalCommit:source.canonicalCommit,historicalInventory:true};
});
check('complete-catalog-and-symbol-mapping',()=>{
  unique(registry.contracts.map(c=>c.id),'contract');
  equalSets(registry.contracts.map(c=>c.id),original.specifications.map(c=>c.id));
  equalSets(registry.catalogBindings.map(b=>b.catalogId),[...catalog.families,...catalog.supplementalRequirements].map(c=>c.id));
  assert.equal(registry.catalogBindings.length,134);
  for(const b of registry.catalogBindings) assert.ok(registry.contracts.find(c=>c.id===b.contractId)?.catalogIds.includes(b.catalogId));
  equalSets(registry.contracts.flatMap(c=>c.publicSymbolRefs),original.publicSymbolMappings.map(m=>m.sourceSymbol));
  assert.equal(registry.contracts.flatMap(c=>c.publicSymbolRefs).length,269);
  equalSets(registry.contracts.flatMap(c=>c.scenarios.map(s=>s.id)),original.specifications.flatMap(c=>c.cases.map(s=>s.id)));
  unique(registry.contracts.flatMap(c=>c.scenarios.map(s=>s.id)),'scenario');
  return {catalog:134,contracts:130,symbols:269,scenarios:547};
});
check('typed-axes-defaults-and-references',()=>{
  let axes=0;
  for(const c of registry.contracts) {
    const old=original.specifications.find(s=>s.id===c.id);
    const [file,anchor]=c.specRef.split('#');
    assert.ok(read(file).includes(`id="${anchor}"`),c.specRef);
    assert.equal(c.axes.length,old.variantAxes.length);
    unique(c.axes.map(a=>a.name),'axis');
    for(const a of c.axes) {
      axes++;
      assert.equal(a.draftSource.text,old.variantAxes[a.draftSource.ordinal]);
      if(a.type==='enum'||a.type==='set') {
        assert.ok(a.allowedValues.length);
        unique(a.allowedValues,'enum value');
        if(a.defaultPolicy.kind==='literal') {
          for(const v of a.type==='set'?a.defaultPolicy.value:[a.defaultPolicy.value]) assert.ok(a.allowedValues.includes(v));
        }
      }
      if(a.inputClass==='READ_ONLY_PROJECTION') assert.equal(a.defaultPolicy.kind,'owner-projection');
    }
    for(const id of c.basisRefs) assert.ok(source.sources.some(s=>s.id===id));
    for(const id of c.ports) assert.ok(registry.ports.some(p=>p.id===id));
    for(const s of c.scenarios) {
      assert.equal(s.bindingStatus,'NEEDS_CASE_SPECIFIC_OPERATION_ORACLE_AND_FINALIZER');
      assert.ok(c.observableAssertions.some(a=>a.id===s.structuredAssertionRef));
      for(const f of ['operationRef','oracleRef','finalizerRef','implementationRef']) assert.equal(s[f],null);
    }
  }
  return {axes,noProjectionDefault:true,caseBindingsUnproven:547};
});
check('predicate-domain-and-state-closure',()=>{
  for(const c of registry.contracts) {
    for(const r of c.constraints) validateExpression(r.expr,c.evaluationInput);
    const s=c.stateModel;
    assert.ok(s.states.includes(s.initial));
    unique(s.states,'state');
    for(const e of s.transitions) {
      assert.ok(s.states.includes(e.from)&&s.states.includes(e.to)&&s.events.includes(e.event));
      assert.ok(['UI_INTENT_ONLY','OWNER_PROJECTION','DRAFT_OWNER','UI_PRESENTATION','PORT_OBSERVATION'].includes(e.authority));
    }
    if(s.kind==='passive') assert.ok(s.notApplicable.includes('business success'));
    assert.equal(c.owner.ownerRef,null);
    assert.equal(c.status.contract,'DRAFT');
    assert.equal(c.status.usefulnessEvidence,'UNPROVEN');
    for(const a of c.observableAssertions) {
      assert.ok(c.constraints.some(r=>r.id===a.predicateRef));
      assert.equal(a.probeRef,null);
    }
  }
  return {capabilitySpecificPredicates:130,stateTemplates:'finite and explicit; not domain protocol proof',unboundProbes:130};
});
check('visible-calibration',()=>{
  const calibration=json('calibration.json');
  const result=evaluateCalibration(registry,calibration);
  const failures=result.results.filter(r=>!r.matches);
  assert.deepEqual(failures,[]);
  for(const c of registry.contracts) equalSets(calibration.cases.filter(x=>x.contractId===c.id).map(x=>x.class),['positive','negative','boundary','missing-input']);
  return {cases:result.cases,matched:result.matched,independence:'same author',proof:'predicate behavior only'};
});
check('malformed-input-and-expression-rejection',()=>{
  const c=registry.contracts[0];
  assert.equal(evaluateConstraint(c,{hasHref:'false',unrelatedPrimaryCount:1}).status,'INVALID_INPUT');
  assert.equal(evaluateConstraint(c,{hasHref:false,unrelatedPrimaryCount:1,unknown:true}).status,'INVALID_INPUT');
  assert.equal(evaluateConstraint(c,{hasHref:false}).status,'UNPROVEN');
  assert.throws(()=>validateExpression({op:'eval',args:[]},c.evaluationInput),/INVALID_EXPRESSION/);
  assert.throws(()=>validateExpression({field:'ambientSecret'},c.evaluationInput),/UNDECLARED_FIELD/);
  assert.throws(()=>validateExpression({op:'eq',args:[{field:'hasHref'}]},c.evaluationInput),/INVALID_ARITY/);
  assert.throws(()=>validateExpression({op:'lte',args:[{field:'hasHref'},{literal:1}]},c.evaluationInput),/NON_NUMERIC_OPERAND/);
  assert.throws(()=>validateExpression({op:'and',args:[{field:'hasHref'},{literal:1}]},c.evaluationInput),/NON_BOOLEAN_OPERAND/);
  assert.throws(()=>validateExpression({op:'eq',args:[{field:'hasHref'},{literal:'true'}]},c.evaluationInput),/INCOMPATIBLE_OPERANDS/);
  return 'Wrong types, unknown fields, missing observation, unknown operators and undeclared refs fail closed.';
});
check('full-audit-crosswalk',()=>{
  equalSets(audit.contracts.map(c=>c.contractId),registry.contracts.map(c=>c.id));
  unique(audit.findings.map(f=>f.id),'finding');
  for(const c of audit.contracts) {
    assert.equal(c.dimensionsReviewed.length,10);
    for(const f of c.findingRefs) assert.ok(audit.findings.some(x=>x.id===f&&x.affectedContractIds.includes(c.contractId)));
  }
  return {contracts:130,dimensions:10,findings:audit.findings.length,acceptance:'not granted'};
});
check('usefulness-and-execution-claim-boundaries',()=>{
  assert.equal(protocol.status,'FROZEN_PROPOSED_PROTOCOL');
  assert.equal(protocol.executionStatus,'NOT_RUN');
  assert.equal(protocol.freshHoldout.status,'NOT_AUTHORED_NOT_SEALED');
  assert.equal(protocol.framework,'EXISTING_EDX_REASONING_AND_CER');
  assert.ok(protocol.sourceComparisonPolicy.selectionAndReview.includes('identical'));
  assert.ok(protocol.sourceComparisonPolicy.realJourney.includes('own frozen'));
  assert.equal(proposal.status,'PROPOSED_NOT_EXECUTION_AUTHORITY');
  assert.equal(proposal.readiness,'PLAN_BLOCKED_BY_DESIGN');
  for(const gate of proposal.gates) {
    assert.ok(gate.executionBudgetSeconds>0&&gate.cleanupReserveSeconds>0);
    assert.equal(gate.evidenceStatus,'UNPROVEN');
  }
  const visited=new Set(),active=new Set(),byId=new Map(proposal.closures.map(c=>[c.id,c]));
  function visit(id) {
    if(active.has(id)) throw new Error('cycle');
    if(visited.has(id)) return;
    const c=byId.get(id);assert.ok(c);active.add(id);c.dependsOn.forEach(visit);active.delete(id);visited.add(id);
    for(const g of c.gateRefs) assert.ok(proposal.gates.some(x=>x.id===g));
  }
  proposal.closures.forEach(c=>visit(c.id));
  return {protocolRun:false,freshCasesAbsent:true,closures:visited.size,gates:proposal.gates.length};
});
check('review-navigation',()=>{
  const files=fs.readdirSync(root).filter(n=>n.endsWith('.md'));
  let n=0;
  for(const f of files) for(const m of read(f).matchAll(/\]\(([^)]+)\)/g)) {
    const link=m[1]; if(/^[a-z]+:/i.test(link)||link.startsWith('#')) continue;
    const [name]=link.split('#');
    const destination=path.resolve(root,name);
    if(destination!==path.join(root,'validation.json')) assert.ok(fs.existsSync(destination),`${f}: ${name}`);
    n++;
  }
  return {links:n,sourceSnapshots:'literal source blobs; original relative links are not this package navigation'};
});
check('frozen-artifact-manifest',()=>{
  const manifest=json('freeze-manifest.json');
  for(const f of manifest.files) assert.equal(sha(read(f.path)),f.digest,f.path);
  assert.equal(manifest.claimScope,'REVIEW_INPUT_CONTENT_FREEZE_ONLY');
  return {files:manifest.files.length,freeze:'content identity; no Owner approval or usefulness verdict'};
});
const report={kind:'peers-ui-contract-review-validation',status:'PASS',claimScope:'SOURCE_FREEZE_MAPPING_TYPED_PREDICATE_AND_DOCUMENT_STRUCTURE_ONLY',semanticAcceptance:'UNPROVEN',usefulnessEvidence:'UNPROVEN',galleryEvidence:'NOT_BUILT',productEvidence:'NOT_RUN',independentReview:'NOT_RUN',checks};
fs.writeFileSync(path.join(root,'validation.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report,null,2)+'\n');
