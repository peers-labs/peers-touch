import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const UNKNOWN=Symbol('missing');
const ops=new Set(['eq','ne','lte','gte','gt','and','or','implies']);
function operand(expr,input) {
  if(Object.hasOwn(expr,'literal')) return expr.literal;
  if(Object.hasOwn(expr,'field')) return Object.hasOwn(input,expr.field)?input[expr.field]:UNKNOWN;
  const a=expr.args.map(x=>operand(x,input));
  if(expr.op==='and') return a.includes(false)?false:a.includes(UNKNOWN)?UNKNOWN:true;
  if(expr.op==='or') return a.includes(true)?true:a.includes(UNKNOWN)?UNKNOWN:false;
  if(expr.op==='implies') return a[0]===false||a[1]===true?true:a.includes(UNKNOWN)?UNKNOWN:!a[0]||a[1];
  if(a.includes(UNKNOWN)) return UNKNOWN;
  return {
    eq:()=>a[0]===a[1],ne:()=>a[0]!==a[1],
    lte:()=>a[0]<=a[1],gte:()=>a[0]>=a[1],gt:()=>a[0]>a[1],
  }[expr.op]();
}
export function validateExpression(expr,fields,depth=0) {
  if(depth>32||expr===null||typeof expr!=='object'||Array.isArray(expr)) throw new Error('INVALID_EXPRESSION');
  const keys=Object.keys(expr).sort().join(',');
  if(keys==='field') {
    if(!Object.hasOwn(fields,expr.field)) throw new Error('UNDECLARED_FIELD');
    const field=fields[expr.field];
    if(field.type==='enum') {
      const types=new Set(field.values.map(v=>typeof v));
      if(types.size!==1) throw new Error('MIXED_ENUM_DOMAIN');
      return [...types][0];
    }
    return field.type==='integer'?'number':field.type;
  }
  if(keys==='literal') {
    if(!['string','number','boolean'].includes(typeof expr.literal)) throw new Error('INVALID_LITERAL');
    if(typeof expr.literal==='number'&&!Number.isFinite(expr.literal)) throw new Error('INVALID_LITERAL');
    return typeof expr.literal;
  }
  if(keys!=='args,op'||!ops.has(expr.op)||!Array.isArray(expr.args)) throw new Error('INVALID_EXPRESSION');
  if(['and','or'].includes(expr.op)?expr.args.length<2:expr.args.length!==2) throw new Error('INVALID_ARITY');
  const types=expr.args.map(x=>validateExpression(x,fields,depth+1));
  if(['and','or','implies'].includes(expr.op)) {
    if(types.some(t=>t!=='boolean')) throw new Error('NON_BOOLEAN_OPERAND');
  } else if(['lte','gte','gt'].includes(expr.op)) {
    if(types.some(t=>t!=='number')) throw new Error('NON_NUMERIC_OPERAND');
  } else if(types[0]!==types[1]) throw new Error('INCOMPATIBLE_OPERANDS');
  return 'boolean';
}
export function evaluateConstraint(contract,input) {
  if(input===null||typeof input!=='object'||Array.isArray(input)) return {status:'INVALID_INPUT',reason:'record required'};
  for(const [name,v] of Object.entries(input)) {
    const f=contract.evaluationInput[name];
    if(!f) return {status:'INVALID_INPUT',reason:`unknown field: ${name}`};
    const valid=f.type==='enum'?f.values.includes(v):f.type==='integer'?Number.isSafeInteger(v):
      f.type==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===f.type;
    if(!valid||(f.minimum!==undefined&&v<f.minimum)) return {status:'INVALID_INPUT',reason:`invalid type/domain: ${name}`};
  }
  const missing=Object.keys(contract.evaluationInput).filter(n=>!Object.hasOwn(input,n));
  // A complete observation is required even when one branch could short circuit.
  if(missing.length) return {status:'UNPROVEN',missing};
  const results=contract.constraints.map(r=>{
    validateExpression(r.expr,contract.evaluationInput);
    const value=operand(r.expr,input);
    if(typeof value!=='boolean'&&value!==UNKNOWN) throw new Error('NON_BOOLEAN_PREDICATE');
    return {constraintId:r.id,status:value===UNKNOWN?'UNPROVEN':value?'SATISFIED':'VIOLATED'};
  });
  return {status:results.some(r=>r.status==='VIOLATED')?'VIOLATED':results.some(r=>r.status==='UNPROVEN')?'UNPROVEN':'SATISFIED',results};
}
export function evaluateCalibration(registry,calibration) {
  const contracts=new Map(registry.contracts.map(c=>[c.id,c]));
  const results=calibration.cases.map(c=>{
    const contract=contracts.get(c.contractId);
    if(!contract) throw new Error(`UNKNOWN_CONTRACT: ${c.contractId}`);
    const result=evaluateConstraint(contract,c.input);
    return {caseId:c.id,contractId:c.contractId,class:c.class,expected:c.expected,actual:result.status,matches:result.status===c.expected};
  });
  return {kind:'peers-ui-visible-calibration-result',claimScope:'AUTHOR_VISIBLE_PREDICATE_CONFORMANCE_ONLY',usefulnessEvidence:'UNPROVEN',independentReview:'NOT_RUN',cases:results.length,matched:results.filter(r=>r.matches).length,results};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  try {
    const [, ,registryPath,calibrationPath]=process.argv;
    if(!registryPath||!calibrationPath) throw new Error('usage: node evaluate.mjs registry.json calibration.json');
    const result=evaluateCalibration(JSON.parse(fs.readFileSync(registryPath)),JSON.parse(fs.readFileSync(calibrationPath)));
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.matched===result.cases?0:1;
  } catch(error) {console.error(JSON.stringify({status:'INVALID_INPUT',reason:error.message}));process.exitCode=1;}
}
